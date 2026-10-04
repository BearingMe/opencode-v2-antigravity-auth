import type { AccountCredentialRefreshPort } from "../ports.js"
import type { AccountRefreshParts } from "../index.js"

/** OAuth credential shape managed by account refresh policy. */
export interface AccountOAuthCredential {
  type: "oauth"
  refresh: string
  access?: string
  expires?: number
}

/** Successful access-token response from the provider refresh port. */
export interface RefreshedAccountCredential {
  accessToken: string
  expiresIn: unknown
  refreshToken?: string
}

/** Normalized refresh failure details used for stable caller errors. */
export interface AccountCredentialRefreshFailure {
  message: string
  code?: string
  description?: string
  status: number
  statusText: string
}

/** Logging operations needed by credential refresh policy. */
export interface AccountRefreshLogger {
  warn(message: string, context?: Record<string, unknown>): void
  error(message: string, context?: Record<string, unknown>): void
}

/** Dependencies for one unified account credential refresh policy. */
export interface AccountCredentialRefreshPolicyDependencies<
  Credential extends AccountOAuthCredential,
  Parts extends AccountRefreshParts,
  Refreshed extends RefreshedAccountCredential,
> {
  port: AccountCredentialRefreshPort<string, Refreshed>
  parseParts(refresh: string): Parts
  formatParts(parts: Parts): string
  calculateExpiry(requestTime: number, expiresIn: unknown): number
  now(): number
  storeCachedCredential(credential: Credential): void
  invalidateProjectContext(refresh: string): void
  clearCachedCredential(refresh: string): void
  parseEndpointFailure(error: unknown): AccountCredentialRefreshFailure | undefined
  createRefreshError(failure: AccountCredentialRefreshFailure): Error
  isRefreshError(error: unknown): boolean
  logger: AccountRefreshLogger
}

/** Creates the single token refresh path used by requests and background policy. */
export function createAccountCredentialRefreshPolicy<
  Credential extends AccountOAuthCredential,
  Parts extends AccountRefreshParts,
  Refreshed extends RefreshedAccountCredential,
>(
  dependencies: AccountCredentialRefreshPolicyDependencies<Credential, Parts, Refreshed>,
): { refresh(credential: Credential): Promise<Credential | undefined> } {
  return {
    /** Refreshes the access token, preserving project parts and revocation cleanup. */
    async refresh(credential): Promise<Credential | undefined> {
      const parts = dependencies.parseParts(credential.refresh)
      if (!parts.refreshToken) return undefined

      try {
        const startTime = dependencies.now()
        let payload: Refreshed
        try {
          payload = await dependencies.port.refresh(parts.refreshToken)
        } catch (error) {
          const failure = dependencies.parseEndpointFailure(error)
          if (!failure) throw error

          const details = [failure.code, failure.description].filter(Boolean).join(": ")
          dependencies.logger.warn("Token refresh failed", {
            status: failure.status,
            code: failure.code,
            details,
          })
          if (failure.code === "invalid_grant") {
            dependencies.logger.warn("Google revoked the stored refresh token - reauthentication required")
            dependencies.invalidateProjectContext(credential.refresh)
            dependencies.clearCachedCredential(credential.refresh)
          }
          throw dependencies.createRefreshError(failure)
        }

        const refreshedParts = {
          ...parts,
          refreshToken: payload.refreshToken ?? parts.refreshToken,
        }
        const updatedCredential = {
          ...credential,
          access: payload.accessToken,
          expires: dependencies.calculateExpiry(startTime, payload.expiresIn),
          refresh: dependencies.formatParts(refreshedParts),
        } as Credential

        dependencies.storeCachedCredential(updatedCredential)
        dependencies.invalidateProjectContext(credential.refresh)
        return updatedCredential
      } catch (error) {
        if (dependencies.isRefreshError(error)) throw error
        dependencies.logger.error("Unexpected token refresh error", { error: String(error) })
        return undefined
      }
    },
  }
}
