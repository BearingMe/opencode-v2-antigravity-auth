/** Log levels supported by destination adapters. */
export type LogLevel = "debug" | "info" | "warn" | "error"

/** A log event before a destination adapter receives it. */
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
  /** Creates one structured event and forwards it to each configured destination. */
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
