import { formatRefreshParts, parseRefreshParts } from "../modules/accounts/index.js"
import { ensureProjectContext } from "../adapters/opencode/project.js"
import { prepareAntigravityRequest } from "./request.js"
import { AntigravityTokenRefreshError, refreshAccessToken } from "../adapters/opencode/token.js"
import {
  antigravityAccessVerificationPort,
  createVerificationProbeRequest,
} from "../adapters/antigravity/verification-client.js"
import { extractVerificationErrorDetails } from "../adapters/antigravity/verification-parser.js"
import type { PluginClient } from "../adapters/opencode/types.js"

/** Account-facing result after mapping provider verification requirements. */
export type VerificationProbeResult = {
  status: "ok" | "blocked" | "error"
  message: string
  verifyUrl?: string
}

/** Refreshes one account and maps an Antigravity probe into an account verification result. */
export async function verifyAccountAccess(
  account: {
    refreshToken: string
    email?: string
    projectId?: string
    managedProjectId?: string
  },
  client: PluginClient,
  providerId: string,
): Promise<VerificationProbeResult> {
  const parsed = parseRefreshParts(account.refreshToken)
  if (!parsed.refreshToken) {
    return { status: "error", message: "Missing refresh token for selected account." }
  }

  const auth = {
    type: "oauth" as const,
    refresh: formatRefreshParts({
      refreshToken: parsed.refreshToken,
      projectId: parsed.projectId ?? account.projectId,
      managedProjectId: parsed.managedProjectId ?? account.managedProjectId,
    }),
    access: "",
    expires: 0,
  }

  let refreshedAuth: Awaited<ReturnType<typeof refreshAccessToken>>
  try {
    refreshedAuth = await refreshAccessToken(auth, client, providerId)
  } catch (error) {
    if (error instanceof AntigravityTokenRefreshError) {
      return { status: "error", message: error.message }
    }
    return { status: "error", message: `Token refresh failed: ${String(error)}` }
  }

  if (!refreshedAuth?.access) {
    return { status: "error", message: "Could not refresh access token for this account." }
  }

  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), 20_000)
  let response: Awaited<ReturnType<typeof antigravityAccessVerificationPort.verify>>
  try {
    const project = await ensureProjectContext(refreshedAuth)
    const probeRequest = createVerificationProbeRequest(controller.signal)
    const prepared = prepareAntigravityRequest(
      probeRequest.request,
      probeRequest.init,
      refreshedAuth.access,
      project.effectiveProjectId,
    )
    response = await antigravityAccessVerificationPort.verify({ request: prepared.request, init: prepared.init })
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      return { status: "error", message: "Verification check timed out." }
    }
    return { status: "error", message: `Verification check failed: ${String(error)}` }
  } finally {
    clearTimeout(timeoutId)
  }

  if (response.ok) {
    return { status: "ok", message: "Account verification check passed." }
  }

  const extracted = extractVerificationErrorDetails(response.body)
  if (response.status === 403 && extracted.validationRequired) {
    return {
      status: "blocked",
      message: extracted.message ?? "Google requires additional account verification.",
      verifyUrl: extracted.verifyUrl,
    }
  }

  const fallbackMessage = extracted.message ?? `Request failed (${response.status} ${response.statusText}).`
  return {
    status: "error",
    message: fallbackMessage,
  }
}
