/** Message metadata needed by recovery logic, independent of its storage format. */
export interface RecoveryMessageRecord {
  id: string
  sessionID: string
  role: "user" | "assistant"
  parentID?: string
  time?: { created: number; completed?: number }
  error?: unknown
}

/** Part data needed by recovery logic, without a file path or SDK type. */
export interface RecoveryPartRecord {
  id: string
  sessionID: string
  messageID: string
  type: string
  text?: string
  callID?: string
  tool?: string
  state?: {
    status: "pending" | "running" | "completed" | "error"
    input: Record<string, unknown>
    output?: string
    error?: string
  }
}

/** Message and part operations required by session repair. */
export interface RecoveryStoragePort {
  readMessages(sessionID: string): RecoveryMessageRecord[]
  readParts(messageID: string): RecoveryPartRecord[]
  messageHasContent(messageID: string): boolean
  findMessagesWithThinkingBlocks(sessionID: string): string[]
  findMessagesWithOrphanThinking(sessionID: string): string[]
  findMessageByIndexNeedingThinking(sessionID: string, targetIndex: number): string | null
  prependThinkingPart(sessionID: string, messageID: string): boolean
  stripThinkingParts(messageID: string): boolean
}
