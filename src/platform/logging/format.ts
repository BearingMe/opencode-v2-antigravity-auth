/** Converts an unknown failure into a log-safe string. */
export function formatErrorForLog(error: unknown): string {
  if (error instanceof Error) return error.stack ?? error.message
  try {
    return JSON.stringify(error)
  } catch {
    return String(error)
  }
}

/** Limits logged text while stating how much content was omitted. */
export function truncateTextForLog(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text
  return `${text.slice(0, maxChars)}... (truncated ${text.length - maxChars} chars)`
}

/** Produces a bounded text preview without serializing binary or form payloads. */
export function formatBodyPreviewForLog(body: BodyInit | null | undefined, maxChars: number): string | undefined {
  if (body == null) return undefined
  if (typeof body === "string") return truncateTextForLog(body, maxChars)
  if (body instanceof URLSearchParams) return truncateTextForLog(body.toString(), maxChars)
  if (typeof Blob !== "undefined" && body instanceof Blob) return `[Blob size=${body.size}]`
  if (typeof FormData !== "undefined" && body instanceof FormData) return "[FormData payload omitted]"
  return `[${body.constructor?.name ?? typeof body} payload omitted]`
}
