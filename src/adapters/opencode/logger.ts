import { configureOpenCodeLogging, writeOpenCodeLog } from "./logging.js"
import { createLogger as createPlatformLogger, type Logger } from "../../platform/logging/index.js"
import { isDebugTuiEnabled } from "./debug.js"
import type { PluginClient } from "./types.js"

/** Shared log contract re-exported for the OpenCode adapter. */
export type { Logger } from "../../platform/logging/index.js"

/**
 * Initialize the logger with the plugin client.
 * Must be called during plugin initialization to enable TUI logging.
 */
export function initLogger(client: PluginClient): void {
  configureOpenCodeLogging(client, isDebugTuiEnabled)
}

/**
 * Creates a logger for a plugin module using the configured host destinations.
 *
 * @example `createLogger("refresh-queue").warn("Token expired", { accountIndex: 0 })`
 */
export function createLogger(module: string): Logger {
  return createPlatformLogger(`antigravity.${module}`, [writeOpenCodeLog])
}
