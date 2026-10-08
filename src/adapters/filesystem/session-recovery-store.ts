import { existsSync, mkdirSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import type {
  RecoveryMessageRecord,
  RecoveryPartRecord,
  RecoveryStoragePort,
} from "../../modules/session-recovery/index.js"

export const THINKING_TYPES = new Set(["thinking", "redacted_thinking", "reasoning"])
export const META_TYPES = new Set(["step-start", "step-finish"])

/** Resolves the current platform's OpenCode data directory. */
function getXdgData(): string {
  if (process.platform === "win32") return process.env.APPDATA || join(homedir(), "AppData", "Roaming")
  return process.env.XDG_DATA_HOME || join(homedir(), ".local", "share")
}

export const OPENCODE_STORAGE = join(getXdgData(), "opencode", "storage")
export const MESSAGE_STORAGE = join(OPENCODE_STORAGE, "message")
export const PART_STORAGE = join(OPENCODE_STORAGE, "part")

// =============================================================================
// Directory Helpers
// =============================================================================

/** Finds a session's message directory across OpenCode's supported layouts. */
export function getMessageDir(sessionID: string): string {
  if (!existsSync(MESSAGE_STORAGE)) return ""

  const directPath = join(MESSAGE_STORAGE, sessionID)
  if (existsSync(directPath)) {
    return directPath
  }

  // Search in subdirectories
  try {
    for (const dir of readdirSync(MESSAGE_STORAGE)) {
      const sessionPath = join(MESSAGE_STORAGE, dir, sessionID)
      if (existsSync(sessionPath)) {
        return sessionPath
      }
    }
  } catch {
    // Ignore read errors
  }

  return ""
}

// =============================================================================
// Message Reading
// =============================================================================

/** Reads and chronologically orders message metadata for a session. */
export function readMessages(sessionID: string): RecoveryMessageRecord[] {
  const messageDir = getMessageDir(sessionID)
  if (!messageDir || !existsSync(messageDir)) return []

  const messages: RecoveryMessageRecord[] = []
  try {
    for (const file of readdirSync(messageDir)) {
      if (!file.endsWith(".json")) continue
      try {
        const content = readFileSync(join(messageDir, file), "utf-8")
        messages.push(JSON.parse(content))
      } catch {
        continue
      }
    }
  } catch {
    return []
  }

  return messages.sort((a, b) => {
    const aTime = a.time?.created ?? 0
    const bTime = b.time?.created ?? 0
    if (aTime !== bTime) return aTime - bTime
    return a.id.localeCompare(b.id)
  })
}

// =============================================================================
// Part Reading
// =============================================================================

/** Reads the persisted parts associated with one message. */
export function readParts(messageID: string): RecoveryPartRecord[] {
  const partDir = join(PART_STORAGE, messageID)
  if (!existsSync(partDir)) return []

  const parts: RecoveryPartRecord[] = []
  try {
    for (const file of readdirSync(partDir)) {
      if (!file.endsWith(".json")) continue
      try {
        const content = readFileSync(join(partDir, file), "utf-8")
        parts.push(JSON.parse(content))
      } catch {
        continue
      }
    }
  } catch {
    return []
  }

  return parts
}

// =============================================================================
// Content Helpers
// =============================================================================

/** Reports whether a persisted part contributes user-visible or tool content. */
export function hasContent(part: RecoveryPartRecord): boolean {
  if (THINKING_TYPES.has(part.type)) return false
  if (META_TYPES.has(part.type)) return false

  if (part.type === "text") {
    return !!part.text?.trim()
  }

  if (part.type === "tool" || part.type === "tool_use") {
    return true
  }

  if (part.type === "tool_result") {
    return true
  }

  return false
}

/** Checks whether a stored message contains content rather than metadata. */
export function messageHasContent(messageID: string): boolean {
  const parts = readParts(messageID)
  return parts.some(hasContent)
}

// =============================================================================
// Thinking Block Recovery
// =============================================================================

/** Finds assistant messages that contain persisted thinking parts. */
export function findMessagesWithThinkingBlocks(sessionID: string): string[] {
  const messages = readMessages(sessionID)
  const result: string[] = []

  for (const msg of messages) {
    if (msg.role !== "assistant") continue

    const parts = readParts(msg.id)
    const hasThinking = parts.some((p) => THINKING_TYPES.has(p.type))
    if (hasThinking) {
      result.push(msg.id)
    }
  }

  return result
}

/** Finds assistant messages whose first stored part is not a thinking part. */
export function findMessagesWithOrphanThinking(sessionID: string): string[] {
  const messages = readMessages(sessionID)
  const result: string[] = []

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i]
    if (!msg || msg.role !== "assistant") continue

    const parts = readParts(msg.id)
    if (parts.length === 0) continue

    const sortedParts = [...parts].sort((a, b) => a.id.localeCompare(b.id))
    const firstPart = sortedParts[0]
    if (!firstPart) continue

    const firstIsThinking = THINKING_TYPES.has(firstPart.type)

    // If first part is not thinking, it's orphan
    if (!firstIsThinking) {
      result.push(msg.id)
    }
  }

  return result
}

