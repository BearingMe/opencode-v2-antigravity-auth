/**
 * Configuration loader for opencode-v2-antigravity-auth plugin.
 * 
 * Loads config from files.
 * Priority (lowest to highest):
 * 1. Schema defaults
 * 2. User config file
 * 3. Project config file
 * 4. Environment variables (OPENCODE_ANTIGRAVITY_*)
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import type { ZodType } from "zod";
import {
  AccountSelectionStrategySchema,
  AntigravityConfigSchema,
  DEFAULT_CONFIG,
  SchedulingModeSchema,
  ToastScopeSchema,
  type AntigravityConfig,
} from "./schema";
import { createLogger } from "../logger";

const log = createLogger("config");

// =============================================================================
// Path Utilities
// =============================================================================

/**
 * Get the config directory path, with the following precedence:
 * 1. OPENCODE_CONFIG_DIR env var (if set)
 * 2. ~/.config/opencode (all platforms, including Windows)
 */
function getConfigDir(): string {
  // 1. Check for explicit override via env var
  if (process.env.OPENCODE_CONFIG_DIR) {
    return process.env.OPENCODE_CONFIG_DIR;
  }

  // 2. Use ~/.config/opencode on all platforms (including Windows)
  const xdgConfig = process.env.XDG_CONFIG_HOME || join(homedir(), ".config");
  return join(xdgConfig, "opencode");
}

/**
 * Get the user-level config file path.
 */
export function getUserConfigPath(): string {
  return join(getConfigDir(), "antigravity.json");
}

/**
 * Get the project-level config file path.
 */
export function getProjectConfigPath(directory: string): string {
  return join(directory, ".opencode", "antigravity.json");
}

// =============================================================================
// Config Loading
// =============================================================================

/**
 * Load and parse a config file, returning null if not found or invalid.
 */
function loadConfigFile(path: string): Partial<AntigravityConfig> | null {
  try {
    if (!existsSync(path)) {
      return null;
    }

    const content = readFileSync(path, "utf-8");
    const rawConfig = JSON.parse(content);

    // Validate with Zod (partial - we'll merge with defaults later)
    const result = AntigravityConfigSchema.partial().safeParse(rawConfig);

    if (!result.success) {
      log.warn("Config validation error", {
        path,
        issues: result.error.issues.map(i => `${i.path.join(".")}: ${i.message}`).join(", "),
      });
      return null;
    }

    return result.data;
  } catch (error) {
    if (error instanceof SyntaxError) {
      log.warn("Invalid JSON in config file", { path, error: error.message });
    } else {
      log.warn("Failed to load config file", { path, error: String(error) });
    }
    return null;
  }
}

/**
 * Deep merge two config objects, with override taking precedence.
 */
function mergeConfigs(
  base: AntigravityConfig,
  override: Partial<AntigravityConfig>
): AntigravityConfig {
  return {
    ...base,
    ...override,
    // Deep merge signature_cache if both exist
    signature_cache: override.signature_cache
      ? {
          ...base.signature_cache,
          ...override.signature_cache,
        }
      : base.signature_cache,
  };
}

// =============================================================================
// Environment Overrides
// =============================================================================

/**
 * Documented OPENCODE_ANTIGRAVITY_* variables win over config files.
 * Unknown or invalid values warn and are ignored, never applied.
 */
function parseEnvBoolean(raw: string | undefined, name: string): boolean | undefined {
  if (raw === undefined || raw.trim().length === 0) {
    return undefined;
  }
  const normalized = raw.trim().toLowerCase();
  if (normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on") {
    return true;
  }
  if (normalized === "0" || normalized === "false" || normalized === "no" || normalized === "off") {
    return false;
  }
  log.warn("Ignoring env override with unrecognized boolean value", { name });
  return undefined;
}

/**
 * Parse an enum env value against its Zod schema. Returns undefined when
 * unset, blank, or invalid (invalid values warn and are ignored).
 */
function parseEnvEnum<T>(raw: string | undefined, name: string, schema: ZodType<T>): T | undefined {
  if (raw === undefined || raw.trim().length === 0) {
    return undefined;
  }
  const result = schema.safeParse(raw.trim());
  if (result.success) {
    return result.data;
  }
  log.warn("Ignoring env override with invalid value", { name, value: raw });
  return undefined;
}

