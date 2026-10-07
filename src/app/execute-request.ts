import { ANTIGRAVITY_ENDPOINT_FALLBACKS } from "../constants.js"
import {
  AccountPoolManager as AccountManager,
  calculateBackoffMs,
  computeSoftQuotaCacheTtlMs,
  getHealthTracker,
  getTokenTracker,
  parseRateLimitReason,
  type AccountOAuthCredential,
  type ManagedAccount,
  type ModelFamily,
  type AccountPool,
} from "../modules/accounts/index.js"
import { createSyntheticErrorResponse, isEmptyResponseBody } from "../modules/inference/index.js"
import { EmptyResponseError } from "../modules/inference/index.js"
import { AntigravityTokenRefreshError } from "../adapters/opencode/token.js"
import {
  isDebugEnabled,
  logAccountContext,
  logAntigravityDebugResponse,
  logRateLimitEvent,
  logRateLimitSnapshot,
  logResponseBody,
  logModelFamily,
  startAntigravityDebugRequest,
} from "../adapters/opencode/debug.js"
import type { AntigravityDebugContext } from "../adapters/opencode/debug.js"
import { createLogger } from "../adapters/opencode/logger.js"
import { extractVerificationErrorDetails } from "../adapters/antigravity/verification-parser.js"
import type { AntigravityConfig } from "../adapters/opencode/config/index.js"
import type { ProjectContextResult } from "../modules/accounts/index.js"
import type { InferenceApi } from "../modules/inference/index.js"
import type { AntigravityInferenceClient } from "../adapters/antigravity/inference-client.js"
import type { Fingerprint } from "../adapters/antigravity/fingerprint.js"

const log = createLogger("engine")

// DO NOT retune: identical to src/plugin.ts hot-path constants.
const FIRST_RETRY_DELAY_MS = 1000
const SWITCH_ACCOUNT_DELAY_MS = 5000
const MAX_WARMUP_SESSIONS = 1000
const MAX_WARMUP_RETRIES = 2
const MAX_CAPACITY_RETRIES = 3
const MAX_CAPACITY_FINGERPRINT_REFRESHES = 1
const RATE_LIMIT_DEDUP_WINDOW_MS = 2000
const RATE_LIMIT_STATE_RESET_MS = 120_000
const MAX_CONSECUTIVE_FAILURES = 5
const FAILURE_COOLDOWN_MS = 30_000
const FAILURE_STATE_RESET_MS = 120_000
const RATE_LIMIT_TOAST_COOLDOWN_MS = 5000
const MAX_TOAST_COOLDOWN_ENTRIES = 100

const warmupAttemptedSessionIds = new Set<string>()
const warmupSucceededSessionIds = new Set<string>()

const rateLimitToastCooldowns = new Map<string, number>()
let softQuotaToastShown = false
let rateLimitToastShown = false

interface RateLimitState {
  consecutive429: number
  lastAt: number
  quotaKey: string
}

const rateLimitStateByAccountQuota = new Map<string, RateLimitState>()
const emptyResponseAttempts = new Map<string, number>()
const accountFailureState = new Map<number, { consecutiveFailures: number; lastFailureAt: number }>()

/** Evicts expired rate-limit toast keys after the bounded map grows past its cap. */
function cleanupToastCooldowns(): void {
  if (rateLimitToastCooldowns.size > MAX_TOAST_COOLDOWN_ENTRIES) {
    const now = Date.now()
    for (const [key, time] of rateLimitToastCooldowns) {
      if (now - time > RATE_LIMIT_TOAST_COOLDOWN_MS * 2) {
        rateLimitToastCooldowns.delete(key)
      }
    }
  }
}

/** Applies the short de-duplication window to equivalent rate-limit notices. */
function shouldShowRateLimitToast(message: string): boolean {
  cleanupToastCooldowns()
  const toastKey = message.replace(/\d+/g, "X")
  const lastShown = rateLimitToastCooldowns.get(toastKey) ?? 0
  const now = Date.now()
  if (now - lastShown < RATE_LIMIT_TOAST_COOLDOWN_MS) {
    return false
  }
  rateLimitToastCooldowns.set(toastKey, now)
  return true
}

/** Allows the next all-accounts-blocked condition to notify the user again. */
function resetAllAccountsBlockedToasts(): void {
  softQuotaToastShown = false
  rateLimitToastShown = false
}

/** Reserves one bounded warmup attempt for the current session. */
function trackWarmupAttempt(sessionId: string): boolean {
  if (warmupSucceededSessionIds.has(sessionId)) {
    return false
  }
  if (warmupAttemptedSessionIds.size >= MAX_WARMUP_SESSIONS) {
    const first = warmupAttemptedSessionIds.values().next().value
    if (first) {
      warmupAttemptedSessionIds.delete(first)
      warmupSucceededSessionIds.delete(first)
    }
  }
  if (warmupAttemptedSessionIds.has(sessionId)) {
    return false
  }
  const attempts = warmupAttemptedSessionIds.has(sessionId) ? 1 : 0
  if (attempts >= MAX_WARMUP_RETRIES) {
    return false
  }
  warmupAttemptedSessionIds.add(sessionId)
  return true
}

/** Marks a session as warmed and releases its in-flight attempt entry. */
function markWarmupSuccess(sessionId: string): void {
  warmupSucceededSessionIds.add(sessionId)
  if (warmupSucceededSessionIds.size >= MAX_WARMUP_SESSIONS) {
    const first = warmupSucceededSessionIds.values().next().value
    if (first) warmupSucceededSessionIds.delete(first)
  }
}

/** Releases an unsuccessful warmup reservation so a later request can retry. */
function clearWarmupAttempt(sessionId: string): void {
  warmupAttemptedSessionIds.delete(sessionId)
}

