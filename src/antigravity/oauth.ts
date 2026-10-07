import { calculateTokenExpiry } from "../modules/accounts/index.js"
import { createLogger } from "../adapters/opencode/logger.js"
import { createOAuthAuthorization, exchangeOAuthAuthorizationCode } from "../adapters/antigravity/oauth-client.js"
import { antigravityOAuthProjectDiscoveryPort } from "../adapters/antigravity/project-client.js"

const log = createLogger("oauth")

interface AntigravityAuthState {
  verifier: string
  projectId: string
}

/** Result returned after building the provider authorization URL. */
export interface AntigravityAuthorization {
  url: string
  verifier: string
  projectId: string
}

interface AntigravityTokenExchangeSuccess {
  type: "success"
  refresh: string
  access: string
  expires: number
  email?: string
  projectId: string
}

interface AntigravityTokenExchangeFailure {
  type: "failed"
  error: string
}

/** OAuth result returned to the OpenCode auth callback. */
export type AntigravityTokenExchangeResult = AntigravityTokenExchangeSuccess | AntigravityTokenExchangeFailure

/** Decodes OAuth state and rejects payloads without a PKCE verifier. */
function decodeState(state: string): AntigravityAuthState {
  const normalized = state.replace(/-/g, "+").replace(/_/g, "/")
  const padded = normalized.padEnd(normalized.length + ((4 - (normalized.length % 4)) % 4), "=")
  const parsed = JSON.parse(Buffer.from(padded, "base64").toString("utf8"))
  if (typeof parsed.verifier !== "string") throw new Error("Missing PKCE verifier in state")
  return {
    verifier: parsed.verifier,
    projectId: typeof parsed.projectId === "string" ? parsed.projectId : "",
  }
}

/** Builds the Antigravity OAuth authorization URL including PKCE. */
export async function authorizeAntigravity(projectId = ""): Promise<AntigravityAuthorization> {
  const authorization = await createOAuthAuthorization(projectId || "")
  return { ...authorization, projectId: projectId || "" }
}

/** Exchanges the callback code, discovers a project when absent, and packs the refresh data. */
export async function exchangeAntigravity(code: string, state: string): Promise<AntigravityTokenExchangeResult> {
  try {
    const { verifier, projectId } = decodeState(state)
    const startTime = Date.now()
    const tokens = await exchangeOAuthAuthorizationCode(code, verifier)
    if ("error" in tokens) return { type: "failed", error: tokens.error }

    let effectiveProjectId = projectId
    if (!effectiveProjectId) {
      const discovery = await antigravityOAuthProjectDiscoveryPort.discover(tokens.accessToken)
      effectiveProjectId = discovery.projectId
      if (!discovery.projectId && discovery.errors.length > 0) {
        log.warn("Failed to resolve Antigravity project via loadCodeAssist", { errors: discovery.errors.join("; ") })
      }
    }

    return {
      type: "success",
      refresh: `${tokens.refreshToken}|${effectiveProjectId || ""}`,
      access: tokens.accessToken,
      expires: calculateTokenExpiry(startTime, tokens.expiresIn),
      email: tokens.email,
      projectId: effectiveProjectId || "",
    }
  } catch (error) {
    return {
      type: "failed",
      error: error instanceof Error ? error.message : "Unknown error",
    }
  }
}
