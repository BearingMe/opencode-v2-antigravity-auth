import { fileRecoveryStorage } from "../adapters/filesystem/session-recovery-store.js"
import { createOpenCodeRecoverySessionPort } from "../adapters/opencode/session-recovery.js"
import {
  createSessionRecoveryPolicy,
  detectRecoveryErrorType,
  getRecoverySuccessToast,
  getRecoveryToastContent,
  isRecoverableSessionError,
  type RecoveryRequest,
} from "../modules/session-recovery/index.js"
import type { AntigravityConfig } from "../adapters/opencode/config/index.js"
import { logToast } from "./debug"
import { createLogger } from "./logger"
import type { PluginClient } from "./types"

/** Legacy hook contract retained for existing plugin imports. */
export interface SessionRecoveryHook {
  handleSessionRecovery: (info: RecoveryRequest) => Promise<boolean>
  isRecoverableError: (error: unknown) => boolean
  setOnAbortCallback: (callback: (sessionID: string) => void) => void
  setOnRecoveryCompleteCallback: (callback: (sessionID: string) => void) => void
}

/** Host context retained by the compatibility hook factory. */
export interface SessionRecoveryContext {
  client: PluginClient
  directory: string
}

/** Creates the legacy hook contract over the extracted recovery policy. */
export function createSessionRecoveryHook(
  context: SessionRecoveryContext,
  config: AntigravityConfig,
): SessionRecoveryHook | null {
  const logger = createLogger("session-recovery")
  return createSessionRecoveryPolicy(
    {
      storage: fileRecoveryStorage,
      session: createOpenCodeRecoverySessionPort(context.client, context.directory),
      logger: {
        debug: (message, fields) => logger.debug(message, fields),
        error: (message, fields) => logger.error(message, fields),
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

/** Compatibility alias for error classification used by existing plugin code. */
export const detectErrorType = detectRecoveryErrorType

/** Compatibility alias for recoverable-error checks used by existing plugin code. */
export const isRecoverableError = isRecoverableSessionError

export { getRecoverySuccessToast, getRecoveryToastContent }
export type { RecoveryRequest }