/** Advances the per-account, per-quota retry state and returns its delay. */
function getRateLimitBackoff(
  accountIndex: number,
  quotaKey: string,
  serverRetryAfterMs: number | null,
  maxBackoffMs: number = 60_000,
): { attempt: number; delayMs: number; isDuplicate: boolean } {
  const now = Date.now()
  const stateKey = `${accountIndex}:${quotaKey}`
  const previous = rateLimitStateByAccountQuota.get(stateKey)

  if (previous && now - previous.lastAt < RATE_LIMIT_DEDUP_WINDOW_MS) {
    const baseDelay = serverRetryAfterMs ?? 1000
    const backoffDelay = Math.min(baseDelay * Math.pow(2, previous.consecutive429 - 1), maxBackoffMs)
    return {
      attempt: previous.consecutive429,
      delayMs: Math.max(baseDelay, backoffDelay),
      isDuplicate: true,
    }
  }

  const attempt = previous && now - previous.lastAt < RATE_LIMIT_STATE_RESET_MS ? previous.consecutive429 + 1 : 1

  rateLimitStateByAccountQuota.set(stateKey, {
    consecutive429: attempt,
    lastAt: now,
    quotaKey,
  })

  const baseDelay = serverRetryAfterMs ?? 1000
  const backoffDelay = Math.min(baseDelay * Math.pow(2, attempt - 1), maxBackoffMs)
  return { attempt, delayMs: Math.max(baseDelay, backoffDelay), isDuplicate: false }
}

/** Clears one account's retry history after a successful response. */
function resetRateLimitState(accountIndex: number, quotaKey: string): void {
  const stateKey = `${accountIndex}:${quotaKey}`
  rateLimitStateByAccountQuota.delete(stateKey)
}

/** Normalizes model families to the rate-limit buckets used by retry policy. */
function quotaKeyForFamily(family: ModelFamily): string {
  return family === "claude" ? "claude" : "gemini-antigravity"
}

/** Counts recent account failures and reports whether the account should cool down. */
function trackAccountFailure(accountIndex: number): { failures: number; shouldCooldown: boolean; cooldownMs: number } {
  const now = Date.now()
  const previous = accountFailureState.get(accountIndex)

  const failures =
    previous && now - previous.lastFailureAt < FAILURE_STATE_RESET_MS ? previous.consecutiveFailures + 1 : 1

  accountFailureState.set(accountIndex, { consecutiveFailures: failures, lastFailureAt: now })

  const shouldCooldown = failures >= MAX_CONSECUTIVE_FAILURES
  const cooldownMs = shouldCooldown ? FAILURE_COOLDOWN_MS : 0

  return { failures, shouldCooldown, cooldownMs }
}

/** Clears recent transient failures after account recovery. */
function resetAccountFailureState(accountIndex: number): void {
  accountFailureState.delete(accountIndex)
}

/** Waits for a retry delay while allowing the request's abort signal to interrupt it. */
export function sleep(ms: number, signal?: AbortSignal | null): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason instanceof Error ? signal.reason : new Error("Aborted"))
      return
    }

    const timeout = setTimeout(() => {
      cleanup()
      resolve()
    }, ms)

    /** Rejects the delay when the caller cancels the request. */
    const onAbort = () => {
      cleanup()
      reject(signal?.reason instanceof Error ? signal.reason : new Error("Aborted"))
    }

    /** Removes the timer and abort listener once the delay settles. */
    const cleanup = () => {
      clearTimeout(timeout)
      signal?.removeEventListener("abort", onAbort)
    }

    signal?.addEventListener("abort", onAbort, { once: true })
  })
}

/** Converts supported fetch input forms into their URL string. */
export function toUrlString(value: RequestInfo | string): string {
  if (typeof value === "string") {
    return value
  }
  const candidate = (value as Request).url
  if (candidate) {
    return candidate
  }
  return value.toString()
}

/** Converts the prepared generation URL into its SSE warmup endpoint. */
export function toWarmupStreamUrl(value: RequestInfo | string): string {
  const urlString = toUrlString(value)
  try {
    const url = new URL(urlString)
    if (!url.pathname.includes(":streamGenerateContent")) {
      url.pathname = url.pathname.replace(":generateContent", ":streamGenerateContent")
    }
    url.searchParams.set("alt", "sse")
    return url.toString()
  } catch {
    return urlString
  }
}

/** Extracts a model identifier from a Generative Language API URL. */
export function extractModelFromUrl(urlString: string): string | null {
  const match = urlString.match(/\/models\/([^:\/?]+)(?::\w+)?/)
  return match?.[1] ?? null
}

/** Extracts model identifiers that include a supported backend suffix. */
export function extractModelFromUrlWithSuffix(urlString: string): string | null {
  const match = urlString.match(/\/models\/([^:\/\?]+)/)
  return match?.[1] ?? null
}

/** Classifies a routed URL into the Claude or Gemini account pool. */
export function getModelFamilyFromUrl(urlString: string): ModelFamily {
  const model = extractModelFromUrl(urlString)
  let family: ModelFamily = "gemini"
  if (model && model.includes("claude")) {
    family = "claude"
  }
  if (isDebugEnabled()) {
    logModelFamily(urlString, model, family)
  }
  return family
}

/** Reads Retry-After headers with the existing millisecond-header precedence. */
function retryAfterMsFromResponse(response: Response, defaultRetryMs: number = 60_000): number {
  const retryAfterMsHeader = response.headers.get("retry-after-ms")
  if (retryAfterMsHeader) {
    const parsed = Number.parseInt(retryAfterMsHeader, 10)
    if (!Number.isNaN(parsed) && parsed > 0) {
      return parsed
    }
  }

  const retryAfterHeader = response.headers.get("retry-after")
  if (retryAfterHeader) {
    const parsed = Number.parseInt(retryAfterHeader, 10)
    if (!Number.isNaN(parsed) && parsed > 0) {
      return parsed * 1000
    }
  }

  return defaultRetryMs
}

/** Parses Google's compound duration format into milliseconds. */
function parseDurationToMs(duration: string): number | null {
  const simpleMatch = duration.match(/^(\d+(?:\.\d+)?)(ms|s|m|h)?$/i)
  if (simpleMatch) {
    const value = parseFloat(simpleMatch[1] ?? "0")
    const unit = (simpleMatch[2] || "s").toLowerCase()
    switch (unit) {
      case "h":
        return value * 3600 * 1000
      case "m":
        return value * 60 * 1000
      case "s":
        return value * 1000
      case "ms":
        return value
      default:
        return value * 1000
    }
  }

  const compoundRegex = /(\d+(?:\.\d+)?)(h|m(?!s)|s|ms)/gi
  let totalMs = 0
  let matchFound = false
  let match: RegExpExecArray | null

  while ((match = compoundRegex.exec(duration)) !== null) {
    matchFound = true
    const value = parseFloat(match[1] ?? "0")
    const unit = (match[2] ?? "s").toLowerCase()
    switch (unit) {
      case "h":
        totalMs += value * 3600 * 1000
        break
      case "m":
        totalMs += value * 60 * 1000
        break
      case "s":
        totalMs += value * 1000
        break
      case "ms":
        totalMs += value
        break
    }
  }

  return matchFound ? totalMs : null
}

