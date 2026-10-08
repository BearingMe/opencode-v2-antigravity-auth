import { debugLogToFile } from "../../debug.js"

const AUTO_UPDATE_LOG_PREFIX = "[auto-update-checker]"

/** Adds the stable auto-update prefix used by its diagnostic log entries. */
export function formatAutoUpdateLogMessage(message: string): string {
  return `${AUTO_UPDATE_LOG_PREFIX} ${message}`
}

/** Writes an update-check diagnostic through the plugin's debug destination. */
export function logAutoUpdate(message: string): void {
  debugLogToFile(formatAutoUpdateLogMessage(message))
}
