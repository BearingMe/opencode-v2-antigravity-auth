import { Message } from "@opencode/ai"
import type {
  RecoveryConversationMessage,
  RecoverySessionPort,
  RecoveryToolResultBatch,
  SessionRecoveryApi,
} from "../../modules/session-recovery/index.js"
import { createSessionRecoveryPolicy } from "../../modules/session-recovery/index.js"
import { fileRecoveryStorage } from "../filesystem/session-recovery-store.js"
import { logToast } from "../../plugin/debug.js"
import { createLogger } from "../../plugin/logger.js"
import type { AntigravityConfig } from "./config/index.js"
import type { PluginClient } from "./types.js"

/** Converts the V2 session-context message shape to recovery's small record. */
function normalizeRecoveryMessages(value: unknown): RecoveryConversationMessage[] {
  if (!Array.isArray(value)) return []

  return value.flatMap((entry): RecoveryConversationMessage[] => {
    if (!entry || typeof entry !== "object") return []
    const message = entry as Record<string, unknown>
    const info = message.info && typeof message.info === "object" ? (message.info as Record<string, unknown>) : message
    const roleValue = info.role ?? info.type
    if (roleValue !== "user" && roleValue !== "assistant") return []

    const modelValue =
      info.model && typeof info.model === "object" ? (info.model as Record<string, unknown>) : undefined
    const providerID = typeof modelValue?.providerID === "string" ? modelValue.providerID : undefined
    const modelID =
      typeof modelValue?.modelID === "string"
        ? modelValue.modelID
        : typeof modelValue?.id === "string"
          ? modelValue.id
          : undefined

    return [
      {
        info: {
          id: typeof info.id === "string" ? info.id : undefined,
          role: roleValue,
          agent: typeof info.agent === "string" ? info.agent : undefined,
          model: providerID && modelID ? { providerID, modelID } : undefined,
        },
        parts: Array.isArray(message.parts) ? (message.parts as RecoveryConversationMessage["parts"]) : undefined,
      },
    ]
  })
}

/** Maps OpenCode session methods to the host-neutral recovery session port. */
export function createOpenCodeRecoverySessionPort(client: PluginClient, directory: string): RecoverySessionPort {
  return {
    /** Aborts the active generation for a session before applying repair. */
    abort: async (sessionID) => {
      await client.session.abort({ path: { id: sessionID } })
    },
    /** Loads host messages in the project directory used by the current plugin. */
    messages: async (sessionID) => {
      const response = await client.session.messages({ path: { id: sessionID }, query: { directory } })
      return normalizeRecoveryMessages((response as { data?: unknown }).data)
    },
    /** Resumes a repaired thinking turn with the original agent and model. */
    resume: async ({ sessionID, text, agent, model }) => {
      await client.session.prompt({
        path: { id: sessionID },
        body: { parts: [{ type: "text", text }], agent, model },
        query: { directory },
      })
    },
    /** Displays recovery notices without leaking the host toast schema upstream. */
    showNotice: async ({ title, message, variant }) => {
      await client.tui.showToast({ body: { title, message, variant } })
    },
  }
}

/** Composes session-recovery policy with OpenCode and filesystem adapters. */
export function createOpenCodeSessionRecovery(
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

/** Inserts planned cancelled results into OpenCode's mutable model history. */
export function applyOpenCodeToolResultBatches(
  messages: Message[],
  batches: readonly RecoveryToolResultBatch[],
): number {
  let resultCount = 0
  for (const batch of [...batches].sort((left, right) => right.afterMessageIndex - left.afterMessageIndex)) {
    const toolResults = batch.results.map((result) =>
      Message.tool({
        id: result.toolUseId,
        name: result.toolName,
        ...(result.namespace ? { namespace: result.namespace } : {}),
        result: result.content,
        resultType: "text",
      }),
    )
    messages.splice(batch.afterMessageIndex + 1, 0, ...toolResults)
    resultCount += toolResults.length
  }
  return resultCount
}
