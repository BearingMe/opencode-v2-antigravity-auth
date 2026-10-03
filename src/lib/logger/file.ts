import { createWriteStream } from "node:fs"

/** Writes one timestamped line to an append-only log file. */
export type LogWriter = (line: string) => void

/**
 * Creates a timestamped append writer, or a no-op writer when no path is set.
 * File and stream errors are ignored, matching the debug log's best-effort policy.
 */
export function createTimestampedFileWriter(filePath?: string): LogWriter {
  if (!filePath) {
    return () => {}
  }

  try {
    const stream = createWriteStream(filePath, { flags: "a" })
    stream.on("error", () => {})
    return (line: string) => {
      const timestamp = new Date().toISOString()
      stream.write(`[${timestamp}] ${line}\n`)
    }
  } catch {
    return () => {}
  }
}
