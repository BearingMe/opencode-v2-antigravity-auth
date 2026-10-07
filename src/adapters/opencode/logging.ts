import type { LogEntry } from "../../platform/logging/index.js"
import type { LogLevel } from "../../platform/logging/index.js"
import type { PluginClient } from "./types.js"

const ENV_CONSOLE_LOG = "OPENCODE_ANTIGRAVITY_CONSOLE_LOG"

let client: PluginClient | null = null
/** Defaults host TUI logging off until configuration supplies its preference. */
let tuiLoggingEnabled: () => boolean = () => false

/** Configures the OpenCode-bound destinations without coupling them to logger creation. */
export function configureOpenCodeLogging(nextClient: PluginClient, isTuiEnabled: () => boolean): void {
  client = nextClient
  tuiLoggingEnabled = isTuiEnabled
}

/** Sends one structured event to enabled host and console destinations. */
export function writeOpenCodeLog(entry: LogEntry): void {
  if (tuiLoggingEnabled()) writeToOpenCodeTui(entry)

  if (isConsoleLoggingEnabled()) {
    const prefix = `[${entry.service}]`
    const args = entry.extra ? [prefix, entry.message, entry.extra] : [prefix, entry.message]
    writeConsoleLog(entry.level, ...args)
  }
}

/** Attempts a host TUI write without allowing host failures to affect the caller. */
function writeToOpenCodeTui(entry: LogEntry): void {
  try {
    const app = client?.app
    if (!app || typeof app.log !== "function") return
    void app
      .log({
        body: {
          service: entry.service,
          level: entry.level,
          message: entry.message,
          extra: entry.extra,
        },
      })
      .catch(() => undefined)
  } catch {
    return
  }
}

/** Writes arguments through the console method matching the host log level. */
export function writeConsoleLog(level: LogLevel, ...args: unknown[]): void {
  switch (level) {
    case "debug":
      console.debug(...args)
      break
    case "info":
      console.info(...args)
      break
    case "warn":
      console.warn(...args)
      break
    case "error":
      console.error(...args)
      break
  }
}

/** Checks the plugin's independent console-log override. */
function isConsoleLoggingEnabled(): boolean {
  const flag = process.env[ENV_CONSOLE_LOG]
  return flag === "1" || flag?.toLowerCase() === "true"
}
