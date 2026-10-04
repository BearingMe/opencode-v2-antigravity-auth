import { env } from "node:process"
import { createDebugFileDestination } from "../adapters/filesystem/debug-log.js"
import { writeOpenCodeLog } from "../adapters/opencode/logging.js"
import type { GitignoreUpdate } from "../adapters/filesystem/config-directory.js"
import { formatBodyPreviewForLog, formatErrorForLog, truncateTextForLog } from "../platform/logging/format.js"
import { deriveDebugPolicy } from "../platform/logging/policy.js"
import type { AntigravityConfig } from "./config"
import { formatAccountContextLabel, formatAccountLabel } from "./logging-utils"

const MAX_BODY_PREVIEW_CHARS = 12000
const MAX_BODY_LOG_CHARS = 50000

export const DEBUG_MESSAGE_PREFIX = "[opencode-v2-antigravity-auth debug]"

// =============================================================================
// Debug State (lazily initialized with config)
// =============================================================================

interface DebugState {
  debugEnabled: boolean
  debugTuiEnabled: boolean
  logFilePath: string | undefined
  logWriter: (line: string) => void
  closeLogWriter: () => Promise<void>
}

let debugState: DebugState | null = null

/**
 * Initialize or reinitialize debug state with the given config.
 * Call this once at plugin startup after loading config.
 */
export function initializeDebug(config: AntigravityConfig): void {
  // Config takes precedence, but env var can force enable for debugging
  const envDebugFlag = env.OPENCODE_ANTIGRAVITY_DEBUG ?? ""
  const { debugEnabled, debugTuiEnabled } = deriveDebugPolicy({
    configDebug: config.debug,
    configDebugTui: config.debug_tui,
    envDebugFlag,
    envDebugTuiFlag: env.OPENCODE_ANTIGRAVITY_DEBUG_TUI,
  })
  if (debugState) void debugState.closeLogWriter()
  const fileDestination = createDebugFileDestination(debugEnabled, config.log_dir, reportGitignoreUpdate)

  debugState = {
    debugEnabled,
    debugTuiEnabled,
    logFilePath: fileDestination.filePath,
    logWriter: fileDestination.writeLine,
    closeLogWriter: fileDestination.close,
  }
}

/** Closes the active file destination and resets debug state for host shutdown. */
export async function disposeDebugLog(): Promise<void> {
  const currentState = debugState
  debugState = null
  await currentState?.closeLogWriter()
}

/** Preserves the legacy storage-service log when debug setup updates config ignores. */
function reportGitignoreUpdate(outcome: GitignoreUpdate): void {
  if (outcome.status === "created") {
    writeOpenCodeLog({
      service: "antigravity.storage",
      level: "info",
      message: "Created .gitignore in config directory",
    })
  } else if (outcome.status === "updated") {
    writeOpenCodeLog({
      service: "antigravity.storage",
      level: "info",
      message: "Updated .gitignore with missing entries",
      extra: { added: outcome.added },
    })
  }
}

/**
 * Get the current debug state, initializing with defaults if needed.
 * This allows the module to work even before initializeDebug is called.
 */
function getDebugState(): DebugState {
  if (!debugState) {
    // Fallback to env-based initialization for backward compatibility
    const { debugEnabled, debugTuiEnabled } = deriveDebugPolicy({
      configDebug: false,
      configDebugTui: false,
      envDebugFlag: env.OPENCODE_ANTIGRAVITY_DEBUG,
      envDebugTuiFlag: env.OPENCODE_ANTIGRAVITY_DEBUG_TUI,
    })
    const fileDestination = createDebugFileDestination(debugEnabled, undefined, reportGitignoreUpdate)

    debugState = {
      debugEnabled,
      debugTuiEnabled,
      logFilePath: fileDestination.filePath,
      logWriter: fileDestination.writeLine,
      closeLogWriter: fileDestination.close,
    }
  }
  return debugState
}

// =============================================================================
// Public API
// =============================================================================

/** Reports whether detailed request and account logs are enabled for files. */
export function isDebugEnabled(): boolean {
  return getDebugState().debugEnabled
}

/** Reports whether plugin log events are enabled for the OpenCode TUI. */
export function isDebugTuiEnabled(): boolean {
  return getDebugState().debugTuiEnabled
}

/** Returns the active debug log path, when file logging is enabled. */
export function getLogFilePath(): string | undefined {
  return getDebugState().logFilePath
}

/** Request-scoped metadata used to pair debug request and response records. */
export interface AntigravityDebugContext {
  id: string
  streaming: boolean
  startedAt: number
}

interface AntigravityDebugRequestMeta {
  originalUrl: string
  resolvedUrl: string
  method?: string
  headers?: HeadersInit
  body?: BodyInit | null
  streaming: boolean
  projectId?: string
}

interface AntigravityDebugResponseMeta {
  body?: string
  note?: string
  error?: unknown
  headersOverride?: HeadersInit
}

let requestCounter = 0

/**
 * Begins a debug trace for an Antigravity request.
 */
