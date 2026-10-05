import { detectRecoveryErrorType, extractRecoveryMessageIndex, isRecoverableSessionError } from "./detection.js"
import type {
  RecoveryConversationMessage,
  RecoveryErrorType,
  RecoveryModelMessage,
  RecoveryRequest,
  RecoveryToolResultBatch,
  SessionRecoveryApi,
  SessionRecoveryPorts,
} from "./index.js"

const RECOVERY_RESUME_TEXT = "[session recovered - continuing previous task]"
const TOOL_CANCELLED_TEXT = "Operation cancelled by user (ESC pressed)"

const TOAST_TITLES: Record<Exclude<RecoveryErrorType, null>, string> = {
  tool_result_missing: "Tool Crash Recovery",
  thinking_block_order: "Thinking Block Recovery",
  thinking_disabled_violation: "Thinking Strip Recovery",
}

const TOAST_MESSAGES: Record<Exclude<RecoveryErrorType, null>, string> = {
  tool_result_missing: "Injecting cancelled tool results...",
  thinking_block_order: "Fixing message structure...",
  thinking_disabled_violation: "Stripping thinking blocks...",
}

/** Returns the warning shown for a supported repair, or a generic fallback. */
export function getRecoveryToastContent(errorType: RecoveryErrorType | null): { title: string; message: string } {
  if (!errorType) return { title: "Session Recovery", message: "Attempting to recover session..." }
  return {
    title: TOAST_TITLES[errorType] ?? "Session Recovery",
    message: TOAST_MESSAGES[errorType] ?? "Attempting to recover session...",
  }
}

/** Returns the success notice displayed after recovery completes. */
export function getRecoverySuccessToast(): { title: string; message: string } {
  return { title: "Session Recovered", message: "Continuing where you left off..." }
}

/** Records a toast without allowing diagnostics to interrupt a repair. */
function recordToast(ports: SessionRecoveryPorts, message: string): void {
  try {
    ports.logger.toast(message, "warning")
  } catch {
    // Toast diagnostics are best effort and must not prevent recovery.
  }
}

/** Displays a warning without letting host UI failures escape recovery. */
async function showWarningNotice(
  ports: SessionRecoveryPorts,
  input: { title: string; message: string },
): Promise<void> {
  try {
    await ports.session.showNotice({ ...input, variant: "warning" })
  } catch {
    // The debug log is the record when the host cannot display a notice.
  }
}

