import {
  createLogger as createLibraryLogger,
  writeConsoleLog,
  type Logger,
  type LogEntry,
} from "../lib/logger/index.js"
import { isDebugTuiEnabled } from "./debug"
import { isTruthyFlag } from "./logging-utils"
import type { PluginClient } from "./types"

export type { Logger } from "../lib/logger/index.js"

const ENV_CONSOLE_LOG = "OPENCODE_ANTIGRAVITY_CONSOLE_LOG"

let _client: PluginClient | null = null

/**
 * Check if console logging is enabled via environment variable.
 */
function isConsoleLogEnabled(): boolean {
  return isTruthyFlag(process.env[ENV_CONSOLE_LOG])
}

/**
 * Initialize the logger with the plugin client.
 * Must be called during plugin initialization to enable TUI logging.
 */
export function initLogger(client: PluginClient): void {
  _client = client
}

/**
 * Sends an event to the currently enabled plugin logging destinations.
 * TUI and console output remain independently controlled by their existing flags.
 */
function dispatchLogEntry(entry: LogEntry): void {
  if (isDebugTuiEnabled()) {
    const app = _client?.app
    if (app && typeof app.log === "function") {
      app
        .log({
          body: {
            service: entry.service,
            level: entry.level,
            message: entry.message,
            extra: entry.extra,
          },
        })
        .catch(() => {
          // TUI logging is best effort; a failed host write must not affect the caller.
        })
    }
  }

  if (isConsoleLogEnabled()) {
    const prefix = `[${entry.service}]`
    const args = entry.extra ? [prefix, entry.message, entry.extra] : [prefix, entry.message]
    writeConsoleLog(entry.level, ...args)
  }
}

/**
 * Create a logger instance for a specific module.
 *
 * @example
 * ```typescript
 * const log = createLogger("refresh-queue");
 * log.debug("Checking tokens", { count: 5 });
 * log.warn("Token expired", { accountIndex: 0 });
 * ```
 */
export function createLogger(module: string): Logger {
  let logger: Logger | undefined
  /** Defers library logger creation until the first log call. */
  const getLogger = (): Logger => {
    if (!logger) {
      logger = createLibraryLogger(`antigravity.${module}`, [dispatchLogEntry])
    }
    return logger
  }

  return {
    debug: (message, extra) => getLogger().debug(message, extra),
    info: (message, extra) => getLogger().info(message, extra),
    warn: (message, extra) => getLogger().warn(message, extra),
    error: (message, extra) => getLogger().error(message, extra),
  }
}
