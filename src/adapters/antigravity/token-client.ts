import { ANTIGRAVITY_CLIENT_ID, ANTIGRAVITY_CLIENT_SECRET } from "./constants.js"
import type { AccountCredentialRefreshPort } from "../../modules/accounts/index.js"

interface OAuthErrorPayload {
  error?:
    | string
    | {
        code?: string
        status?: string
        message?: string
      }
  error_description?: string
}

/** OAuth token returned by Google's refresh-token endpoint. */
export interface RefreshedOAuthToken {
  accessToken: string
  expiresIn: unknown
  refreshToken?: string
}

/** Endpoint rejection with the fields callers use to preserve refresh errors. */
export class OAuthTokenEndpointError extends Error {
  code?: string
  description?: string
  status: number
  statusText: string

  /** Creates a vendor error that retains Google's response status and description. */
  constructor(options: { code?: string; description?: string; status: number; statusText: string }) {
    const details = [options.code, options.description].filter(Boolean).join(": ")
    const baseMessage = `Antigravity token refresh failed (${options.status} ${options.statusText})`
    super(details ? `${baseMessage} - ${details}` : baseMessage)
    this.name = "OAuthTokenEndpointError"
    this.code = options.code
    this.description = options.description
    this.status = options.status
    this.statusText = options.statusText
  }
}

/** Parses the provider's string and object-shaped OAuth error payloads. */
function parseOAuthErrorPayload(text: string | undefined): { code?: string; description?: string } {
  if (!text) return {}

  try {
    const payload = JSON.parse(text) as OAuthErrorPayload
    if (!payload || typeof payload !== "object") return { description: text }

    let code: string | undefined
    if (typeof payload.error === "string") {
      code = payload.error
    } else if (payload.error && typeof payload.error === "object") {
      code = payload.error.status ?? payload.error.code
      if (!payload.error_description && payload.error.message) {
        return { code, description: payload.error.message }
      }
    }

    if (payload.error_description) return { code, description: payload.error_description }
    if (payload.error && typeof payload.error === "object" && payload.error.message) {
      return { code, description: payload.error.message }
    }
    return { code }
  } catch {
    return { description: text }
  }
}

/** Exchanges a stored refresh token for the provider's latest OAuth token response. */
export async function refreshOAuthToken(refreshToken: string): Promise<RefreshedOAuthToken> {
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: ANTIGRAVITY_CLIENT_ID,
      client_secret: ANTIGRAVITY_CLIENT_SECRET,
    }),
  })

  if (!response.ok) {
    let errorText: string | undefined
    try {
      errorText = await response.text()
    } catch {
      errorText = undefined
    }
    const parsed = parseOAuthErrorPayload(errorText)
    throw new OAuthTokenEndpointError({
      ...parsed,
      description: parsed.description ?? errorText,
      status: response.status,
      statusText: response.statusText,
    })
  }

  const payload: unknown = await response.json()
  if (typeof payload !== "object" || payload === null) throw new Error("Invalid token response")
  const token = payload as Record<string, unknown>
  const accessToken = token.access_token
  if (typeof accessToken !== "string") throw new Error("Invalid token response")
  return {
    accessToken,
    expiresIn: token.expires_in,
    refreshToken: typeof token.refresh_token === "string" ? token.refresh_token : undefined,
  }
}

/** Account credential refresh port backed by Google's OAuth token endpoint. */
export const antigravityCredentialRefreshPort: AccountCredentialRefreshPort<string, RefreshedOAuthToken> = {
  refresh: refreshOAuthToken,
}
