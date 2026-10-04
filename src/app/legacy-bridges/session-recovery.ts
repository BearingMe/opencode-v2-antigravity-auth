import type { SessionRecoveryApi } from "../../modules/session-recovery/index.js"
import type { AntigravityConfig } from "../../plugin/config/index.js"
import { createSessionRecoveryHook, detectErrorType } from "../../plugin/recovery.js"
import type { PluginClient } from "../../plugin/types.js"

/**
 * Wraps the current host-coupled recovery hook behind its module API.
 *
 * @example `createLegacySessionRecovery(client, directory, config)`
 */
export function createLegacySessionRecovery(
  client: PluginClient,
  directory: string,
  config: AntigravityConfig,
): SessionRecoveryApi | null {
  const hook = createSessionRecoveryHook({ client, directory }, config)
  if (!hook) return null

  return {
    /** Exposes the current recovery error classifier. */
    detectErrorType,
    /** Reports whether the current recovery implementation handles the error. */
    isRecoverableError: hook.isRecoverableError,
    /** Delegates repair to the current host-backed recovery hook. */
    handleSessionRecovery: hook.handleSessionRecovery,
  }
}
