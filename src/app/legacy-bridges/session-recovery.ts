import { createSessionRecoveryPolicy, type SessionRecoveryApi } from "../../modules/session-recovery/index.js"
import { fileRecoveryStorage } from "../../adapters/filesystem/session-recovery-store.js"
import { createOpenCodeRecoverySessionPort } from "../../adapters/opencode/session-recovery.js"
import { logToast } from "../../plugin/debug.js"
import { createLogger } from "../../plugin/logger.js"
import type { AntigravityConfig } from "../../plugin/config/index.js"
import type { PluginClient } from "../../plugin/types.js"

/**
 * Composes session-recovery policy with OpenCode and filesystem adapters.
 *
 * @example `createLegacySessionRecovery(client, directory, config)`
 */
export function createLegacySessionRecovery(
  client: PluginClient,
  directory: string,
  config: AntigravityConfig,
): SessionRecoveryApi | null {
  const logger = createLogger("session-recovery")
  return createSessionRecoveryPolicy(
    {
      storage: fileRecoveryStorage,
      session: createOpenCodeRecoverySessionPort(client, directory),
      logger: {
        debug: (message, context) => logger.debug(message, context),
        error: (message, context) => logger.error(message, context),
        toast: logToast,
      },
    },
    {
      enabled: config.session_recovery,
      autoResume: config.auto_resume,
      resumeText: config.resume_text,
    },
  )
}
