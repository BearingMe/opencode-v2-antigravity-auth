import { createAntigravityInferenceClient } from "../adapters/antigravity/inference-client.js"
import { ANTIGRAVITY_PROVIDER_ID } from "../constants.js"
import { accessTokenExpired } from "../plugin/auth.js"
import { disposeDiskSignatureCache } from "../plugin/cache.js"
import { createLegacyAccountAdministration, createLegacyAccountPool } from "./legacy-bridges/accounts.js"
import { createLegacySessionRecovery } from "./legacy-bridges/session-recovery.js"
import { legacyInference } from "./legacy-bridges/inference.js"
import { ensureProjectContext } from "../plugin/project.js"
import { refreshAccessToken } from "../plugin/token.js"
import type { OAuthAuthDetails, PluginClient } from "../plugin/types.js"
import { executeRequest, type EngineRequestOptions, type EngineToastVariant } from "./execute-request.js"
import type { AccountOAuthCredential } from "../modules/accounts/index.js"
import type { AccountAdminService } from "../modules/accounts/index.js"
import type { SessionRecoveryApi } from "../modules/session-recovery/index.js"
import type { AntigravityConfig } from "../plugin/config/index.js"

/** OAuth credential shape accepted by the V2 auth refresh hook. */
export type UnifiedOAuthCredential = {
  type: string
  access: string
  refresh: string
  expires: number
  methodID: string
  metadata?: Record<string, unknown>
}

/** Runtime dependencies that belong to the OpenCode host boundary. */
export interface AntigravityApplicationOptions extends EngineRequestOptions {
  client: PluginClient
  providerId: string
  fetchImpl?: typeof fetch
}

/** Composes account administration with the existing persistence and verification adapters. */
export function createAccountAdministration(
  client?: PluginClient,
  providerId = ANTIGRAVITY_PROVIDER_ID,
): AccountAdminService {
  return createLegacyAccountAdministration(client, providerId)
}

/** Composes session-recovery policy with the selected host and filesystem adapters. */
export function createSessionRecovery(
  client: PluginClient,
  directory: string,
  config: AntigravityConfig,
): SessionRecoveryApi | null {
  return createLegacySessionRecovery(client, directory, config)
}

/** Releases process-wide inference resources when the plugin is disposed. */
export async function disposeAntigravityRuntimeResources(): Promise<void> {
  await disposeDiskSignatureCache()
}

/**
 * Refreshes a V2 OAuth credential through the shared Antigravity token policy.
 *
 * @example `refreshOAuthCredentialUnified(credential, client, "antigravity")`
 */
export async function refreshOAuthCredentialUnified<T extends UnifiedOAuthCredential>(
  credential: T,
  client: PluginClient,
  providerId: string,
): Promise<T> {
  const auth: OAuthAuthDetails = {
    type: "oauth",
    refresh: credential.refresh,
    access: credential.access,
    expires: credential.expires,
  }
  const refreshed = await refreshAccessToken(auth, client, providerId)
  if (!refreshed?.access) {
    throw new Error("Google token refresh failed")
  }
  return {
    ...credential,
    access: refreshed.access,
    expires: refreshed.expires ?? credential.expires,
    refresh: refreshed.refresh,
  }
}

/**
 * Selects the account, inference, and transport adapters for one routed request.
 *
 * @example `executeAntigravityRequest(input, init, options)`
 */
export function executeAntigravityRequest(
  input: RequestInfo | string,
  init: RequestInit | undefined,
  options: AntigravityApplicationOptions,
): Promise<Response> {
  const ports = {
    accountPool: createLegacyAccountPool(options.accountManager),
    inference: legacyInference,
    inferenceClient: createAntigravityInferenceClient(options.fetchImpl),
    accessTokenExpired,
    refreshAccessToken: (auth: AccountOAuthCredential) => refreshAccessToken(auth, options.client, options.providerId),
    ensureProjectContext,
    clearOAuthCredential: async () => {
      await options.client.auth.set({
        path: { id: options.providerId },
        body: { type: "oauth", refresh: "", access: "", expires: 0 },
      })
    },
    showToast: async (message: string, variant: EngineToastVariant) => {
      await options.client.tui.showToast({ body: { message, variant } })
    },
  }

  return executeRequest(input, init, options, ports)
}
