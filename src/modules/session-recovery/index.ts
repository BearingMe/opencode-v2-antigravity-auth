import type { RecoveryStoragePort } from "./storage.js"

export type { RecoveryMessageRecord, RecoveryPartRecord, RecoveryStoragePort } from "./storage.js"

/** Error categories that support automatic session repair. */
export type RecoveryErrorType = "tool_result_missing" | "thinking_block_order" | "thinking_disabled_violation"

/** Minimal error-event data accepted by session recovery. */
export interface RecoveryRequest {
  id?: string
  role?: string
  sessionID?: string
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
  content: string
}

/** Inputs required from the host boundary without exposing its client type. */
export interface RecoverySessionPort {
  abort(sessionID: string): Promise<void>
  messages(sessionID: string): Promise<RecoveryConversationMessage[]>
  injectToolResults(sessionID: string, results: readonly RecoveryToolResult[]): Promise<void>
  resume(input: { sessionID: string; agent?: string; model?: { providerID: string; modelID: string } }): Promise<void>
  showNotice(input: { title: string; message: string; variant: "warning" }): Promise<void>
}

/** Dependencies required by a session-recovery implementation. */
export interface SessionRecoveryPorts {
  storage: RecoveryStoragePort
  session: RecoverySessionPort
}

/** Behavior exposed to the host adapter and request pipeline. */
export interface SessionRecoveryApi {
  detectErrorType(error: unknown): RecoveryErrorType | null
  isRecoverableError(error: unknown): boolean
  handleSessionRecovery(info: RecoveryRequest): Promise<boolean>
}