export function startAntigravityDebugRequest(meta: AntigravityDebugRequestMeta): AntigravityDebugContext | null {
  const state = getDebugState()
  if (!state.debugEnabled) {
    return null
  }

  const id = `ANTIGRAVITY-${++requestCounter}`
  const method = meta.method ?? "GET"
  logDebug(`[Antigravity Debug ${id}] pid=${process.pid} ${method} ${meta.resolvedUrl}`)
  if (meta.originalUrl && meta.originalUrl !== meta.resolvedUrl) {
    logDebug(`[Antigravity Debug ${id}] Original URL: ${meta.originalUrl}`)
  }
  if (meta.projectId) {
    logDebug(`[Antigravity Debug ${id}] Project: ${meta.projectId}`)
  }
  logDebug(`[Antigravity Debug ${id}] Streaming: ${meta.streaming ? "yes" : "no"}`)
  logDebug(`[Antigravity Debug ${id}] Headers: ${JSON.stringify(maskHeaders(meta.headers))}`)
  const bodyPreview = formatBodyPreviewForLog(meta.body, MAX_BODY_PREVIEW_CHARS)
  if (bodyPreview) {
    logDebug(`[Antigravity Debug ${id}] Body Preview: ${bodyPreview}`)
  }

  return { id, streaming: meta.streaming, startedAt: Date.now() }
}

/**
 * Logs response details for a previously started debug trace.
 */
export function logAntigravityDebugResponse(
  context: AntigravityDebugContext | null | undefined,
  response: Response,
  meta: AntigravityDebugResponseMeta = {},
): void {
  const state = getDebugState()
  if (!state.debugEnabled || !context) {
    return
  }

  const durationMs = Date.now() - context.startedAt
  logDebug(`[Antigravity Debug ${context.id}] Response ${response.status} ${response.statusText} (${durationMs}ms)`)
  logDebug(
    `[Antigravity Debug ${context.id}] Response Headers: ${JSON.stringify(
      maskHeaders(meta.headersOverride ?? response.headers),
    )}`,
  )

  if (meta.note) {
    logDebug(`[Antigravity Debug ${context.id}] Note: ${meta.note}`)
  }

  if (meta.error) {
    logDebug(`[Antigravity Debug ${context.id}] Error: ${formatErrorForLog(meta.error)}`)
  }

  if (meta.body) {
    logDebug(
      `[Antigravity Debug ${context.id}] Response Body Preview: ${truncateTextForLog(meta.body, MAX_BODY_PREVIEW_CHARS)}`,
    )
  }
}

/**
 * Obscures sensitive headers and returns a plain object for logging.
 */
function maskHeaders(headers?: HeadersInit | Headers): Record<string, string> {
  if (!headers) {
    return {}
  }

  const result: Record<string, string> = {}
  const parsed = headers instanceof Headers ? headers : new Headers(headers)
  parsed.forEach((value, key) => {
    if (key.toLowerCase() === "authorization") {
      result[key] = "[redacted]"
    } else {
      result[key] = value
    }
  })
  return result
}

/**
 * Writes a single debug line using the configured writer.
 */
function logDebug(line: string): void {
  getDebugState().logWriter(line)
}

/** Runs a debug-only operation when file logging is enabled. */
function runWithDebugEnabled(action: () => void): void {
  if (!getDebugState().debugEnabled) return
  action()
}

/** Account details used by account and quota debug records. */
export interface AccountDebugInfo {
  index: number
  email?: string
  family: string
  totalAccounts: number
  rateLimitState?: { claude?: number; gemini?: number }
}

/** Logs account selection context and active rate-limit state when file debug is enabled. */
export function logAccountContext(label: string, info: AccountDebugInfo): void {
  runWithDebugEnabled(() => {
    const accountLabel = formatAccountContextLabel(info.email, info.index)

    const indexLabel = info.index >= 0 ? `${info.index + 1}/${info.totalAccounts}` : `-/${info.totalAccounts}`

    let rateLimitInfo = ""
    if (info.rateLimitState && Object.keys(info.rateLimitState).length > 0) {
      const now = Date.now()
      const activeRateLimits: Record<string, string> = {}
      for (const [key, resetTime] of Object.entries(info.rateLimitState)) {
        if (typeof resetTime === "number" && resetTime > now) {
          const remainingSec = Math.ceil((resetTime - now) / 1000)
          activeRateLimits[key] = `${remainingSec}s`
        }
      }
      if (Object.keys(activeRateLimits).length > 0) {
        rateLimitInfo = ` rateLimits=${JSON.stringify(activeRateLimits)}`
      }
    }

    logDebug(`[Account] ${label}: ${accountLabel} (${indexLabel}) family=${info.family}${rateLimitInfo}`)
  })
}