interface RateLimitBodyInfo {
  retryDelayMs: number | null
  message?: string
  quotaResetTime?: string
  reason?: string
}

/** Extracts retry, quota, and reason fields from a Google error payload. */
function extractRateLimitBodyInfo(body: unknown): RateLimitBodyInfo {
  if (!body || typeof body !== "object") {
    return { retryDelayMs: null }
  }

  const error = (body as { error?: unknown }).error
  const message = error && typeof error === "object" ? (error as { message?: string }).message : undefined

  const details = error && typeof error === "object" ? (error as { details?: unknown[] }).details : undefined

  let reason: string | undefined
  if (Array.isArray(details)) {
    for (const detail of details) {
      if (!detail || typeof detail !== "object") continue
      const type = (detail as { "@type"?: string })["@type"]
      if (typeof type === "string" && type.includes("google.rpc.ErrorInfo")) {
        const detailReason = (detail as { reason?: string }).reason
        if (typeof detailReason === "string") {
          reason = detailReason
          break
        }
      }
    }

    for (const detail of details) {
      if (!detail || typeof detail !== "object") continue
      const type = (detail as { "@type"?: string })["@type"]
      if (typeof type === "string" && type.includes("google.rpc.RetryInfo")) {
        const retryDelay = (detail as { retryDelay?: string }).retryDelay
        if (typeof retryDelay === "string") {
          const retryDelayMs = parseDurationToMs(retryDelay)
          if (retryDelayMs !== null) {
            return { retryDelayMs, message, reason }
          }
        }
      }
    }

    for (const detail of details) {
      if (!detail || typeof detail !== "object") continue
      const metadata = (detail as { metadata?: Record<string, string> }).metadata
      if (metadata && typeof metadata === "object") {
        const quotaResetDelay = metadata.quotaResetDelay
        const quotaResetTime = metadata.quotaResetTimeStamp
        if (typeof quotaResetDelay === "string") {
          const quotaResetDelayMs = parseDurationToMs(quotaResetDelay)
          if (quotaResetDelayMs !== null) {
            return { retryDelayMs: quotaResetDelayMs, message, quotaResetTime, reason }
          }
        }
      }
    }
  }

  if (message) {
    const afterMatch = message.match(/reset after\s+([0-9hms.]+)/i)
    const rawDuration = afterMatch?.[1]
    if (rawDuration) {
      const parsed = parseDurationToMs(rawDuration)
      if (parsed !== null) {
        return { retryDelayMs: parsed, message, reason }
      }
    }
  }

  return { retryDelayMs: null, message, reason }
}

/** Parses retry metadata from a cloned response without consuming its body. */
async function extractRetryInfoFromBody(response: Response): Promise<RateLimitBodyInfo> {
  try {
    const text = await response.clone().text()
    try {
      const parsed = JSON.parse(text) as unknown
      return extractRateLimitBodyInfo(parsed)
    } catch {
      return { retryDelayMs: null }
    }
  } catch {
    return { retryDelayMs: null }
  }
}

/** Formats a non-negative delay for user-facing status messages. */
export function formatWaitTime(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  const seconds = Math.ceil(ms / 1000)
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  const remainingSeconds = seconds % 60
  if (minutes < 60) {
    return remainingSeconds > 0 ? `${minutes}m ${remainingSeconds}s` : `${minutes}m`
  }
  const hours = Math.floor(minutes / 60)
  const remainingMinutes = minutes % 60
  return remainingMinutes > 0 ? `${hours}h ${remainingMinutes}m` : `${hours}h`
}

export type EngineToastVariant = "info" | "warning" | "success" | "error"

export interface EngineRequestOptions {
  config: AntigravityConfig
  accountManager: AccountManager
  isChildSession?: boolean
  onToast?: (message: string, variant: EngineToastVariant) => void | Promise<void>
}

/** Module and transport implementations selected by application composition. */
export interface RequestExecutionPorts {
  accountPool: AccountPool<ManagedAccount>
  inference: InferenceApi<Fingerprint, AntigravityDebugContext>
  inferenceClient: AntigravityInferenceClient
  accessTokenExpired(auth: AccountOAuthCredential): boolean
  refreshAccessToken(auth: AccountOAuthCredential): Promise<AccountOAuthCredential | undefined>
  ensureProjectContext(auth: AccountOAuthCredential): Promise<ProjectContextResult<AccountOAuthCredential>>
  clearOAuthCredential(): Promise<void>
  showToast(message: string, variant: EngineToastVariant): Promise<void>
}

type FailureContext = {
  response: Response
  streaming: boolean
  debugContext: ReturnType<typeof startAntigravityDebugRequest>
  requestedModel?: string
  projectId?: string
  endpoint?: string
  effectiveModel?: string
  sessionId?: string
  toolDebugMissing?: number
  toolDebugSummary?: string
  toolDebugPayload?: string
}

/** Reports whether the compatibility native-engine switch is enabled. */
export function isNativeEngineEnabled(): boolean {
  return process.env.OPENCODE_ANTIGRAVITY_V2_NATIVE !== "0"
}

/**
 * Runs one routed request using composed account, inference, and transport ports.
 * The orchestration preserves rotation, quota protection, retries, and warmup.
 */
