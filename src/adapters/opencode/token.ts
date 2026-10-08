import {
  OAuthTokenEndpointError,
  antigravityCredentialRefreshPort,
  type RefreshedOAuthToken,
} from "../antigravity/token-client.js"
import { createAccountCredentialRefreshPolicy } from "../../modules/accounts/index.js"
import { calculateTokenExpiry, formatRefreshParts, parseRefreshParts } from "../../modules/accounts/index.js"
import { clearCachedAuth, storeCachedAuth } from "../../modules/accounts/index.js"
import { invalidateProjectContextCache } from "./project.js"
import { createLogger } from "./logger.js"
import type { AccountOAuthCredential, AccountRefreshParts } from "../../modules/accounts/index.js"
import type { PluginClient } from "./types.js"

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

const credentialRefreshPolicy = createAccountCredentialRefreshPolicy<
  AccountOAuthCredential,
  AccountRefreshParts,
  RefreshedOAuthToken
>({
  port: antigravityCredentialRefreshPort,
  parseParts: parseRefreshParts,
  formatParts: formatRefreshParts,
  calculateExpiry: calculateTokenExpiry,
  now: () => Date.now(),
  storeCachedCredential: storeCachedAuth,
  invalidateProjectContext: invalidateProjectContextCache,
  clearCachedCredential: clearCachedAuth,
  parseEndpointFailure: (error) => {
    if (!(error instanceof OAuthTokenEndpointError)) return undefined
    return {
      message: error.message,
      code: error.code,
      description: error.description,
      status: error.status,
      statusText: error.statusText,
    }
  },
  createRefreshError: (failure) => new AntigravityTokenRefreshError(failure),
  isRefreshError: (error) => error instanceof AntigravityTokenRefreshError,
  logger: log,
})

/** Compatibility entry into the unified account credential refresh policy. */
export function refreshAccessToken(
  auth: AccountOAuthCredential,
  _client: PluginClient,
  _providerId: string,
): Promise<AccountOAuthCredential | undefined> {
  return credentialRefreshPolicy.refresh(auth)
}