/**
 * Apply documented OPENCODE_ANTIGRAVITY_* overrides on top of file config.
 * Env wins over user and project files. Invalid values are ignored so a
 * typo can never corrupt the resolved config.
 */
function applyEnvOverrides(config: AntigravityConfig): AntigravityConfig {
  const env = process.env;
  const quietMode = parseEnvBoolean(env.OPENCODE_ANTIGRAVITY_QUIET, "OPENCODE_ANTIGRAVITY_QUIET");
  const toastScope = parseEnvEnum(env.OPENCODE_ANTIGRAVITY_TOAST_SCOPE, "OPENCODE_ANTIGRAVITY_TOAST_SCOPE", ToastScopeSchema);
  const debug = parseEnvBoolean(env.OPENCODE_ANTIGRAVITY_DEBUG, "OPENCODE_ANTIGRAVITY_DEBUG");
  const debugTui = parseEnvBoolean(env.OPENCODE_ANTIGRAVITY_DEBUG_TUI, "OPENCODE_ANTIGRAVITY_DEBUG_TUI");
  const keepThinking = parseEnvBoolean(env.OPENCODE_ANTIGRAVITY_KEEP_THINKING, "OPENCODE_ANTIGRAVITY_KEEP_THINKING");
  const accountSelectionStrategy = parseEnvEnum(env.OPENCODE_ANTIGRAVITY_ACCOUNT_SELECTION_STRATEGY, "OPENCODE_ANTIGRAVITY_ACCOUNT_SELECTION_STRATEGY", AccountSelectionStrategySchema);
  const pidOffsetEnabled = parseEnvBoolean(env.OPENCODE_ANTIGRAVITY_PID_OFFSET_ENABLED, "OPENCODE_ANTIGRAVITY_PID_OFFSET_ENABLED");
  const schedulingMode = parseEnvEnum(env.OPENCODE_ANTIGRAVITY_SCHEDULING_MODE, "OPENCODE_ANTIGRAVITY_SCHEDULING_MODE", SchedulingModeSchema);
  const rawLogDir = env.OPENCODE_ANTIGRAVITY_LOG_DIR;
  const logDir = rawLogDir !== undefined && rawLogDir.trim().length > 0 ? rawLogDir.trim() : undefined;
  return {
    ...config,
    ...(quietMode !== undefined ? { quiet_mode: quietMode } : {}),
    ...(toastScope !== undefined ? { toast_scope: toastScope } : {}),
    ...(debug !== undefined ? { debug } : {}),
    ...(debugTui !== undefined ? { debug_tui: debugTui } : {}),
    ...(logDir !== undefined ? { log_dir: logDir } : {}),
    ...(keepThinking !== undefined ? { keep_thinking: keepThinking } : {}),
    ...(accountSelectionStrategy !== undefined ? { account_selection_strategy: accountSelectionStrategy } : {}),
    ...(pidOffsetEnabled !== undefined ? { pid_offset_enabled: pidOffsetEnabled } : {}),
    ...(schedulingMode !== undefined ? { scheduling_mode: schedulingMode } : {}),
  };
}

// =============================================================================
// Main Loader
// =============================================================================

/**
 * Load the complete configuration.
 * 
 * @param directory - The project directory (for project-level config)
 * @returns Fully resolved configuration
 */
export function loadConfig(directory: string): AntigravityConfig {
  // Start with defaults
  let config: AntigravityConfig = { ...DEFAULT_CONFIG };

  // Load user config file (if exists)
  const userConfigPath = getUserConfigPath();
  const userConfig = loadConfigFile(userConfigPath);
  if (userConfig) {
    config = mergeConfigs(config, userConfig);
  }

  // Load project config file (if exists) - overrides user config
  const projectConfigPath = getProjectConfigPath(directory);
  const projectConfig = loadConfigFile(projectConfigPath);
  if (projectConfig) {
    config = mergeConfigs(config, projectConfig);
  }

  return applyEnvOverrides(config);
}

/**
 * Check if a config file exists at the given path.
 */
export function configExists(path: string): boolean {
  return existsSync(path);
}

/**
 * Get the default logs directory.
 */
export function getDefaultLogsDir(): string {
  return join(getConfigDir(), "antigravity-logs");
}

let runtimeConfig: AntigravityConfig | null = null;

export function initRuntimeConfig(config: AntigravityConfig): void {
  runtimeConfig = config;
}

export function getKeepThinking(): boolean {
  return runtimeConfig?.keep_thinking ?? false;
}
