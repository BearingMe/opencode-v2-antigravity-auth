import type { RecoveryErrorType } from "./index.js"

/** Extracts a normalized message from the error shapes used by SDK responses. */
function getErrorMessage(error: unknown): string {
  if (!error) return ""
  if (typeof error === "string") return error.toLowerCase()

  const errorObject = error as Record<string, unknown>
  const paths = [errorObject.data, errorObject.error, errorObject, (errorObject.data as Record<string, unknown>)?.error]

  for (const value of paths) {
    if (value && typeof value === "object") {
      const message = (value as Record<string, unknown>).message
      if (typeof message === "string" && message.length > 0) return message.toLowerCase()
    }
  }

  try {
    return JSON.stringify(error).toLowerCase()
  } catch {
    return ""
  }
}

/** Returns the message index embedded in storage-validation errors. */
export function extractRecoveryMessageIndex(error: unknown): number | null {
  const match = getErrorMessage(error).match(/messages\.(\d+)/)
  if (!match?.[1]) return null
  return Number.parseInt(match[1], 10)
}

/** Classifies errors whose persisted conversation can be repaired safely. */
export function detectRecoveryErrorType(error: unknown): RecoveryErrorType | null {
  const message = getErrorMessage(error)
  const expectedThinkingOrder =
    (message.includes("expected thinking") || message.includes("expected a thinking")) && message.includes("found")

  if (message.includes("tool_use") && message.includes("tool_result")) return "tool_result_missing"

  if (
    message.includes("thinking") &&
    (message.includes("first block") ||
      message.includes("must start with") ||
      message.includes("preceeding") ||
      message.includes("preceding") ||
      expectedThinkingOrder)
  ) {
    return "thinking_block_order"
  }

  if (message.includes("thinking is disabled") && message.includes("cannot contain")) {
    return "thinking_disabled_violation"
  }

  return null
}

/** Reports whether an error matches one of the supported session repairs. */
export function isRecoverableSessionError(error: unknown): boolean {
  return detectRecoveryErrorType(error) !== null
}