/** Logs an account rate-limit response and any available provider details. */
export function logRateLimitEvent(
  accountIndex: number,
  email: string | undefined,
  family: string,
  status: number,
  retryAfterMs: number,
  bodyInfo: { message?: string; quotaResetTime?: string; retryDelayMs?: number | null; reason?: string },
): void {
  runWithDebugEnabled(() => {
    const accountLabel = formatAccountLabel(email, accountIndex)
    logDebug(`[RateLimit] ${status} on ${accountLabel} family=${family} retryAfterMs=${retryAfterMs}`)
    if (bodyInfo.message) {
      logDebug(`[RateLimit] message: ${bodyInfo.message}`)
    }
    if (bodyInfo.quotaResetTime) {
      logDebug(`[RateLimit] quotaResetTime: ${bodyInfo.quotaResetTime}`)
    }
    if (bodyInfo.retryDelayMs !== undefined && bodyInfo.retryDelayMs !== null) {
      logDebug(`[RateLimit] body retryDelayMs: ${bodyInfo.retryDelayMs}`)
    }
    if (bodyInfo.reason) {
      logDebug(`[RateLimit] reason: ${bodyInfo.reason}`)
    }
  })
}

/** Logs a concise snapshot of account cooldowns for one model family. */
export function logRateLimitSnapshot(
  family: string,
  accounts: Array<{ index: number; email?: string; rateLimitResetTimes?: { claude?: number; gemini?: number } }>,
): void {
  runWithDebugEnabled(() => {
    const now = Date.now()
    const entries = accounts.map((account) => {
      const label = formatAccountLabel(account.email, account.index)
      const reset = account.rateLimitResetTimes?.[family as "claude" | "gemini"]
      if (typeof reset !== "number") {
        return `${label}=ready`
      }
      const remaining = Math.max(0, reset - now)
      const seconds = Math.ceil(remaining / 1000)
      return `${label}=wait ${seconds}s`
    })
    logDebug(`[RateLimit] snapshot family=${family} ${entries.join(" | ")}`)
  })
}

/** Logs a bounded response preview and returns the complete cloned response text. */
export async function logResponseBody(
  context: AntigravityDebugContext | null | undefined,
  response: Response,
  status: number,
): Promise<string | undefined> {
  const state = getDebugState()
  if (!state.debugEnabled || !context) return undefined

  try {
    const text = await response.clone().text()
    const preview = truncateTextForLog(text, MAX_BODY_LOG_CHARS)
    logDebug(`[Antigravity Debug ${context.id}] Response Body (${status}): ${preview}`)
    return text
  } catch (e) {
    logDebug(`[Antigravity Debug ${context.id}] Failed to read response body: ${formatErrorForLog(e)}`)
    return undefined
  }
}

/** Logs the model family selected for an outgoing request. */
export function logModelFamily(url: string, extractedModel: string | null, family: string): void {
  runWithDebugEnabled(() => {
    logDebug(`[ModelFamily] url=${url} model=${extractedModel ?? "unknown"} family=${family}`)
  })
}

/** Writes a caller-provided line to the configured debug file when enabled. */
export function debugLogToFile(message: string): void {
  runWithDebugEnabled(() => {
    logDebug(message)
  })
}

/**
 * Logs a toast message to the debug file.
 * This helps correlate what the user saw with debug events.
 */
export function logToast(message: string, variant: "info" | "warning" | "success" | "error"): void {
  runWithDebugEnabled(() => {
    const variantLabel = variant.toUpperCase()
    logDebug(`[Toast/${variantLabel}] ${message}`)
  })
}

/**
 * Logs cache hit/miss information from response usage metadata.
 */
export function logCacheStats(
  model: string,
  cacheReadTokens: number,
  cacheWriteTokens: number,
  totalInputTokens: number,
): void {
  runWithDebugEnabled(() => {
    const cacheHitRate = totalInputTokens > 0 ? Math.round((cacheReadTokens / totalInputTokens) * 100) : 0
    const status = cacheReadTokens > 0 ? "HIT" : cacheWriteTokens > 0 ? "WRITE" : "MISS"
    logDebug(
      `[Cache] ${status} model=${model} read=${cacheReadTokens} write=${cacheWriteTokens} total=${totalInputTokens} hitRate=${cacheHitRate}%`,
    )
  })
}

/**
 * Logs quota status for an account.
 */
export function logQuotaStatus(
  accountEmail: string | undefined,
  accountIndex: number,
  quotaPercent: number,
  family?: string,
): void {
  runWithDebugEnabled(() => {
    const accountLabel = formatAccountLabel(accountEmail, accountIndex)
    const familyInfo = family ? ` family=${family}` : ""
    const status = quotaPercent <= 0 ? "EXHAUSTED" : quotaPercent < 20 ? "LOW" : "OK"
    logDebug(`[Quota] ${accountLabel} remaining=${quotaPercent.toFixed(1)}% status=${status}${familyInfo}`)
  })
}

/**
 * Logs background quota fetch events.
 */
export function logQuotaFetch(event: "start" | "complete" | "error", accountCount?: number, details?: string): void {
  runWithDebugEnabled(() => {
    const countInfo = accountCount !== undefined ? ` accounts=${accountCount}` : ""
    const detailsInfo = details ? ` ${details}` : ""
    logDebug(`[QuotaFetch] ${event.toUpperCase()}${countInfo}${detailsInfo}`)
  })
}