export async function executeRequest(
  input: RequestInfo | string,
  init: RequestInit | undefined,
  options: EngineRequestOptions,
  ports: RequestExecutionPorts,
): Promise<Response> {
  const { config, accountManager } = options
  const { accountPool, inference, inferenceClient } = ports

  const urlString = toUrlString(input)
  const model = extractModelFromUrl(urlString)
  if (model) {
    inference.assertModelSupported(model)
  }
  const family = getModelFamilyFromUrl(urlString)
  const classification = model ? inference.classifyModel(model) : undefined
  const debugLines: string[] = []
  /** Adds detail to the request trace only when Antigravity debug is enabled. */
  const pushDebug = (line: string) => {
    if (!isDebugEnabled()) return
    debugLines.push(line)
  }
  pushDebug(`request=${urlString}`)

  let lastFailure: FailureContext | null = null
  let lastError: Error | null = null
  const abortSignal = init?.signal ?? undefined

  /** Stops account rotation and retries when the host cancels this request. */
  const checkAborted = () => {
    if (abortSignal?.aborted) {
      throw abortSignal.reason instanceof Error ? abortSignal.reason : new Error("Aborted")
    }
  }

  const quietMode = config.quiet_mode
  const toastScope = config.toast_scope
  const isChildSession = options.isChildSession ?? false

  /** Applies plugin toast policy before crossing the OpenCode host boundary. */
  const showToast = async (message: string, variant: EngineToastVariant) => {
    log.debug("toast", { message, variant, isChildSession, toastScope })

    if (options.onToast) {
      await options.onToast(message, variant)
      return
    }

    if (quietMode) return
    if (abortSignal?.aborted) return

    if (toastScope === "root_only" && isChildSession) {
      log.debug("toast-suppressed-child-session", { message, variant })
      return
    }

    if (variant === "warning" && message.toLowerCase().includes("rate")) {
      if (!shouldShowRateLimitToast(message)) {
        return
      }
    }

    try {
      await ports.showToast(message, variant)
    } catch {
      // TUI may not be available
    }
  }

  while (true) {
    checkAborted()

    const accountCount = accountManager.getAccountCount()
    if (accountCount === 0) {
      throw new Error("No Antigravity accounts available. Run `opencode auth login`.")
    }

    const softQuotaCacheTtlMs = computeSoftQuotaCacheTtlMs(
      config.soft_quota_cache_ttl_minutes,
      config.quota_refresh_interval_minutes,
    )

    let account = accountPool.selectForRequest({
      classification: {
        family,
        ...(model === null ? {} : { model }),
        ...(classification ? { quotaGroup: classification.quotaGroup } : {}),
      },
      strategy: config.account_selection_strategy,
      pidOffsetEnabled: config.pid_offset_enabled,
      softQuotaThresholdPercent: config.soft_quota_threshold_percent,
      softQuotaCacheTtlMs,
    })

    if (!account) {
      if (
        accountManager.areAllAccountsOverSoftQuota(
          family,
          config.soft_quota_threshold_percent,
          softQuotaCacheTtlMs,
          model,
          classification?.quotaGroup,
        )
      ) {
        const threshold = config.soft_quota_threshold_percent
        const softQuotaWaitMs = accountManager.getMinWaitTimeForSoftQuota(
          family,
          threshold,
          softQuotaCacheTtlMs,
          model,
          classification?.quotaGroup,
        )
        const maxWaitMs = (config.max_rate_limit_wait_seconds ?? 300) * 1000

        if (softQuotaWaitMs === null || (maxWaitMs > 0 && softQuotaWaitMs > maxWaitMs)) {
          const waitTimeFormatted = softQuotaWaitMs ? formatWaitTime(softQuotaWaitMs) : "unknown"
          await showToast(`All accounts over ${threshold}% quota threshold. Resets in ${waitTimeFormatted}.`, "error")
          throw new Error(
            `Quota protection: All ${accountCount} account(s) are over ${threshold}% usage for ${family}. ` +
              `Quota resets in ${waitTimeFormatted}. ` +
              `Add more accounts, wait for quota reset, or set soft_quota_threshold_percent: 100 to disable.`,
          )
        }

        pushDebug(`all-over-soft-quota family=${family} accounts=${accountCount} waitMs=${softQuotaWaitMs}`)

        if (!softQuotaToastShown) {
          await showToast(
            `All ${accountCount} account(s) over ${threshold}% quota. Waiting ${formatWaitTime(softQuotaWaitMs)}...`,
            "warning",
          )
          softQuotaToastShown = true
        }

        await sleep(softQuotaWaitMs, abortSignal)
        continue
      }

      const waitMs = accountManager.getMinWaitTimeForFamily(family, model) || 60_000
      const waitSecValue = Math.max(1, Math.ceil(waitMs / 1000))

      pushDebug(`all-rate-limited family=${family} accounts=${accountCount} waitMs=${waitMs}`)
      if (isDebugEnabled()) {
        logAccountContext("All accounts rate-limited", {
          index: -1,
          family,
          totalAccounts: accountCount,
        })
        logRateLimitSnapshot(family, accountManager.getAccountsSnapshot())
      }

      const maxWaitMs = (config.max_rate_limit_wait_seconds ?? 300) * 1000
      if (maxWaitMs > 0 && waitMs > maxWaitMs) {
        const waitTimeFormatted = formatWaitTime(waitMs)
        await showToast(`Rate limited for ${waitTimeFormatted}. Try again later or add another account.`, "error")

        throw new Error(
          `All ${accountCount} account(s) rate-limited for ${family}. ` +
            `Quota resets in ${waitTimeFormatted}. ` +
            `Add more accounts with \`opencode auth login\` or wait and retry.`,
        )
      }

      if (!rateLimitToastShown) {
        await showToast(
          `All ${accountCount} account(s) rate-limited for ${family}. Waiting ${waitSecValue}s...`,
          "warning",
        )
        rateLimitToastShown = true
      }

      await sleep(waitMs, abortSignal)
      continue
    }

    resetAllAccountsBlockedToasts()

    pushDebug(
      `selected idx=${account.index} email=${account.email ?? ""} family=${family} accounts=${accountCount} strategy=${config.account_selection_strategy}`,
    )
    if (isDebugEnabled()) {
      logAccountContext("Selected", {
        index: account.index,
        email: account.email,
        family,
        totalAccounts: accountCount,
        rateLimitState: account.rateLimitResetTimes,
      })
    }

    if (accountCount > 1 && accountManager.shouldShowAccountToast(account.index)) {
      const accountLabel = account.email || `Account ${account.index + 1}`
      const enabledAccounts = accountManager.getEnabledAccounts()
      const enabledPosition = enabledAccounts.findIndex((a) => a.index === account.index) + 1
      await showToast(`Using ${accountLabel} (${enabledPosition}/${accountCount})`, "info")
      accountManager.markToastShown(account.index)
    }

    accountManager.requestSaveToDisk()

    let authRecord = accountManager.toAuthDetails(account)

    if (ports.accessTokenExpired(authRecord)) {
      try {
        const refreshed = await ports.refreshAccessToken(authRecord)
        if (!refreshed) {
          const { failures, shouldCooldown, cooldownMs } = trackAccountFailure(account.index)
          getHealthTracker().recordFailure(account.index)
          lastError = new Error("Antigravity token refresh failed")
          if (shouldCooldown) {
            accountManager.markAccountCoolingDown(account, cooldownMs, "auth-failure")
            accountManager.markRateLimited(account, cooldownMs, family, model)
            pushDebug(`token-refresh-failed: cooldown ${cooldownMs}ms after ${failures} failures`)
          }
          continue
        }
        resetAccountFailureState(account.index)
        accountManager.updateFromAuth(account, refreshed)
        authRecord = refreshed
        try {
          await accountManager.saveToDisk()
        } catch (error) {
          log.error("Failed to persist refreshed auth", { error: String(error) })
        }
      } catch (error) {
        if (error instanceof AntigravityTokenRefreshError && error.code === "invalid_grant") {
          const removed = accountManager.removeAccount(account)
          if (removed) {
            log.warn("Removed revoked account from pool - reauthenticate via `opencode auth login`")
            try {
              await accountManager.saveToDisk()
            } catch (persistError) {
              log.error("Failed to persist revoked account removal", { error: String(persistError) })
            }
          }

          if (accountManager.getAccountCount() === 0) {
            try {
              await ports.clearOAuthCredential()
            } catch (storeError) {
              log.error("Failed to clear stored Antigravity OAuth credentials", { error: String(storeError) })
            }

            throw new Error(
              "All Antigravity accounts have invalid refresh tokens. Run `opencode auth login` and reauthenticate.",
            )
          }

          lastError = error
          continue
        }

        const { failures, shouldCooldown, cooldownMs } = trackAccountFailure(account.index)
        getHealthTracker().recordFailure(account.index)
        lastError = error instanceof Error ? error : new Error(String(error))
        if (shouldCooldown) {
          accountManager.markAccountCoolingDown(account, cooldownMs, "auth-failure")
          accountManager.markRateLimited(account, cooldownMs, family, model)
          pushDebug(`token-refresh-error: cooldown ${cooldownMs}ms after ${failures} failures`)
        }
        continue
      }
    }

    const accessToken = authRecord.access
    if (!accessToken) {
      lastError = new Error("Missing access token")
      if (accountCount <= 1) {
        throw lastError
      }
      continue
    }

    let projectContext: ProjectContextResult<AccountOAuthCredential>
    try {
      projectContext = await ports.ensureProjectContext(authRecord)
      resetAccountFailureState(account.index)
    } catch (error) {
      const { failures, shouldCooldown, cooldownMs } = trackAccountFailure(account.index)
      getHealthTracker().recordFailure(account.index)
      lastError = error instanceof Error ? error : new Error(String(error))
      if (shouldCooldown) {
        accountManager.markAccountCoolingDown(account, cooldownMs, "project-error")
        accountManager.markRateLimited(account, cooldownMs, family, model)
        pushDebug(`project-context-error: cooldown ${cooldownMs}ms after ${failures} failures`)
      }
      continue
    }

    if (projectContext.auth.refresh !== authRecord.refresh || projectContext.auth.access !== authRecord.access) {
      accountManager.updateFromAuth(account, projectContext.auth)
      authRecord = projectContext.auth
      try {
        await accountManager.saveToDisk()
      } catch (error) {
        log.error("Failed to persist project context", { error: String(error) })
      }
    }

    /** Sends the preparatory request needed to cache Claude thinking signatures. */
    const runThinkingWarmup = async (
      prepared: ReturnType<typeof inference.prepareRequest>,
      projectId: string,
    ): Promise<void> => {
      if (!prepared.needsSignedThinkingWarmup || !prepared.sessionId) {
        return
      }

      if (!trackWarmupAttempt(prepared.sessionId)) {
        return
      }

      const warmupBody = inference.buildThinkingWarmupBody(
        typeof prepared.init.body === "string" ? prepared.init.body : undefined,
        prepared.needsSignedThinkingWarmup,
      )
      if (!warmupBody) {
        return
      }

      const warmupUrl = toWarmupStreamUrl(prepared.request)
      const warmupHeaders = new Headers(prepared.init.headers ?? {})
      warmupHeaders.set("accept", "text/event-stream")

      const warmupInit: RequestInit = {
        ...prepared.init,
        method: prepared.init.method ?? "POST",
        headers: warmupHeaders,
        body: warmupBody,
      }

      const warmupDebugContext = startAntigravityDebugRequest({
        originalUrl: warmupUrl,
        resolvedUrl: warmupUrl,
        method: warmupInit.method,
        headers: warmupHeaders,
        body: warmupBody,
        streaming: true,
        projectId,
      })

      try {
        pushDebug("thinking-warmup: start")
        const warmupResponse = await inferenceClient.send(warmupUrl, warmupInit)
        const transformed = await inference.transformResponse({
          response: warmupResponse,
          streaming: true,
          debugContext: warmupDebugContext,
          requestedModel: prepared.requestedModel,
          projectId,
          endpoint: warmupUrl,
          effectiveModel: prepared.effectiveModel,
          sessionId: prepared.sessionId,
        })
        await transformed.text()
        markWarmupSuccess(prepared.sessionId)
        pushDebug("thinking-warmup: done")
      } catch (error) {
        clearWarmupAttempt(prepared.sessionId)
        pushDebug(`thinking-warmup: failed ${error instanceof Error ? error.message : String(error)}`)
      }
    }

    let shouldSwitchAccount = false

    if (account.fingerprint) {
      pushDebug(
        `fingerprint: quotaUser=${account.fingerprint.quotaUser} deviceId=${account.fingerprint.deviceId.slice(0, 8)}...`,
      )
    }

    if (accountManager.isRateLimitedForFamily(account, family, model)) {
      pushDebug(`selected account ${account.index} became rate-limited before dispatch`)
      shouldSwitchAccount = true
    }

    while (!shouldSwitchAccount) {
      let forceThinkingRecovery = false
      let tokenConsumed = false
      let capacityRetryCount = 0
      let capacityFingerprintRefreshCount = 0
      let lastEndpointIndex = -1

      for (let i = 0; i < ANTIGRAVITY_ENDPOINT_FALLBACKS.length; i++) {
        if (i !== lastEndpointIndex) {
          capacityRetryCount = 0
          capacityFingerprintRefreshCount = 0
          lastEndpointIndex = i
        }

        const currentEndpoint = ANTIGRAVITY_ENDPOINT_FALLBACKS[i]
        if (!currentEndpoint) continue

        try {
          const prepared = inference.prepareRequest({
            input,
            init,
            accessToken,
            projectId: projectContext.effectiveProjectId,
            endpointOverride: currentEndpoint,
            forceThinkingRecovery,
            options: {
              claudeToolHardening: config.claude_tool_hardening,
              claudePromptAutoCaching: config.claude_prompt_auto_caching,
              fingerprint: account.fingerprint,
            },
          })

          const originalUrl = toUrlString(input)
          const resolvedUrl = toUrlString(prepared.request)
          pushDebug(`endpoint=${currentEndpoint}`)
          pushDebug(`resolved=${resolvedUrl}`)
          const debugContext = startAntigravityDebugRequest({
            originalUrl,
            resolvedUrl,
            method: prepared.init.method,
            headers: prepared.init.headers,
            body: prepared.init.body,
            streaming: prepared.streaming,
            projectId: projectContext.effectiveProjectId,
          })

          /** Retains response metadata needed if all account/endpoint attempts fail. */
          const createFailureContext = (failureResponse: Response): FailureContext => ({
            response: failureResponse,
            streaming: prepared.streaming,
            debugContext,
            requestedModel: prepared.requestedModel,
            projectId: prepared.projectId,
            endpoint: prepared.endpoint,
            effectiveModel: prepared.effectiveModel,
            sessionId: prepared.sessionId,
            toolDebugMissing: prepared.toolDebugMissing,
            toolDebugSummary: prepared.toolDebugSummary,
            toolDebugPayload: prepared.toolDebugPayload,
          })

          await runThinkingWarmup(prepared, projectContext.effectiveProjectId)

          if (config.request_jitter_max_ms > 0) {
            const jitterMs = Math.floor(Math.random() * config.request_jitter_max_ms)
            if (jitterMs > 0) {
              await sleep(jitterMs, abortSignal)
            }
          }

          if (config.account_selection_strategy === "hybrid") {
            tokenConsumed = getTokenTracker().consume(account.index)
          }

          log.info("dispatching Antigravity request", {
            destination: new URL(toUrlString(prepared.request)).hostname,
            model: prepared.effectiveModel ?? prepared.requestedModel,
          })
          const response = await inferenceClient.send(prepared.request, prepared.init)
          pushDebug(`status=${response.status} ${response.statusText}`)

          if (response.status === 429 || response.status === 503 || response.status === 529) {
            if (tokenConsumed) {
              getTokenTracker().refund(account.index)
              tokenConsumed = false
            }

            const defaultRetryMs = (config.default_retry_after_seconds ?? 60) * 1000
            const maxBackoffMs = (config.max_backoff_seconds ?? 60) * 1000
            const headerRetryMs = retryAfterMsFromResponse(response, defaultRetryMs)
            const bodyInfo = await extractRetryInfoFromBody(response)
            const serverRetryMs = bodyInfo.retryDelayMs ?? headerRetryMs

            const rateLimitReason = parseRateLimitReason(bodyInfo.reason, bodyInfo.message, response.status)

            if (rateLimitReason === "MODEL_CAPACITY_EXHAUSTED" || rateLimitReason === "SERVER_ERROR") {
              const baseDelayMs = 1000
              const maxDelayMs = 8000
              const exponentialDelay = Math.min(baseDelayMs * Math.pow(2, capacityRetryCount), maxDelayMs)
              const jitter = exponentialDelay * (0.9 + Math.random() * 0.2)
              const waitMs = Math.round(jitter)
              const waitSec = Math.round(waitMs / 1000)

              pushDebug(
                `Server busy (${rateLimitReason}) on account ${account.index}, exponential backoff ${waitMs}ms (attempt ${capacityRetryCount + 1})`,
              )

              await showToast(`Server busy (${response.status}). Retrying in ${waitSec}s...`, "warning")

              await sleep(waitMs, abortSignal)

              if (capacityRetryCount < MAX_CAPACITY_RETRIES) {
                capacityRetryCount++
                i -= 1
                continue
              }

              if (capacityFingerprintRefreshCount < MAX_CAPACITY_FINGERPRINT_REFRESHES) {
                capacityFingerprintRefreshCount++
                pushDebug(
                  `Max capacity retries (${MAX_CAPACITY_RETRIES}) exhausted for endpoint ${currentEndpoint}, regenerating fingerprint...`,
                )
                const newFingerprint = accountManager.regenerateAccountFingerprint(account.index)
                if (newFingerprint) {
                  pushDebug(`Fingerprint regenerated for account ${account.index}`)
                }
                i -= 1
                continue
              }

              pushDebug(`Capacity retries exhausted for endpoint ${currentEndpoint}; moving to fallback`)
              lastFailure = createFailureContext(response)
              if (i < ANTIGRAVITY_ENDPOINT_FALLBACKS.length - 1) {
                await logResponseBody(debugContext, response, response.status)
                continue
              }

              accountManager.markRateLimitedWithReason(
                account,
                family,
                model,
                rateLimitReason,
                serverRetryMs,
                config.failure_ttl_seconds * 1000,
              )
              accountManager.requestSaveToDisk()
              getHealthTracker().recordRateLimit(account.index)
              await showToast("Server capacity retries exhausted. Returning the last provider error.", "warning")
              shouldSwitchAccount = true
              break
            }

            const quotaKey = quotaKeyForFamily(family)
            const { attempt, delayMs } = getRateLimitBackoff(account.index, quotaKey, serverRetryMs)

            const smartBackoffMs = calculateBackoffMs(rateLimitReason, account.consecutiveFailures ?? 0, serverRetryMs)
            const effectiveDelayMs = Math.max(delayMs, smartBackoffMs)

            pushDebug(
              `429 idx=${account.index} email=${account.email ?? ""} family=${family} delayMs=${effectiveDelayMs} attempt=${attempt} reason=${rateLimitReason}`,
            )
            if (bodyInfo.message) {
              pushDebug(`429 message=${bodyInfo.message}`)
            }
            if (bodyInfo.quotaResetTime) {
              pushDebug(`429 quotaResetTime=${bodyInfo.quotaResetTime}`)
            }
            if (bodyInfo.reason) {
              pushDebug(`429 reason=${bodyInfo.reason}`)
            }

            logRateLimitEvent(account.index, account.email, family, response.status, effectiveDelayMs, bodyInfo)

            await logResponseBody(debugContext, response, 429)

            getHealthTracker().recordRateLimit(account.index)

            if (attempt === 1 && rateLimitReason !== "QUOTA_EXHAUSTED") {
              await showToast(`Rate limited. Quick retry in 1s...`, "warning")
              await sleep(FIRST_RETRY_DELAY_MS, abortSignal)

              if (config.scheduling_mode === "cache_first") {
                const maxCacheFirstWaitMs = config.max_cache_first_wait_seconds * 1000
                if (effectiveDelayMs <= maxCacheFirstWaitMs) {
                  pushDebug(`cache_first: waiting ${effectiveDelayMs}ms for same account to recover`)
                  await showToast(
                    `Waiting ${Math.ceil(effectiveDelayMs / 1000)}s for same account (prompt cache preserved)...`,
                    "info",
                  )
                  accountManager.markRateLimitedWithReason(account, family, model, rateLimitReason, serverRetryMs)
                  await sleep(effectiveDelayMs, abortSignal)
                  i -= 1
                  continue
                }
                pushDebug(
                  `cache_first: wait ${effectiveDelayMs}ms exceeds max ${maxCacheFirstWaitMs}ms, switching account`,
                )
              }

              if (config.switch_on_first_rate_limit && accountCount > 1) {
                accountManager.markRateLimitedWithReason(
                  account,
                  family,
                  model,
                  rateLimitReason,
                  serverRetryMs,
                  config.failure_ttl_seconds * 1000,
                )
                shouldSwitchAccount = true
                break
              }

              i -= 1
              continue
            }

            accountManager.markRateLimitedWithReason(
              account,
              family,
              model,
              rateLimitReason,
              serverRetryMs,
              config.failure_ttl_seconds * 1000,
            )

            accountManager.requestSaveToDisk()

            if (accountCount > 1) {
              const quotaMsg = bodyInfo.quotaResetTime ? ` (quota resets ${bodyInfo.quotaResetTime})` : ``
              await showToast(`Rate limited again. Switching account in 5s...${quotaMsg}`, "warning")
              await sleep(SWITCH_ACCOUNT_DELAY_MS, abortSignal)
            } else {
              const expBackoffMs = Math.min(FIRST_RETRY_DELAY_MS * Math.pow(2, attempt - 1), 60000)
              const expBackoffFormatted =
                expBackoffMs >= 1000 ? `${Math.round(expBackoffMs / 1000)}s` : `${expBackoffMs}ms`
              await showToast(`Rate limited. Retrying in ${expBackoffFormatted} (attempt ${attempt})...`, "warning")
              await sleep(expBackoffMs, abortSignal)
            }

            lastFailure = createFailureContext(response)
            shouldSwitchAccount = true
            break
          }

          const quotaKey = quotaKeyForFamily(family)
          resetRateLimitState(account.index, quotaKey)
          resetAccountFailureState(account.index)

          if (response.status === 403) {
            const errorBodyText = await response
              .clone()
              .text()
              .catch(() => "")
            const extracted = extractVerificationErrorDetails(errorBodyText)

            if (extracted.validationRequired) {
              const verificationReason = extracted.message ?? "Google requires account verification."
              const cooldownMs = 10 * 60 * 1000

              accountManager.markAccountVerificationRequired(account.index, verificationReason, extracted.verifyUrl)
              accountManager.markAccountCoolingDown(account, cooldownMs, "validation-required")
              accountManager.markRateLimited(account, cooldownMs, family, model)

              const label = account.email || `Account ${account.index + 1}`
              if (accountManager.shouldShowAccountToast(account.index, 60000)) {
                await showToast(
                  `Account needs verification. Run 'opencode auth login' and use Verify accounts.`,
                  "warning",
                )
                accountManager.markToastShown(account.index)
              }

              pushDebug(`verification-required: disabled account ${account.index}`)
              getHealthTracker().recordFailure(account.index)

              lastFailure = createFailureContext(response)
              shouldSwitchAccount = true
              break
            }
          }

          const shouldRetryEndpoint = response.status === 403 || response.status === 404 || response.status >= 500

          if (shouldRetryEndpoint && i < ANTIGRAVITY_ENDPOINT_FALLBACKS.length - 1) {
            await logResponseBody(debugContext, response, response.status)
            lastFailure = createFailureContext(response)
            continue
          }

          if (response.ok) {
            account.consecutiveFailures = 0
            getHealthTracker().recordSuccess(account.index)
            accountManager.markAccountUsed(account.index)
          }
          logAntigravityDebugResponse(debugContext, response, {
            note: response.ok ? "Success" : `Error ${response.status}`,
          })
          if (response.ok && !prepared.streaming) {
            await logResponseBody(debugContext, response, response.status)
          }
          if (!response.ok) {
            await logResponseBody(debugContext, response, response.status)

            if (response.status === 400) {
              const cloned = response.clone()
              const bodyText = await cloned.text()
              if (bodyText.includes("Prompt is too long") || bodyText.includes("prompt_too_long")) {
                await showToast("Context too long - use /compact to reduce size", "warning")
                const errorMessage = `[Antigravity Error] Context is too long for this model.\n\nPlease use /compact to reduce context size, then retry your request.\n\nAlternatively, you can:\n- Use /clear to start fresh\n- Use /undo to remove recent messages\n- Switch to a model with larger context window`
                return createSyntheticErrorResponse(errorMessage, prepared.requestedModel)
              }
            }
          }

          if (response.ok && !prepared.streaming) {
            const maxAttempts = config.empty_response_max_attempts ?? 4
            const retryDelayMs = config.empty_response_retry_delay_ms ?? 2000

            const clonedForCheck = response.clone()
            const bodyText = await clonedForCheck.text()

            if (isEmptyResponseBody(bodyText)) {
              const emptyAttemptKey = `${prepared.sessionId ?? "none"}:${prepared.effectiveModel ?? "unknown"}`
              const currentAttempts = (emptyResponseAttempts.get(emptyAttemptKey) ?? 0) + 1
              emptyResponseAttempts.set(emptyAttemptKey, currentAttempts)

              pushDebug(`empty-response: attempt ${currentAttempts}/${maxAttempts}`)

              if (currentAttempts < maxAttempts) {
                await showToast(`Empty response received. Retrying (${currentAttempts}/${maxAttempts})...`, "warning")
                await sleep(retryDelayMs, abortSignal)
                continue
              }

              emptyResponseAttempts.delete(emptyAttemptKey)
              throw new EmptyResponseError("antigravity", prepared.effectiveModel ?? "unknown", currentAttempts)
            }

            const emptyAttemptKeyClean = `${prepared.sessionId ?? "none"}:${prepared.effectiveModel ?? "unknown"}`
            emptyResponseAttempts.delete(emptyAttemptKeyClean)
          }

          const transformedResponse = await inference.transformResponse({
            response,
            streaming: prepared.streaming,
            debugContext,
            requestedModel: prepared.requestedModel,
            projectId: prepared.projectId,
            endpoint: prepared.endpoint,
            effectiveModel: prepared.effectiveModel,
            sessionId: prepared.sessionId,
            toolDebugMissing: prepared.toolDebugMissing,
            toolDebugSummary: prepared.toolDebugSummary,
            toolDebugPayload: prepared.toolDebugPayload,
            debugLines,
          })

          const contextError = transformedResponse.headers.get("x-antigravity-context-error")
          if (contextError) {
            if (contextError === "prompt_too_long") {
              await showToast("Context too long - use /compact to reduce size, or trim your request", "warning")
            } else if (contextError === "tool_pairing") {
              await showToast("Tool call/result mismatch - use /compact to fix, or /undo last message", "warning")
            }
          }

          return transformedResponse
        } catch (error) {
          if (tokenConsumed) {
            getTokenTracker().refund(account.index)
            tokenConsumed = false
          }

          if (error instanceof Error && error.message === "THINKING_RECOVERY_NEEDED") {
            if (!forceThinkingRecovery) {
              pushDebug("thinking-recovery: API error detected, retrying with forced recovery")
              forceThinkingRecovery = true
              i = -1
              continue
            }

            const recoveryError = error as Error & { originalError?: { error?: { message?: string } } }
            const originalError = recoveryError.originalError || { error: { message: "Thinking recovery triggered" } }

            const recoveryMessage = `${originalError.error?.message || "Session recovery failed"}\n\n[RECOVERY] Thinking block corruption could not be resolved. Try starting a new session.`

            return new Response(
              JSON.stringify({
                type: "error",
                error: {
                  type: "unrecoverable_error",
                  message: recoveryMessage,
                },
              }),
              {
                status: 400,
                headers: { "Content-Type": "application/json" },
              },
            )
          }

          if (i < ANTIGRAVITY_ENDPOINT_FALLBACKS.length - 1) {
            lastError = error instanceof Error ? error : new Error(String(error))
            continue
          }

          const { failures, shouldCooldown, cooldownMs } = trackAccountFailure(account.index)
          lastError = error instanceof Error ? error : new Error(String(error))
          if (shouldCooldown) {
            accountManager.markAccountCoolingDown(account, cooldownMs, "network-error")
            accountManager.markRateLimited(account, cooldownMs, family, model)
            pushDebug(`endpoint-error: cooldown ${cooldownMs}ms after ${failures} failures`)
          }
          shouldSwitchAccount = true
          break
        }
      }
    }

    if (shouldSwitchAccount) {
      if (accountCount <= 1) {
        if (lastFailure) {
          return inference.transformResponse({
            response: lastFailure.response,
            streaming: lastFailure.streaming,
            debugContext: lastFailure.debugContext,
            requestedModel: lastFailure.requestedModel,
            projectId: lastFailure.projectId,
            endpoint: lastFailure.endpoint,
            effectiveModel: lastFailure.effectiveModel,
            sessionId: lastFailure.sessionId,
            toolDebugMissing: lastFailure.toolDebugMissing,
            toolDebugSummary: lastFailure.toolDebugSummary,
            toolDebugPayload: lastFailure.toolDebugPayload,
            debugLines,
          })
        }

        throw lastError || new Error("All Antigravity endpoints failed")
      }

      continue
    }

    if (lastFailure) {
      return inference.transformResponse({
        response: lastFailure.response,
        streaming: lastFailure.streaming,
        debugContext: lastFailure.debugContext,
        requestedModel: lastFailure.requestedModel,
        projectId: lastFailure.projectId,
        endpoint: lastFailure.endpoint,
        effectiveModel: lastFailure.effectiveModel,
        sessionId: lastFailure.sessionId,
        toolDebugMissing: lastFailure.toolDebugMissing,
        toolDebugSummary: lastFailure.toolDebugSummary,
        toolDebugPayload: lastFailure.toolDebugPayload,
        debugLines,
      })
    }

    throw lastError || new Error("All Antigravity accounts failed")
  }
}

/** Resets process-wide request state between isolated engine tests. */
export function resetEngineStateForTests(): void {
  warmupAttemptedSessionIds.clear()
  warmupSucceededSessionIds.clear()
  rateLimitToastCooldowns.clear()
  rateLimitStateByAccountQuota.clear()
  emptyResponseAttempts.clear()
  accountFailureState.clear()
  softQuotaToastShown = false
  rateLimitToastShown = false
}