/** Creates session-error recovery without coupling repair rules to the host. */
export function createSessionRecoveryPolicy(
  ports: SessionRecoveryPorts,
  config: { enabled: boolean; autoResume: boolean; resumeText?: string },
): SessionRecoveryApi | null {
  if (!config.enabled) return null

  const processingErrors = new Set<string>()
  let onAbortCallback: ((sessionID: string) => void) | null = null
  let onRecoveryCompleteCallback: ((sessionID: string) => void) | null = null

  /** Plans host-neutral tool results for calls missing from the outgoing context. */
  function findMissingToolResultBatches(messages: readonly RecoveryModelMessage[]): RecoveryToolResultBatch[] {
    const completedCalls = new Set<string>()
    const seenCalls = new Set<string>()
    const batches: RecoveryToolResultBatch[] = []

    for (let afterMessageIndex = messages.length - 1; afterMessageIndex >= 0; afterMessageIndex -= 1) {
      const message = messages[afterMessageIndex]
      if (!message) continue

      if (message.role === "assistant") {
        const results = message.content.flatMap((part) => {
          if (
            part.type !== "tool-call" ||
            !part.id ||
            !part.name ||
            part.providerExecuted === true ||
            completedCalls.has(part.id) ||
            seenCalls.has(part.id)
          ) {
            return []
          }
          seenCalls.add(part.id)
          return [
            {
              toolUseId: part.id,
              toolName: part.name,
              ...(part.namespace ? { namespace: part.namespace } : {}),
              content: TOOL_CANCELLED_TEXT,
            },
          ]
        })

        if (results.length > 0) batches.push({ afterMessageIndex, results })
      } else if (message.role === "tool") {
        for (const part of message.content) {
          if (part.type === "tool-result" && part.id) completedCalls.add(part.id)
        }
      }
    }

    return batches.reverse()
  }

  /** Records and displays the warning for context-level tool-result repair. */
  async function notifyToolResultRepair(sessionID: string, resultCount: number): Promise<void> {
    const toast = getRecoveryToastContent("tool_result_missing")
    ports.logger.debug("Inserted cancelled results for interrupted tool calls", { sessionID, resultCount })
    recordToast(ports, `${toast.title}: ${toast.message}`)
    await showWarningNotice(ports, toast)
  }

  /** Repairs thinking order at the indexed message, then falls back to orphan parts. */
  function recoverThinkingBlockOrder(sessionID: string, error: unknown): boolean {
    const targetIndex = extractRecoveryMessageIndex(error)
    if (targetIndex !== null) {
      const messageID = ports.storage.findMessageByIndexNeedingThinking(sessionID, targetIndex)
      if (messageID) return ports.storage.prependThinkingPart(sessionID, messageID)
    }

    const orphanMessages = ports.storage.findMessagesWithOrphanThinking(sessionID)
    let anySuccess = false
    for (const messageID of orphanMessages) {
      if (ports.storage.prependThinkingPart(sessionID, messageID)) anySuccess = true
    }
    return anySuccess
  }

  /** Removes persisted thinking parts after a model rejects thinking content. */
  function recoverThinkingDisabledViolation(sessionID: string): boolean {
    const messages = ports.storage.findMessagesWithThinkingBlocks(sessionID)
    let anySuccess = false
    for (const messageID of messages) {
      if (ports.storage.stripThinkingParts(messageID)) anySuccess = true
    }
    return anySuccess
  }

  /** Selects the last user turn so an opt-in repair can resume with its settings. */
  function findLastUserMessage(messages: RecoveryConversationMessage[]): RecoveryConversationMessage | undefined {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      if (messages[index]?.info?.role === "user") return messages[index]
    }
    return undefined
  }

  /** Finds the latest assistant turn as a V2 fallback for resume settings. */
  function findLastAssistantMessage(messages: RecoveryConversationMessage[]): RecoveryConversationMessage | undefined {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      if (messages[index]?.info?.role === "assistant") return messages[index]
    }
    return undefined
  }

  /** Resumes a thinking repair using the user turn or latest V2 assistant settings. */
  async function resumeThinkingRepair(sessionID: string, messages: RecoveryConversationMessage[]): Promise<void> {
    const userMessage = findLastUserMessage(messages)
    const assistantMessage = findLastAssistantMessage(messages)
    try {
      await ports.session.resume({
        sessionID,
        text: config.resumeText ?? RECOVERY_RESUME_TEXT,
        agent: userMessage?.info?.agent ?? assistantMessage?.info?.agent,
        model: userMessage?.info?.model ?? assistantMessage?.info?.model,
      })
    } catch {
      // A failed optional resume does not undo the persisted repair.
    }
  }

  /** Runs one session-error repair, guarding duplicate in-flight message IDs. */
  async function handleSessionRecovery(info: RecoveryRequest): Promise<boolean> {
    if (!info || info.role !== "assistant" || !info.error) return false

    const errorType = detectRecoveryErrorType(info.error)
    if (!errorType) return false

    const sessionID = info.sessionID
    if (!sessionID) return false

    // Tool results are repaired in the V2 context hook, where the outgoing
    // model history is mutable. A retry callback cannot safely inject them.
    if (errorType === "tool_result_missing") return false

    let assistantMessageID = info.id
    ports.logger.debug("Recovery attempt started", {
      errorType,
      sessionID,
      providedMsgID: assistantMessageID ?? "none",
    })

    onAbortCallback?.(sessionID)
    await ports.session.abort(sessionID).catch(() => {})

    const messages = await ports.session.messages(sessionID)
    if (!assistantMessageID && messages.length > 0) {
      for (let index = messages.length - 1; index >= 0; index -= 1) {
        const message = messages[index]
        if (message?.info?.role === "assistant" && message.info.id) {
          assistantMessageID = message.info.id
          ports.logger.debug("Found assistant message ID from session messages", {
            msgID: assistantMessageID,
            msgIndex: index,
          })
          break
        }
      }
    }

    if (!assistantMessageID) {
      ports.logger.debug("No assistant message ID found, cannot recover")
      return false
    }
    if (processingErrors.has(assistantMessageID)) return false
    processingErrors.add(assistantMessageID)

    try {
      const failedMessage = messages.find((message) => message.info?.id === assistantMessageID)
      if (!failedMessage) return false

      const toast = getRecoveryToastContent(errorType)
      recordToast(ports, `${toast.title}: ${toast.message}`)
      await showWarningNotice(ports, toast)

      let recovered = false
      if (errorType === "thinking_block_order") {
        recovered = recoverThinkingBlockOrder(sessionID, info.error)
        if (recovered && config.autoResume) await resumeThinkingRepair(sessionID, messages)
      } else if (errorType === "thinking_disabled_violation") {
        recovered = recoverThinkingDisabledViolation(sessionID)
        if (recovered && config.autoResume) await resumeThinkingRepair(sessionID, messages)
      }

      return recovered
    } catch (error) {
      ports.logger.error("Recovery failed", { error: String(error) })
      return false
    } finally {
      processingErrors.delete(assistantMessageID)
      onRecoveryCompleteCallback?.(sessionID)
    }
  }

  return {
    detectErrorType: detectRecoveryErrorType,
    isRecoverableError: isRecoverableSessionError,
    handleSessionRecovery,
    findMissingToolResultBatches,
    notifyToolResultRepair,
    setOnAbortCallback: (callback) => {
      onAbortCallback = callback
    },
    setOnRecoveryCompleteCallback: (callback) => {
      onRecoveryCompleteCallback = callback
    },
  }
}
