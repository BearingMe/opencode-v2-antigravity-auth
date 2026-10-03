/** The log levels supported by the plugin's logger adapters. */
export type LogLevel = "debug" | "info" | "warn" | "error"

/** A single log event before an adapter sends it to a sink. */
export interface LogEntry {
  service: string
  level: LogLevel
  message: string
  extra?: Record<string, unknown>
}

/** The methods shared by module-scoped logger instances. */
export interface Logger {
  debug(message: string, extra?: Record<string, unknown>): void
  info(message: string, extra?: Record<string, unknown>): void
  warn(message: string, extra?: Record<string, unknown>): void
  error(message: string, extra?: Record<string, unknown>): void
}

/** Receives a log event for an adapter-specific destination. */
export type LogSink = (entry: LogEntry) => void

/**
 * Creates a logger that sends each event to the provided sinks in order.
 *
 * @example `createLogger("antigravity.request", [writeToConsole])`
 */
export function createLogger(service: string, sinks: readonly LogSink[]): Logger {
  /** Builds one event and forwards it to every configured sink. */
  const log = (level: LogLevel, message: string, extra?: Record<string, unknown>): void => {
    const entry: LogEntry = { service, level, message, extra }
    for (const sink of sinks) {
      sink(entry)
    }
  }

  return {
    debug: (message, extra) => log("debug", message, extra),
    info: (message, extra) => log("info", message, extra),
    warn: (message, extra) => log("warn", message, extra),
    error: (message, extra) => log("error", message, extra),
  }
}

/**
 * Writes arguments through the console method matching the log level.
 *
 * @example `writeConsoleLog("warn", "[service]", "slow response")`
 */
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
