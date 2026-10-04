import {
  OAuthTokenEndpointError,
  antigravityCredentialRefreshPort,
  type RefreshedOAuthToken,
} from "../adapters/antigravity/token-client.js"
import { formatRefreshParts, parseRefreshParts, calculateTokenExpiry } from "./auth"
import { clearCachedAuth, storeCachedAuth } from "./cache"
import { createLogger } from "./logger"
import { invalidateProjectContextCache } from "./project"
import type { OAuthAuthDetails, PluginClient, RefreshParts } from "./types"

const log = createLogger("token")

/** Provider-specific token endpoint failure mapped to the existing refresh contract. */
export class AntigravityTokenRefreshError extends Error {
  code?: string
  description?: string
  status: number
  statusText: string

  /** Creates the stable refresh error exposed to existing plugin callers. */
  constructor(options: { message: string; code?: string; description?: string; status: number; statusText: string }) {
    super(options.message)
    this.name = "AntigravityTokenRefreshError"
    this.code = options.code
    this.description = options.description
    this.status = options.status
    this.statusText = options.statusText
  }
}

/**
 * Refreshes an Antigravity OAuth access token, updates persisted credentials, and handles revocation.
 */
export async function refreshAccessToken(
  auth: OAuthAuthDetails,
  client: PluginClient,
  providerId: string,
): Promise<OAuthAuthDetails | undefined> {
  const parts = parseRefreshParts(auth.refresh)
  if (!parts.refreshToken) {
    return undefined
  }

  try {
    const startTime = Date.now()
    let payload: RefreshedOAuthToken
    try {
      payload = await antigravityCredentialRefreshPort.refresh(parts.refreshToken)
    } catch (error) {
      if (!(error instanceof OAuthTokenEndpointError)) throw error

      const details = [error.code, error.description].filter(Boolean).join(": ")
      log.warn("Token refresh failed", { status: error.status, code: error.code, details })
      if (error.code === "invalid_grant") {
        log.warn("Google revoked the stored refresh token - reauthentication required")
        invalidateProjectContextCache(auth.refresh)
        clearCachedAuth(auth.refresh)
      }
      throw new AntigravityTokenRefreshError({
        message: error.message,
        code: error.code,
        description: error.description,
        status: error.status,
        statusText: error.statusText,
      })
    }

    const refreshedParts: RefreshParts = {
      refreshToken: payload.refreshToken ?? parts.refreshToken,
      projectId: parts.projectId,
      managedProjectId: parts.managedProjectId,
    }

    const updatedAuth: OAuthAuthDetails = {
      ...auth,
      access: payload.accessToken,
      expires: calculateTokenExpiry(startTime, payload.expiresIn),
      refresh: formatRefreshParts(refreshedParts),
    }

    storeCachedAuth(updatedAuth)
    invalidateProjectContextCache(auth.refresh)

    return updatedAuth
  } catch (error) {
    if (error instanceof AntigravityTokenRefreshError) {
      throw error
    }
    log.error("Unexpected token refresh error", { error: String(error) })
    return undefined
  }
}
