import type { RecoveryStoragePort } from "./storage.js"

export type { RecoveryMessageRecord, RecoveryPartRecord, RecoveryStoragePort } from "./storage.js"
export { detectRecoveryErrorType, extractRecoveryMessageIndex, isRecoverableSessionError } from "./detection.js"
export {
  analyzeConversationState,
  closeToolLoopForThinking,
  hasPossibleCompactedThinking,
  looksLikeCompactedThinkingTurn,
  needsThinkingRecovery,
} from "./turn-repair.js"
export type { ConversationState } from "./turn-repair.js"
export { createSessionRecoveryPolicy, getRecoverySuccessToast, getRecoveryToastContent } from "./repair.js"

/** Error categories that support automatic session repair. */
export type RecoveryErrorType = "tool_result_missing" | "thinking_block_order" | "thinking_disabled_violation"

/** Minimal error-event data accepted by session recovery. */
export interface RecoveryRequest {
  id?: string
  role?: string
  sessionID?: string
  parentID?: string
  error?: unknown
}

/** Session message shape consumed by repair rules. */
export interface RecoveryConversationMessage {
  info?: {
    id?: string
    role?: string
    sessionID?: string
    parentID?: string
    error?: unknown
    agent?: string
    model?: { providerID: string; modelID: string }
    system?: string
    tools?: Record<string, boolean>
  }
  parts?: Array<{
    type: string
    id?: string
    text?: string
    thinking?: string
    name?: string
    input?: Record<string, unknown>
    callID?: string
  }>
}

/** Synthetic result inserted for a tool call interrupted by a failed turn. */
export interface RecoveryToolResult {
  toolUseId: string
  toolName: string
  namespace?: string
  content: string
}

/** A batch of cancelled results to insert immediately after one assistant message. */
export interface RecoveryToolResultBatch {
  afterMessageIndex: number
  results: RecoveryToolResult[]
}

/** Minimal model-history shape needed to detect calls without tool results. */
export interface RecoveryModelMessage {
  role: string
  content: readonly {
    type: string
    id?: string
    name?: string
    namespace?: string
    providerExecuted?: boolean
  }[]
}

/** Inputs required from the host boundary without exposing its client type. */
export interface RecoverySessionPort {
  abort(sessionID: string): Promise<void>
  messages(sessionID: string): Promise<RecoveryConversationMessage[]>
  resume(input: {
    sessionID: string
    text: string
    agent?: string
    model?: { providerID: string; modelID: string }
  }): Promise<void>
  showNotice(input: { title: string; message: string; variant: "warning" }): Promise<void>
}

/** Diagnostics and toast trace output required by recovery policy. */
export interface RecoveryLoggerPort {
  debug(message: string, context?: Record<string, unknown>): void
  error(message: string, context?: Record<string, unknown>): void
  toast(message: string, variant: "info" | "warning" | "success" | "error"): void
}

/** Dependencies required by a session-recovery implementation. */
export interface SessionRecoveryPorts {
  storage: RecoveryStoragePort
  session: RecoverySessionPort
  logger: RecoveryLoggerPort
}

/** Behavior exposed to the host adapter and request pipeline. */
export interface SessionRecoveryApi {
  detectErrorType(error: unknown): RecoveryErrorType | null
  isRecoverableError(error: unknown): boolean
  handleSessionRecovery(info: RecoveryRequest): Promise<boolean>
  findMissingToolResultBatches(messages: readonly RecoveryModelMessage[]): RecoveryToolResultBatch[]
  notifyToolResultRepair(sessionID: string, resultCount: number): Promise<void>
  setOnAbortCallback(callback: (sessionID: string) => void): void
  setOnRecoveryCompleteCallback(callback: (sessionID: string) => void): void
}
