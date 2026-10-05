import type { RecoveryErrorType as SessionRecoveryErrorType } from "../../modules/session-recovery/index.js"

/** Thinking-part labels retained for callers of the former recovery types path. */
export type ThinkingPartType = "thinking" | "redacted_thinking" | "reasoning"

/** Metadata-part labels retained for callers of the former recovery types path. */
export type MetaPartType = "step-start" | "step-finish"

/** Content-part labels retained for callers of the former recovery types path. */
export type ContentPartType = "text" | "tool" | "tool_use" | "tool_result"

/** Persisted message metadata used by the former filesystem recovery adapter. */
export interface StoredMessageMeta {
  id: string
  sessionID: string
  role: "user" | "assistant"
  parentID?: string
  time?: { created: number; completed?: number }
  error?: unknown
}

/** Persisted text part shape retained for compatibility. */
export interface StoredTextPart {
  id: string
  sessionID: string
  messageID: string
  type: "text"
  text: string
  synthetic?: boolean
  ignored?: boolean
}

/** Persisted tool part shape retained for compatibility. */
export interface StoredToolPart {
  id: string
  sessionID: string
  messageID: string
  type: "tool"
  callID: string
  tool: string
  state: {
    status: "pending" | "running" | "completed" | "error"
    input: Record<string, unknown>
    output?: string
    error?: string
  }
}

/** Persisted reasoning part shape retained for compatibility. */
export interface StoredReasoningPart {
  id: string
  sessionID: string
  messageID: string
  type: "reasoning"
  text: string
}

/** Persisted step part shape retained for compatibility. */
export interface StoredStepPart {
  id: string
  sessionID: string
  messageID: string
  type: "step-start" | "step-finish"
}

/** Persisted part union retained for compatibility with prior storage imports. */
export type StoredPart =
  | StoredTextPart
  | StoredToolPart
  | StoredReasoningPart
  | StoredStepPart
  | {
      id: string
      sessionID: string
      messageID: string
      type: string
      [key: string]: unknown
    }

/** Message part shape used by the former session API adapter. */
export interface MessagePart {
  type: string
  id?: string
  text?: string
  thinking?: string
  name?: string
  input?: Record<string, unknown>
  callID?: string
}

/** Session message response shape retained for existing callers. */
export interface MessageData {
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
  parts?: MessagePart[]
}

/** Error event shape retained for callers of the legacy recovery hook. */
export interface MessageInfo {
  id?: string
  role?: string
  sessionID?: string
  parentID?: string
  error?: unknown
}

/** Resume options retained for callers of the former recovery helper. */
export interface ResumeConfig {
  sessionID: string
  agent?: string
  model?: { providerID: string; modelID: string }
}

/** Recoverable error categories retained for legacy imports. */
export type RecoveryErrorType = SessionRecoveryErrorType | null

/** Tool-call part shape retained for callers of the former repair helper. */
export interface ToolUsePart {
  type: "tool_use"
  id: string
  name: string
  input: Record<string, unknown>
}

/** Tool-result part shape retained for callers of the former repair helper. */
export interface ToolResultPart {
  type: "tool_result"
  tool_use_id: string
  content: string
}