/** Persists a synthetic leading thinking part for one message. */
export function prependThinkingPart(sessionID: string, messageID: string): boolean {
  const partDir = join(PART_STORAGE, messageID)

  try {
    if (!existsSync(partDir)) {
      mkdirSync(partDir, { recursive: true })
    }

    const partId = "prt_0000000000_thinking"
    const part = {
      id: partId,
      sessionID,
      messageID,
      type: "thinking",
      thinking: "",
      synthetic: true,
    }

    writeFileSync(join(partDir, `${partId}.json`), JSON.stringify(part, null, 2))
    return true
  } catch {
    return false
  }
}

/** Removes persisted thinking parts from one message. */
export function stripThinkingParts(messageID: string): boolean {
  const partDir = join(PART_STORAGE, messageID)
  if (!existsSync(partDir)) return false

  let anyRemoved = false
  try {
    for (const file of readdirSync(partDir)) {
      if (!file.endsWith(".json")) continue
      try {
        const filePath = join(partDir, file)
        const content = readFileSync(filePath, "utf-8")
        const part = JSON.parse(content) as RecoveryPartRecord
        if (THINKING_TYPES.has(part.type)) {
          unlinkSync(filePath)
          anyRemoved = true
        }
      } catch {
        continue
      }
    }
  } catch {
    return false
  }

  return anyRemoved
}

// =============================================================================
// Empty Message Recovery
// =============================================================================

/** Resolves an indexed message that needs a leading thinking part. */
export function findMessageByIndexNeedingThinking(sessionID: string, targetIndex: number): string | null {
  const messages = readMessages(sessionID)

  if (targetIndex < 0 || targetIndex >= messages.length) return null

  const targetMsg = messages[targetIndex]
  if (!targetMsg || targetMsg.role !== "assistant") return null

  const parts = readParts(targetMsg.id)
  if (parts.length === 0) return null

  const sortedParts = [...parts].sort((a, b) => a.id.localeCompare(b.id))
  const firstPart = sortedParts[0]
  if (!firstPart) return null

  const firstIsThinking = THINKING_TYPES.has(firstPart.type)

  if (!firstIsThinking) {
    return targetMsg.id
  }

  return null
}

/**
 * Implements the recovery storage contract using OpenCode's current data layout.
 *
 * @example `fileRecoveryStorage.readParts(messageID)`
 */
export const fileRecoveryStorage = {
  readMessages,
  readParts,
  messageHasContent,
  findMessagesWithThinkingBlocks,
  findMessagesWithOrphanThinking,
  findMessageByIndexNeedingThinking,
  prependThinkingPart,
  stripThinkingParts,
} satisfies RecoveryStoragePort
