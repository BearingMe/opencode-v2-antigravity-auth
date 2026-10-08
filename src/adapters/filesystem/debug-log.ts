import { constants } from "node:fs"
import { createWriteStream, fchmodSync, mkdirSync, openSync, readdirSync, statSync, unlinkSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import { env } from "node:process"
import { ensureGitignoreSync, type GitignoreUpdate } from "./config-directory.js"

const MAX_DEBUG_LOG_FILES = 25

/** A destination for timestamped debug-file lines. */
export interface DebugFileDestination {
  filePath: string | undefined
  writeLine: (line: string) => void
  close: () => Promise<void>
}

/** Creates a timestamped append writer, or a no-op when the destination cannot be opened. */
function createTimestampedFileWriter(filePath?: string): Pick<DebugFileDestination, "writeLine" | "close"> {
  if (!filePath) return { writeLine: () => {}, close: async () => {} }

  try {
    let stream: ReturnType<typeof createWriteStream>
    if (process.platform === "win32") {
      stream = createWriteStream(filePath, { flags: "a", mode: 0o600 })
    } else {
      const fd = openSync(
        filePath,
        constants.O_WRONLY | constants.O_APPEND | constants.O_CREAT | constants.O_NOFOLLOW,
        0o600,
      )
      fchmodSync(fd, 0o600)
      stream = createWriteStream(filePath, { fd, autoClose: true })
    }
    stream.on("error", () => {
      // Debug output is best effort and must not interfere with inference.
    })
    return {
      writeLine: (line) => {
        stream.write(`[${new Date().toISOString()}] ${line}\n`)
      },
      close: () =>
        new Promise((resolve) => {
          if (stream.closed) {
            resolve()
            return
          }
          stream.once("close", resolve)
          stream.end()
        }),
    }
  } catch {
    return { writeLine: () => {}, close: async () => {} }
  }
}

/** Returns the operating-system config directory used for plugin-owned state. */
function getConfigDir(): string {
  if (process.platform === "win32") {
    return join(env.APPDATA || join(homedir(), "AppData", "Roaming"), "opencode")
  }
  return join(env.XDG_CONFIG_HOME || join(homedir(), ".config"), "opencode")
}

/** Creates the file destination and applies the existing bounded log retention policy. */
export function createDebugFileDestination(
  enabled: boolean,
  customLogDir?: string,
  onGitignoreUpdate?: (outcome: GitignoreUpdate) => void,
): DebugFileDestination {
  if (!enabled) {
    const writer = createTimestampedFileWriter()
    return { filePath: undefined, ...writer }
  }

  const configDir = getConfigDir()
  const logsDir = customLogDir || join(configDir, "antigravity-logs")
  let logDirectoryReady = true
  try {
    mkdirSync(logsDir, { recursive: true })
  } catch {
    logDirectoryReady = false
  }

  cleanupOldLogs(logsDir)
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-")
  const filePath = join(logsDir, `antigravity-debug-${timestamp}.log`)
  onGitignoreUpdate?.(ensureGitignoreSync(configDir))

  return { filePath, ...createTimestampedFileWriter(logDirectoryReady ? filePath : undefined) }
}

/** Removes older matching debug logs while keeping the newest configured count. */
function cleanupOldLogs(logsDir: string): void {
  try {
    const files = readdirSync(logsDir)
      .filter((file) => file.startsWith("antigravity-debug-") && file.endsWith(".log"))
      .map((file) => join(logsDir, file))

    if (files.length <= MAX_DEBUG_LOG_FILES) return

    const sortedFiles = files
      .map((file) => ({ file, mtime: statSync(file).mtimeMs }))
      .sort((left, right) => right.mtime - left.mtime)

    for (const { file } of sortedFiles.slice(MAX_DEBUG_LOG_FILES)) {
      try {
        unlinkSync(file)
      } catch {
        // Retention is best effort; a locked file must not disable logging.
        continue
      }
    }
  } catch {
    // Missing or unreadable directories simply start with no retained logs.
    return
  }
}
