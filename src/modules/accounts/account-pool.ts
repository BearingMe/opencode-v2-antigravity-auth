import type {
  AccountPool,
  AccountSelectionInput,
  AccountSelectionStrategy,
  CooldownReason,
  ModelFamily,
  QuotaGroup,
} from "./index.js"
import type { AccountClockPort } from "./ports.js"
import {
  addTombstones,
  filterTombstonedAccounts,
  reconcilePendingTombstones,
  tombstoneForAccount,
  type AccountMetadataV3,
  type AccountStorageV4,
  type AccountTokenFingerprint,
  type QuotaSummaryGroup,
  type RateLimitStateV3,
  type RemovedAccountTombstone,
} from "./persistence/policy.js"
import type { AccountStorageUpdater } from "./persistence/service.js"
import { calculateBackoffMs, type RateLimitReason } from "./selection/backoff.js"
import {
  getHealthTracker,
  getTokenTracker,
  selectHybridAccount,
  type AccountWithMetrics,
} from "./selection/rotation.js"

/** OAuth data consumed by pool credential helpers. */
export interface PoolOAuthAuth {
  type: "oauth"
  refresh: string
  access?: string
  expires?: number
}

/** Refresh credential fields owned by an account. */
export interface PoolRefreshParts {
  refreshToken: string
  projectId?: string
  managedProjectId?: string
}

/** Device identity persisted with an account and sent by the transport adapter. */
export interface AccountFingerprint {
  deviceId: string
  sessionToken: string
  userAgent: string
  apiClient: string
  clientMetadata: { ideType: string; platform: string; pluginType: string }
  createdAt: number
  quotaUser?: string
}

/** Fingerprint snapshot retained for account recovery. */
export interface AccountFingerprintVersion {
  fingerprint: AccountFingerprint
  timestamp: number
  reason: "initial" | "regenerated" | "restored"
}

/** Dependencies required to construct pool state without importing adapters. */
export interface AccountPoolDependencies {
  clock: AccountClockPort
  update<Result>(updater: AccountStorageUpdater<Result>): Promise<Result>
  fingerprintToken: AccountTokenFingerprint
  generateId(): string
  generateFingerprint(): AccountFingerprint
  updateFingerprintVersion(fingerprint: AccountFingerprint): boolean
  processId: number
  formatAccountLabel(email: string | undefined, index: number): string
  logSoftQuotaSkipped(message: string): void
  logSelection(message: string): void
  random(): number
}

/** Persisted quota values cached on each account. */
export interface PoolQuotaGroupSummary {
  remainingFraction?: number
  resetTime?: string
  modelCount: number
}

const MAX_FINGERPRINT_HISTORY = 5

export type { RateLimitReason } from "./selection/backoff.js"

/** Base persisted quota keys shared across model requests. */
export type BaseQuotaKey = "claude" | "gemini-antigravity"
/** Persisted cooldown key, optionally scoped to one Gemini model. */
export type QuotaKey = BaseQuotaKey | `${BaseQuotaKey}:${string}`

/** In-memory account state owned by the pool and shared with trusted callers. */
export interface ManagedAccount {
  index: number

  id?: string
  email?: string
  addedAt: number
  lastUsed: number
  parts: PoolRefreshParts
  /**
   * Refresh token as loaded from disk. Compared at save time so a stale
   * manager never clobbers a token rotated by a newer service write:
   * only tokens this manager refreshed itself are written back.
   */
  loadedRefreshToken?: string
  access?: string
  expires?: number
  enabled: boolean
  rateLimitResetTimes: RateLimitStateV3
  lastSwitchReason?: "rate-limit" | "initial" | "rotation"
  coolingDownUntil?: number
  cooldownReason?: CooldownReason
  touchedForQuota: Record<string, number>
  consecutiveFailures?: number

  lastFailureTime?: number

  fingerprint?: AccountFingerprint

  fingerprintHistory?: AccountFingerprintVersion[]

  cachedQuota?: Partial<Record<QuotaGroup, PoolQuotaGroupSummary>>
  cachedQuotaUpdatedAt?: number
  cachedQuotaSummary?: QuotaSummaryGroup[]
  cachedQuotaSummaryUpdatedAt?: number
  verificationRequired?: boolean
  verificationRequiredAt?: number
  verificationRequiredReason?: string
  verificationUrl?: string
  lastVerificationAt?: number
  lastVerificationStatus?: "ok" | "blocked" | "error"
}

/** Parses the legacy packed refresh value without coupling the pool to auth transport code. */
function parseRefreshParts(refresh: string): PoolRefreshParts {
  const [refreshToken = "", projectId = "", managedProjectId = ""] = refresh.split("|")
  return {
    refreshToken,
    projectId: projectId || undefined,
    managedProjectId: managedProjectId || undefined,
  }
}

/** Serializes refresh fields in the persisted two- or three-part format. */
function formatRefreshParts(parts: PoolRefreshParts): string {
  const projectSegment = parts.projectId ?? ""
  const base = `${parts.refreshToken}|${projectSegment}`
  return parts.managedProjectId ? `${base}|${parts.managedProjectId}` : base
}

/** Keeps persisted cursor/timestamp values within the non-negative integer domain. */
function clampNonNegativeInt(value: unknown, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback
  }
  return value < 0 ? 0 : Math.floor(value)
}

/** Builds the persisted rate-limit key for a family and optional model. */
function getQuotaKey(family: ModelFamily, model?: string | null): QuotaKey {
  if (family === "claude") {
    return "claude"
  }
  const base = "gemini-antigravity"
  if (model) {
    return `${base}:${model}`
  }
  return base
}

/** Checks one saved rate-limit deadline against the supplied time. */
function isRateLimitedForQuotaKey(account: ManagedAccount, key: QuotaKey, now: number): boolean {
  const resetTime = account.rateLimitResetTimes[key]
  return resetTime !== undefined && now < resetTime
}

/** Applies family-level and legacy broad Gemini cooldowns to one account. */
function isAccountRateLimitedForFamily(
  account: ManagedAccount,
  family: ModelFamily,
  model: string | null | undefined,
  now: number,
): boolean {
  if (family === "claude") {
    return isRateLimitedForQuotaKey(account, "claude", now)
  }
  clearExpiredRateLimits(account, now)
  return (
    isRateLimitedForQuotaKey(account, getQuotaKey(family, model), now) ||
    (Boolean(model) && isRateLimitedForQuotaKey(account, getQuotaKey(family), now))
  )
}

/** Deletes cooldown entries whose deadline has passed. */
function clearExpiredRateLimits(account: ManagedAccount, now: number): void {
  const keys = Object.keys(account.rateLimitResetTimes) as QuotaKey[]
  for (const key of keys) {
    const resetTime = account.rateLimitResetTimes[key]
    if (resetTime !== undefined && now >= resetTime) {
      delete account.rateLimitResetTimes[key]
    }
  }
}

/**
 * Resolve the quota group for soft quota checks.
 *
 * Request routing supplies an inference classification when available. The
 * string check remains only for legacy direct callers during the migration.
 * When neither is available, selection falls back by family:
 * - Claude → "claude" quota group
 * - Gemini → "gemini-pro" (conservative fallback; may misclassify flash models)
 */
export function resolveQuotaGroup(family: ModelFamily, model?: string | null, quotaGroup?: QuotaGroup): QuotaGroup {
  if (quotaGroup) return quotaGroup
  if (model) {
    const normalizedModel = model.toLowerCase()
    if (normalizedModel.includes("claude")) return "claude"
    return normalizedModel.includes("flash") ? "gemini-flash" : "gemini-pro"
  }
  return family === "claude" ? "claude" : "gemini-pro"
}

/**
 * Applies cached quota policy using an inference-supplied group when present.
 *
 * Direct legacy callers retain model-string classification until their bridge
 * is migrated; the request engine always supplies the explicit group.
 */
function isOverSoftQuotaThreshold(
  account: ManagedAccount,
  family: ModelFamily,
  thresholdPercent: number,
  cacheTtlMs: number,
  now: number,
  formatLabel: AccountPoolDependencies["formatAccountLabel"],
  logSkipped: AccountPoolDependencies["logSoftQuotaSkipped"],
  model?: string | null,
  quotaGroup?: QuotaGroup,
): boolean {
  if (thresholdPercent >= 100) return false
  if (!account.cachedQuota) return false

  if (account.cachedQuotaUpdatedAt == null) return false
  const age = now - account.cachedQuotaUpdatedAt
  if (age > cacheTtlMs) return false

  const resolvedQuotaGroup = resolveQuotaGroup(family, model, quotaGroup)

  const groupData = account.cachedQuota[resolvedQuotaGroup]
  if (groupData?.remainingFraction == null) return false

  const remainingFraction = Math.max(0, Math.min(1, groupData.remainingFraction))
  const usedPercent = (1 - remainingFraction) * 100
  const isOverThreshold = usedPercent >= thresholdPercent

  if (isOverThreshold) {
    const accountLabel = formatLabel(account.email, account.index)
    const resetSuffix = groupData.resetTime ? ` (resets: ${groupData.resetTime})` : ""
    const message = `[SoftQuota] Skipping ${accountLabel}: ${resolvedQuotaGroup} usage ${usedPercent.toFixed(1)}% >= threshold ${thresholdPercent}%${resetSuffix}`
    logSkipped(message)
  }

  return isOverThreshold
}

/** Converts configured soft-quota cache age into milliseconds. */
export function computeSoftQuotaCacheTtlMs(ttlConfig: "auto" | number, refreshIntervalMinutes: number): number {
  if (ttlConfig === "auto") {
    return Math.max(2 * refreshIntervalMinutes, 10) * 60 * 1000
  }
  return ttlConfig * 60 * 1000
}

/**
 * In-memory multi-account manager with sticky account selection.
 *
 * Uses the same account until it hits a rate limit (429), then switches.
 * Rate limits are tracked per-model-family (claude/gemini) so an account
 * rate-limited for Claude can still be used for Gemini.
 *
 * Source of truth for the pool is `antigravity-accounts.json`.
 */
export class AccountPoolManager implements AccountPool<ManagedAccount> {
  private readonly dependencies: AccountPoolDependencies
  private accounts: ManagedAccount[] = []
  private cursor = 0
  private currentAccountIndexByFamily: Record<ModelFamily, number> = {
    claude: -1,
    gemini: -1,
  }
  private sessionOffsetApplied: Record<ModelFamily, boolean> = {
    claude: false,
    gemini: false,
  }
  private lastToastAccountIndex = -1
  private lastToastTime = 0

  private savePending = false
  private saveTimeout: ReturnType<typeof setTimeout> | null = null
  private savePromiseResolvers: Array<() => void> = []
  /**
   * Tombstones for accounts removed from this manager (delete tool,
   * invalid_grant eviction). Flushed into the store tombstones on the
   * next saveToDisk transaction so the removal survives restarts even if
   * this manager instance is stale.
   */
  private pendingTombstones: RemovedAccountTombstone[] = []

  /** Builds an account pool from persisted state and optional host credentials. */
  constructor(
    authFallback: PoolOAuthAuth | undefined,
    stored: AccountStorageV4 | null | undefined,
    dependencies: AccountPoolDependencies,
  ) {
    this.dependencies = dependencies
    const authParts = authFallback ? parseRefreshParts(authFallback.refresh) : null

    if (stored && stored.accounts.length === 0) {
      this.accounts = []
      this.cursor = 0
      return
    }

    if (stored && stored.accounts.length > 0) {
      const baseNow = this.dependencies.clock.now()
      this.accounts = stored.accounts
        .map((acc, index): ManagedAccount | null => {
          if (!acc.refreshToken || typeof acc.refreshToken !== "string") {
            return null
          }
          const matchesFallback = !!(
            authFallback &&
            authParts &&
            authParts.refreshToken &&
            acc.refreshToken === authParts.refreshToken
          )

          return {
            index,
            id: acc.id,
            email: acc.email,
            addedAt: clampNonNegativeInt(acc.addedAt, baseNow),
            lastUsed: clampNonNegativeInt(acc.lastUsed, 0),
            parts: {
              refreshToken: acc.refreshToken,
              projectId: acc.projectId,
              managedProjectId: acc.managedProjectId,
            },
            loadedRefreshToken: acc.refreshToken,
            access: matchesFallback ? authFallback?.access : undefined,
            expires: matchesFallback ? authFallback?.expires : undefined,
            enabled: acc.enabled !== false,
            rateLimitResetTimes: acc.rateLimitResetTimes ?? {},
            lastSwitchReason: acc.lastSwitchReason,
            coolingDownUntil: acc.coolingDownUntil,
            cooldownReason: acc.cooldownReason,
            touchedForQuota: {},
            fingerprint: acc.fingerprint ?? this.dependencies.generateFingerprint(),
            fingerprintHistory: acc.fingerprintHistory ?? [],
            cachedQuota: acc.cachedQuota as Partial<Record<QuotaGroup, PoolQuotaGroupSummary>> | undefined,
            cachedQuotaUpdatedAt: acc.cachedQuotaUpdatedAt,
            cachedQuotaSummary: acc.cachedQuotaSummary,
            cachedQuotaSummaryUpdatedAt: acc.cachedQuotaSummaryUpdatedAt,
            verificationRequired: acc.verificationRequired,
            verificationRequiredAt: acc.verificationRequiredAt,
            verificationRequiredReason: acc.verificationRequiredReason,
            verificationUrl: acc.verificationUrl,
            lastVerificationAt: acc.lastVerificationAt,
            lastVerificationStatus: acc.lastVerificationStatus,
          }
        })
        .filter((a): a is ManagedAccount => a !== null)

      // Update fingerprint versions to match the current runtime version.
      // Saved fingerprints may carry an older version string; this ensures
      // they always reflect the latest fetched (or fallback) version.
      let fingerprintVersionChanged = false
      for (const acc of this.accounts) {
        if (acc.fingerprint && this.dependencies.updateFingerprintVersion(acc.fingerprint)) {
          fingerprintVersionChanged = true
        }
      }

      this.cursor = clampNonNegativeInt(stored.activeIndex, 0)
      if (this.accounts.length > 0) {
        this.cursor = this.cursor % this.accounts.length
        const defaultIndex = this.cursor
        this.currentAccountIndexByFamily.claude =
          clampNonNegativeInt(stored.activeIndexByFamily?.claude, defaultIndex) % this.accounts.length
        this.currentAccountIndexByFamily.gemini =
          clampNonNegativeInt(stored.activeIndexByFamily?.gemini, defaultIndex) % this.accounts.length
      }

      // Persist updated fingerprint versions to disk
      if (fingerprintVersionChanged) {
        this.requestSaveToDisk()
      }

      return
    }

    // If we have stored accounts, check if we need to add the current auth
    if (authFallback && this.accounts.length > 0) {
      const authParts = parseRefreshParts(authFallback.refresh)
      const hasMatching = this.accounts.some((acc) => acc.parts.refreshToken === authParts.refreshToken)
      if (!hasMatching && authParts.refreshToken) {
        const now = this.dependencies.clock.now()
        const newAccount: ManagedAccount = {
          index: this.accounts.length,
          email: undefined,
          addedAt: now,
          lastUsed: 0,
          parts: authParts,
          loadedRefreshToken: authParts.refreshToken,
          access: authFallback.access,
          expires: authFallback.expires,
          enabled: true,
          rateLimitResetTimes: {},
          touchedForQuota: {},
        }
        this.accounts.push(newAccount)
        // Update indices to include the new account
        this.currentAccountIndexByFamily.claude = Math.min(
          this.currentAccountIndexByFamily.claude,
          this.accounts.length - 1,
        )
        this.currentAccountIndexByFamily.gemini = Math.min(
          this.currentAccountIndexByFamily.gemini,
          this.accounts.length - 1,
        )
      }
    }

    if (authFallback) {
      const parts = parseRefreshParts(authFallback.refresh)
      if (parts.refreshToken) {
        const now = this.dependencies.clock.now()
        this.accounts = [
          {
            index: 0,
            email: undefined,
            addedAt: now,
            lastUsed: 0,
            parts,
            loadedRefreshToken: parts.refreshToken,
            access: authFallback.access,
            expires: authFallback.expires,
            enabled: true,
            rateLimitResetTimes: {},
            touchedForQuota: {},
          },
        ]
        this.cursor = 0
        this.currentAccountIndexByFamily.claude = 0
        this.currentAccountIndexByFamily.gemini = 0
      }
    }
  }

  /** Applies the injected clock to account cooldown cleanup. */
  private clearExpiredRateLimits(account: ManagedAccount): void {
    clearExpiredRateLimits(account, this.dependencies.clock.now())
  }

  /** Checks a family/model cooldown against the pool's clock. */
  private hasRateLimit(account: ManagedAccount, family: ModelFamily, model?: string | null): boolean {
    return isAccountRateLimitedForFamily(account, family, model, this.dependencies.clock.now())
  }

  /** Applies cached-quota policy and reports skips through the host logging port. */
  private isOverSoftQuota(
    account: ManagedAccount,
    family: ModelFamily,
    thresholdPercent: number,
    cacheTtlMs: number,
    model?: string | null,
    quotaGroup?: QuotaGroup,
  ): boolean {
    return isOverSoftQuotaThreshold(
      account,
      family,
      thresholdPercent,
      cacheTtlMs,
      this.dependencies.clock.now(),
      this.dependencies.formatAccountLabel,
      this.dependencies.logSoftQuotaSkipped,
      model,
      quotaGroup,
    )
  }

  /** Returns the number of enabled accounts available to the request engine. */
  getAccountCount(): number {
    return this.getEnabledAccounts().length
  }

  /** Returns pool membership size, including disabled accounts. */
  getTotalAccountCount(): number {
    return this.accounts.length
  }

  /** Lists enabled pool members in their stable current index order. */
  getEnabledAccounts(): ManagedAccount[] {
    return this.accounts.filter((account) => account.enabled !== false)
  }

  /** Returns shallow account snapshots with independently copied mutable state. */
  getAccountsSnapshot(): ManagedAccount[] {
    return this.accounts.map((a) => ({
      ...a,
      parts: { ...a.parts },
      rateLimitResetTimes: { ...a.rateLimitResetTimes },
    }))
  }

  /** Returns the family's current account only while it remains enabled. */
  getCurrentAccountForFamily(family: ModelFamily): ManagedAccount | null {
    const currentIndex = this.currentAccountIndexByFamily[family]
    if (currentIndex >= 0 && currentIndex < this.accounts.length) {
      const account = this.accounts[currentIndex] ?? null
      // Only return account if it's enabled - disabled accounts should not be selected
      if (account && account.enabled !== false) {
        return account
      }
    }
    return null
  }

  /** Records the selected account and the reason for a family switch. */
  markSwitched(account: ManagedAccount, reason: "rate-limit" | "initial" | "rotation", family: ModelFamily): void {
    account.lastSwitchReason = reason
    this.currentAccountIndexByFamily[family] = account.index
  }

  /**
   * Check if we should show an account switch toast.
   * Debounces repeated toasts for the same account.
   */
  shouldShowAccountToast(accountIndex: number, debounceMs = 30000): boolean {
    const now = this.dependencies.clock.now()
    if (accountIndex !== this.lastToastAccountIndex) {
      return true
    }
    return now - this.lastToastTime >= debounceMs
  }

  /** Starts the toast debounce interval for the selected account. */
  markToastShown(accountIndex: number): void {
    this.lastToastAccountIndex = accountIndex
    this.lastToastTime = this.dependencies.clock.now()
  }

  /**
   * Selects an account while preserving the supplied inference quota group.
   *
   * @example `manager.getCurrentOrNextForFamily("gemini", model, "hybrid", false, 90, ttl, group)`
   */
  getCurrentOrNextForFamily(
    family: ModelFamily,
    model?: string | null,
    strategy: AccountSelectionStrategy = "sticky",
    pidOffsetEnabled: boolean = false,
    softQuotaThresholdPercent: number = 100,
    softQuotaCacheTtlMs: number = 10 * 60 * 1000,
    quotaGroup?: QuotaGroup,
  ): ManagedAccount | null {
    const quotaKey = getQuotaKey(family, model)

    if (strategy === "round-robin") {
      const next = this.getNextForFamily(family, model, softQuotaThresholdPercent, softQuotaCacheTtlMs, quotaGroup)
      if (next) {
        this.markTouchedForQuota(next, quotaKey)
        this.currentAccountIndexByFamily[family] = next.index
      }
      return next
    }

    if (strategy === "hybrid") {
      const healthTracker = getHealthTracker()
      const tokenTracker = getTokenTracker()

      const accountsWithMetrics: AccountWithMetrics[] = this.accounts
        .filter((acc) => acc.enabled !== false)
        .map((acc) => {
          this.clearExpiredRateLimits(acc)
          return {
            index: acc.index,
            lastUsed: acc.lastUsed,
            healthScore: healthTracker.getScore(acc.index),
            isRateLimited:
              this.hasRateLimit(acc, family, model) ||
              this.isOverSoftQuota(acc, family, softQuotaThresholdPercent, softQuotaCacheTtlMs, model, quotaGroup),
            isCoolingDown: this.isAccountCoolingDown(acc),
          }
        })

      // Get current account index for stickiness
      const currentIndex = this.currentAccountIndexByFamily[family] ?? null

      const selectedIndex = selectHybridAccount(
        accountsWithMetrics,
        tokenTracker,
        currentIndex,
        50,
        this.dependencies.clock.now(),
      )
      if (selectedIndex !== null) {
        const selected = this.accounts[selectedIndex]
        if (selected) {
          selected.lastUsed = this.dependencies.clock.now()
          this.markTouchedForQuota(selected, quotaKey)
          this.currentAccountIndexByFamily[family] = selected.index
          return selected
        }
      }
    }

    // Fallback: sticky selection (used when hybrid finds no candidates)
    // PID-based offset for multi-session distribution (opt-in)
    // Different sessions (PIDs) will prefer different starting accounts
    if (pidOffsetEnabled && !this.sessionOffsetApplied[family] && this.accounts.length > 1) {
      const pidOffset = this.dependencies.processId % this.accounts.length
      const baseIndex = this.currentAccountIndexByFamily[family] ?? 0
      const newIndex = (baseIndex + pidOffset) % this.accounts.length

      this.dependencies.logSelection(
        `[Account] Applying PID offset: pid=${this.dependencies.processId} offset=${pidOffset} family=${family} index=${baseIndex}->${newIndex}`,
      )

      this.currentAccountIndexByFamily[family] = newIndex
      this.sessionOffsetApplied[family] = true
    }

    const current = this.getCurrentAccountForFamily(family)
    if (current) {
      this.clearExpiredRateLimits(current)
      const isLimited = this.hasRateLimit(current, family, model)
      const isOverThreshold = this.isOverSoftQuota(
        current,
        family,
        softQuotaThresholdPercent,
        softQuotaCacheTtlMs,
        model,
        quotaGroup,
      )
      if (!isLimited && !isOverThreshold && !this.isAccountCoolingDown(current)) {
        this.markTouchedForQuota(current, quotaKey)
        return current
      }
    }

    const next = this.getNextForFamily(family, model, softQuotaThresholdPercent, softQuotaCacheTtlMs, quotaGroup)
    if (next) {
      this.markTouchedForQuota(next, quotaKey)
      this.currentAccountIndexByFamily[family] = next.index
    }
    return next
  }

  /**
   * Finds the next eligible account using the provided model classification.
   *
   * @example `manager.getNextForFamily("gemini", model, 90, ttl, "gemini-flash")`
   */
  getNextForFamily(
    family: ModelFamily,
    model?: string | null,
    softQuotaThresholdPercent: number = 100,
    softQuotaCacheTtlMs: number = 10 * 60 * 1000,
    quotaGroup?: QuotaGroup,
  ): ManagedAccount | null {
    const available = this.accounts.filter((a) => {
      this.clearExpiredRateLimits(a)
      return (
        a.enabled !== false &&
        !this.hasRateLimit(a, family, model) &&
        !this.isOverSoftQuota(a, family, softQuotaThresholdPercent, softQuotaCacheTtlMs, model, quotaGroup) &&
        !this.isAccountCoolingDown(a)
      )
    })

    if (available.length === 0) {
      return null
    }

    const account = available[this.cursor % available.length]
    if (!account) {
      return null
    }

    this.cursor++
    // Note: lastUsed is now updated after successful request via markAccountUsed()
    return account
  }

  /** Selects a pool member using inference's explicit family and quota classification. */
  selectForRequest(input: AccountSelectionInput): ManagedAccount | null {
    const { family, model, quotaGroup } = input.classification
    return this.getCurrentOrNextForFamily(
      family,
      model,
      input.strategy,
      input.pidOffsetEnabled,
      input.softQuotaThresholdPercent,
      input.softQuotaCacheTtlMs,
      quotaGroup,
    )
  }

  /** Sets an explicit retry deadline for an account's family/model quota. */
  markRateLimited(account: ManagedAccount, retryAfterMs: number, family: ModelFamily, model?: string | null): void {
    const key = getQuotaKey(family, model)
    account.rateLimitResetTimes[key] = this.dependencies.clock.now() + retryAfterMs
  }

  /**
   * Mark an account as used after a successful API request.
   * This updates the lastUsed timestamp for freshness calculations.
   * Should be called AFTER request completion, not during account selection.
   */
  markAccountUsed(accountIndex: number): void {
    const account = this.accounts.find((a) => a.index === accountIndex)
    if (account) {
      account.lastUsed = this.dependencies.clock.now()
    }
  }

  /** Tracks a consecutive failure and applies the classified retry backoff. */
  markRateLimitedWithReason(
    account: ManagedAccount,
    family: ModelFamily,
    model: string | null | undefined,
    reason: RateLimitReason,
    retryAfterMs?: number | null,
    failureTtlMs: number = 3600_000, // Default 1 hour TTL
  ): number {
    const now = this.dependencies.clock.now()

    // TTL-based reset: if last failure was more than failureTtlMs ago, reset count
    if (account.lastFailureTime !== undefined && now - account.lastFailureTime > failureTtlMs) {
      account.consecutiveFailures = 0
    }

    const failures = (account.consecutiveFailures ?? 0) + 1
    account.consecutiveFailures = failures
    account.lastFailureTime = now

    const backoffMs = calculateBackoffMs(reason, failures - 1, retryAfterMs, this.dependencies.random)
    const key = getQuotaKey(family, model)
    account.rateLimitResetTimes[key] = now + backoffMs

    return backoffMs
  }

  /** Clears consecutive request failures after a successful response. */
  markRequestSuccess(account: ManagedAccount): void {
    if (account.consecutiveFailures) {
      account.consecutiveFailures = 0
    }
  }

  /** Removes saved cooldowns for one family/model and clears failure counts. */
  clearAllRateLimitsForFamily(family: ModelFamily, model?: string | null): void {
    for (const account of this.accounts) {
      if (family === "claude") {
        delete account.rateLimitResetTimes.claude
      } else {
        delete account.rateLimitResetTimes[getQuotaKey(family, model)]
      }
      account.consecutiveFailures = 0
    }
  }

  /** Reports whether the earliest family retry deadline is within two seconds. */
  shouldTryOptimisticReset(family: ModelFamily, model?: string | null): boolean {
    const minWaitMs = this.getMinWaitTimeForFamily(family, model)
    return minWaitMs > 0 && minWaitMs <= 2_000
  }

  /** Temporarily excludes an account for a typed lifecycle failure. */
  markAccountCoolingDown(account: ManagedAccount, cooldownMs: number, reason: CooldownReason): void {
    account.coolingDownUntil = this.dependencies.clock.now() + cooldownMs
    account.cooldownReason = reason
  }

  /** Checks and lazily clears the account's temporary lifecycle cooldown. */
  isAccountCoolingDown(account: ManagedAccount): boolean {
    if (account.coolingDownUntil === undefined) {
      return false
    }
    if (this.dependencies.clock.now() >= account.coolingDownUntil) {
      this.clearAccountCooldown(account)
      return false
    }
    return true
  }

  /** Clears an account's cooldown deadline and reason. */
  clearAccountCooldown(account: ManagedAccount): void {
    delete account.coolingDownUntil
    delete account.cooldownReason
  }

  /** Returns the reason only while the account remains in cooldown. */
  getAccountCooldownReason(account: ManagedAccount): CooldownReason | undefined {
    return this.isAccountCoolingDown(account) ? account.cooldownReason : undefined
  }

  /** Records that this account was probed for a quota key at the injected time. */
  markTouchedForQuota(account: ManagedAccount, quotaKey: string): void {
    account.touchedForQuota[quotaKey] = this.dependencies.clock.now()
  }

  /** Determines whether a quota check is newer than the relevant reset. */
  isFreshForQuota(account: ManagedAccount, quotaKey: string): boolean {
    const touchedAt = account.touchedForQuota[quotaKey]
    if (!touchedAt) return true

    const resetTime = account.rateLimitResetTimes[quotaKey as QuotaKey]
    if (resetTime && touchedAt < resetTime) return true

    return false
  }

  /** Lists enabled accounts with fresh quota state and no active exclusions. */
  getFreshAccountsForQuota(quotaKey: string, family: ModelFamily, model?: string | null): ManagedAccount[] {
    return this.accounts.filter((acc) => {
      this.clearExpiredRateLimits(acc)
      return (
        acc.enabled !== false &&
        this.isFreshForQuota(acc, quotaKey) &&
        !this.hasRateLimit(acc, family, model) &&
        !this.isAccountCoolingDown(acc)
      )
    })
  }

  /** Reports whether one account is currently limited for a family/model. */
  isRateLimitedForFamily(account: ManagedAccount, family: ModelFamily, model?: string | null): boolean {
    return this.hasRateLimit(account, family, model)
  }

  /**
   * Check if any other enabled account has quota available for this family/model.
   */
  hasOtherAccountAvailable(currentAccountIndex: number, family: ModelFamily, model?: string | null): boolean {
    return this.accounts.some((acc) => {
      // Skip current account
      if (acc.index === currentAccountIndex) {
        return false
      }
      // Skip disabled accounts
      if (acc.enabled === false) {
        return false
      }
      // Skip cooling down accounts
      if (this.isAccountCoolingDown(acc)) {
        return false
      }
      // Clear expired rate limits before checking
      this.clearExpiredRateLimits(acc)
      return !this.hasRateLimit(acc, family, model)
    })
  }

  /** Changes pool eligibility and queues persistence of the account state. */
  setAccountEnabled(accountIndex: number, enabled: boolean): boolean {
    const account = this.accounts[accountIndex]
    if (!account) {
      return false
    }
    account.enabled = enabled

    if (!enabled) {
      for (const family of Object.keys(this.currentAccountIndexByFamily) as ModelFamily[]) {
        if (this.currentAccountIndexByFamily[family] === accountIndex) {
          const next = this.accounts.find((a, i) => i !== accountIndex && a.enabled !== false)
          this.currentAccountIndexByFamily[family] = next?.index ?? -1
        }
      }
    }

    this.requestSaveToDisk()
    return true
  }

  /** Records verification metadata and disables an account until resolved. */
  markAccountVerificationRequired(accountIndex: number, reason?: string, verifyUrl?: string): boolean {
    const account = this.accounts[accountIndex]
    if (!account) {
      return false
    }

    account.verificationRequired = true
    account.verificationRequiredAt = this.dependencies.clock.now()
    account.verificationRequiredReason = reason?.trim() || undefined

    const normalizedVerifyUrl = verifyUrl?.trim()
    if (normalizedVerifyUrl) {
      account.verificationUrl = normalizedVerifyUrl
    }

    if (account.enabled !== false) {
      this.setAccountEnabled(accountIndex, false)
    } else {
      this.requestSaveToDisk()
    }

    return true
  }

  /** Clears verification metadata and optionally restores previous eligibility. */
  clearAccountVerificationRequired(accountIndex: number, enableAccount = false): boolean {
    const account = this.accounts[accountIndex]
    if (!account) {
      return false
    }

    const wasVerificationRequired = account.verificationRequired === true
    const hadMetadata =
      account.verificationRequiredAt !== undefined ||
      account.verificationRequiredReason !== undefined ||
      account.verificationUrl !== undefined

    account.verificationRequired = false
    account.verificationRequiredAt = undefined
    account.verificationRequiredReason = undefined
    account.verificationUrl = undefined

    if (enableAccount && wasVerificationRequired && account.enabled === false) {
      this.setAccountEnabled(accountIndex, true)
    } else if (wasVerificationRequired || hadMetadata) {
      this.requestSaveToDisk()
    }

    return true
  }

  /** Removes a pool member by its current stable index. */
  removeAccountByIndex(accountIndex: number): boolean {
    if (accountIndex < 0 || accountIndex >= this.accounts.length) {
      return false
    }
    const account = this.accounts[accountIndex]
    if (!account) {
      return false
    }
    return this.removeAccount(account)
  }

  /** Removes a member, queues its tombstone, and repairs pool cursors. */
  removeAccount(account: ManagedAccount): boolean {
    const idx = this.accounts.indexOf(account)
    if (idx < 0) {
      return false
    }

    const [removed] = this.accounts.splice(idx, 1)
    // Tombstone the removal so a later background save (this manager may
    // be stale by then) can never resurrect the account from its snapshot.
    if (removed) {
      this.pendingTombstones.push(
        tombstoneForAccount(
          {
            id: removed.id,
            refreshToken: removed.parts.refreshToken,
            email: removed.email,
          },
          this.dependencies.fingerprintToken,
          this.dependencies.clock.now(),
        ),
      )
    }
    this.accounts.forEach((acc, index) => {
      acc.index = index
    })

    if (this.accounts.length === 0) {
      this.cursor = 0
      this.currentAccountIndexByFamily.claude = -1
      this.currentAccountIndexByFamily.gemini = -1
      return true
    }

    if (this.cursor > idx) {
      this.cursor -= 1
    }
    this.cursor = this.cursor % this.accounts.length

    for (const family of ["claude", "gemini"] as ModelFamily[]) {
      if (this.currentAccountIndexByFamily[family] > idx) {
        this.currentAccountIndexByFamily[family] -= 1
      }
      if (this.currentAccountIndexByFamily[family] >= this.accounts.length) {
        this.currentAccountIndexByFamily[family] = -1
      }
    }

    return true
  }

  /** Applies refreshed credentials while retaining project identifiers omitted by refresh. */
  updateFromAuth(account: ManagedAccount, auth: PoolOAuthAuth): void {
    const parts = parseRefreshParts(auth.refresh)
    // Preserve existing projectId/managedProjectId if not in the new parts
    account.parts = {
      ...parts,
      projectId: parts.projectId ?? account.parts.projectId,
      managedProjectId: parts.managedProjectId ?? account.parts.managedProjectId,
    }
    account.access = auth.access
    account.expires = auth.expires
  }

  /** Converts a managed account to the OAuth shape expected by trusted callers. */
  toAuthDetails(account: ManagedAccount): PoolOAuthAuth {
    return {
      type: "oauth",
      refresh: formatRefreshParts(account.parts),
      access: account.access,
      expires: account.expires,
    }
  }

  /** Returns the earliest cooldown expiry for enabled accounts in a family. */
  getMinWaitTimeForFamily(family: ModelFamily, model?: string | null): number {
    const available = this.accounts.filter((a) => {
      this.clearExpiredRateLimits(a)
      return a.enabled !== false && !this.hasRateLimit(a, family, model)
    })
    if (available.length > 0) {
      return 0
    }

    const waitTimes: number[] = []
    for (const a of this.accounts) {
      if (family === "claude") {
        const t = a.rateLimitResetTimes.claude
        if (t !== undefined) waitTimes.push(Math.max(0, t - this.dependencies.clock.now()))
      } else {
        const keys = model ? [getQuotaKey(family, model), getQuotaKey(family)] : [getQuotaKey(family)]
        const accountWaits = keys
          .map((key) => a.rateLimitResetTimes[key])
          .filter((resetTime): resetTime is number => resetTime !== undefined)
          .map((resetTime) => Math.max(0, resetTime - this.dependencies.clock.now()))
        if (accountWaits.length > 0) waitTimes.push(Math.max(...accountWaits))
      }
    }

    return waitTimes.length > 0 ? Math.min(...waitTimes) : 0
  }

  /** Returns a new array containing the managed account references. */
  getAccounts(): ManagedAccount[] {
    return [...this.accounts]
  }

  /** Persists the current pool while preserving fresh disk membership and tombstones. */
  async saveToDisk(): Promise<void> {
    const snapshot = this.accounts.map((account) => {
      const id = account.id ?? this.dependencies.generateId()
      account.id = id
      return {
        id,
        email: account.email,
        refreshToken: account.parts.refreshToken,
        projectId: account.parts.projectId,
        managedProjectId: account.parts.managedProjectId,
        tokenChanged:
          account.loadedRefreshToken !== undefined && account.parts.refreshToken !== account.loadedRefreshToken,
        loadedRefreshToken: account.loadedRefreshToken,
        addedAt: account.addedAt,
        lastUsed: account.lastUsed,
        enabled: account.enabled,
        lastSwitchReason: account.lastSwitchReason,
        rateLimitResetTimes: { ...account.rateLimitResetTimes },
        coolingDownUntil: account.coolingDownUntil,
        cooldownReason: account.cooldownReason,
        fingerprint: account.fingerprint,
        fingerprintHistory: account.fingerprintHistory,
        cachedQuota: account.cachedQuota,
        cachedQuotaUpdatedAt: account.cachedQuotaUpdatedAt,
        cachedQuotaSummary: account.cachedQuotaSummary,
        cachedQuotaSummaryUpdatedAt: account.cachedQuotaSummaryUpdatedAt,
        verificationRequired: account.verificationRequired,
        verificationRequiredAt: account.verificationRequiredAt,
        verificationRequiredReason: account.verificationRequiredReason,
        verificationUrl: account.verificationUrl,
        lastVerificationAt: account.lastVerificationAt,
        lastVerificationStatus: account.lastVerificationStatus,
      }
    })
    const pending = [...this.pendingTombstones]

    await this.dependencies.update((current) => {
      // Reconcile stale deletions against fresh disk membership: a pending
      // tombstone only applies when a disk account still matches it under
      // strict generation rules (durable id with token/email corroboration,
      // or an identical token fingerprint). A re-added account (fresh id and
      // fresh token, same email) is a new generation, so the stale entry is
      // dropped and can neither re-tombstone disk nor filter the re-added
      // account.
      const reconciled = reconcilePendingTombstones(pending, current.accounts, this.dependencies.fingerprintToken)
      const tombstones = addTombstones(current.removedAccounts, reconciled)
      const memById = new Map(snapshot.map((entry) => [entry.id, entry]))
      const memByToken = new Map<string, (typeof snapshot)[number]>()
      const memByLoadedToken = new Map<string, (typeof snapshot)[number]>()
      for (const entry of snapshot) {
        memByToken.set(entry.refreshToken, entry)
        if (entry.loadedRefreshToken) {
          memByLoadedToken.set(entry.loadedRefreshToken, entry)
        }
      }

      // Disk is the source of truth for membership; memory only refreshes
      // fields of accounts still present. Tombstoned entries are never
      // re-added, which is what stops a stale manager from resurrecting
      // a deleted account.
      const merged: AccountMetadataV3[] = []
      for (const disk of current.accounts) {
        const mem =
          (disk.id !== undefined ? memById.get(disk.id) : undefined) ??
          memByToken.get(disk.refreshToken) ??
          memByLoadedToken.get(disk.refreshToken)
        if (!mem) {
          merged.push(disk)
          continue
        }
        const next: AccountMetadataV3 = {
          ...disk,
          id: disk.id ?? mem.id,
          email: disk.email ?? mem.email,
          // Only tokens this manager refreshed itself are written back; a
          // stale untouched token never clobbers a newer service rotation.
          refreshToken: mem.tokenChanged ? mem.refreshToken : disk.refreshToken,
          projectId: mem.tokenChanged ? (mem.projectId ?? disk.projectId) : disk.projectId,
          managedProjectId: mem.tokenChanged ? (mem.managedProjectId ?? disk.managedProjectId) : disk.managedProjectId,
          addedAt: disk.addedAt,
          lastUsed: Math.max(disk.lastUsed ?? 0, mem.lastUsed ?? 0),
          enabled: mem.enabled,
          lastSwitchReason: mem.lastSwitchReason ?? disk.lastSwitchReason,
          rateLimitResetTimes: { ...mem.rateLimitResetTimes },
          coolingDownUntil: mem.coolingDownUntil,
          cooldownReason: mem.cooldownReason,
          fingerprint: mem.fingerprint ?? disk.fingerprint,
          fingerprintHistory: mem.fingerprintHistory ?? disk.fingerprintHistory,
          verificationRequired: mem.verificationRequired,
          verificationRequiredAt: mem.verificationRequiredAt,
          verificationRequiredReason: mem.verificationRequiredReason,
          verificationUrl: mem.verificationUrl,
          lastVerificationAt: mem.lastVerificationAt,
          lastVerificationStatus: mem.lastVerificationStatus,
        }
        if (
          mem.cachedQuotaUpdatedAt !== undefined &&
          (disk.cachedQuotaUpdatedAt === undefined || mem.cachedQuotaUpdatedAt >= disk.cachedQuotaUpdatedAt)
        ) {
          next.cachedQuota = mem.cachedQuota
          next.cachedQuotaUpdatedAt = mem.cachedQuotaUpdatedAt
        }
        if (
          mem.cachedQuotaSummaryUpdatedAt !== undefined &&
          (disk.cachedQuotaSummaryUpdatedAt === undefined ||
            mem.cachedQuotaSummaryUpdatedAt >= disk.cachedQuotaSummaryUpdatedAt)
        ) {
          next.cachedQuotaSummary = mem.cachedQuotaSummary
          next.cachedQuotaSummaryUpdatedAt = mem.cachedQuotaSummaryUpdatedAt
        }
        merged.push(next)
      }

      // Memory-only accounts (first-run auth fallback) are appended unless
      // tombstoned. Stale deleted accounts are blocked here by the filter.
      for (const mem of snapshot) {
        const known = current.accounts.some(
          (disk) =>
            (disk.id !== undefined && disk.id === mem.id) ||
            disk.refreshToken === mem.refreshToken ||
            (mem.loadedRefreshToken !== undefined && disk.refreshToken === mem.loadedRefreshToken),
        )
        if (known) {
          continue
        }
        const candidate: AccountMetadataV3 = {
          id: mem.id,
          email: mem.email,
          refreshToken: mem.refreshToken,
          projectId: mem.projectId,
          managedProjectId: mem.managedProjectId,
          addedAt: mem.addedAt,
          lastUsed: mem.lastUsed,
          enabled: mem.enabled,
          lastSwitchReason: mem.lastSwitchReason,
          rateLimitResetTimes: { ...mem.rateLimitResetTimes },
          coolingDownUntil: mem.coolingDownUntil,
          cooldownReason: mem.cooldownReason,
          fingerprint: mem.fingerprint,
          fingerprintHistory: mem.fingerprintHistory,
          cachedQuota: mem.cachedQuota,
          cachedQuotaUpdatedAt: mem.cachedQuotaUpdatedAt,
          cachedQuotaSummary: mem.cachedQuotaSummary,
          cachedQuotaSummaryUpdatedAt: mem.cachedQuotaSummaryUpdatedAt,
          verificationRequired: mem.verificationRequired,
          verificationRequiredAt: mem.verificationRequiredAt,
          verificationRequiredReason: mem.verificationRequiredReason,
          verificationUrl: mem.verificationUrl,
          lastVerificationAt: mem.lastVerificationAt,
          lastVerificationStatus: mem.lastVerificationStatus,
        }
        if (filterTombstonedAccounts([candidate], tombstones, this.dependencies.fingerprintToken).length === 0) {
          continue
        }
        merged.push(candidate)
      }

      // Selection cursors stay service-owned; only clamp them to the
      // merged membership.
      const activeIndex = merged.length > 0 ? Math.min(Math.max(current.activeIndex, 0), merged.length - 1) : 0
      const clampFamily = (value: number | undefined): number =>
        merged.length > 0 ? Math.min(Math.max(value ?? activeIndex, 0), merged.length - 1) : 0
      const storage: AccountStorageV4 = {
        version: 4,
        accounts: merged,
        activeIndex,
        activeIndexByFamily: {
          claude: clampFamily(current.activeIndexByFamily?.claude),
          gemini: clampFamily(current.activeIndexByFamily?.gemini),
        },
        removedAccounts: tombstones,
      }
      return { storage, result: undefined }
    })

    // The flush succeeded: freshly written tokens become the new baseline
    // and flushed tombstones are dropped from the pending list.
    for (const account of this.accounts) {
      account.loadedRefreshToken = account.parts.refreshToken
    }
    this.pendingTombstones = this.pendingTombstones.slice(pending.length)
  }

  /** Coalesces rapid state changes into one delayed persistence transaction. */
  requestSaveToDisk(): void {
    if (this.savePending) {
      return
    }
    this.savePending = true
    this.saveTimeout = setTimeout(() => {
      void this.executeSave()
    }, 1000)
  }

  /** Waits for the currently queued best-effort save to settle. */
  async flushSaveToDisk(): Promise<void> {
    if (!this.savePending) {
      return
    }
    return new Promise<void>((resolve) => {
      this.savePromiseResolvers.push(resolve)
    })
  }

  /** Runs the queued save and resolves waiters even when persistence fails. */
  private async executeSave(): Promise<void> {
    this.savePending = false
    this.saveTimeout = null

    try {
      await this.saveToDisk()
    } catch {
      // best-effort persistence; avoid unhandled rejection from timer-driven saves
    } finally {
      const resolvers = this.savePromiseResolvers
      this.savePromiseResolvers = []
      for (const resolve of resolvers) {
        resolve()
      }
    }
  }

  // ========== Fingerprint Management ==========

  /**
   * Regenerate fingerprint for an account, saving the old one to history.
   */
  regenerateAccountFingerprint(accountIndex: number): AccountFingerprint | null {
    const account = this.accounts[accountIndex]
    if (!account) return null

    // Save current fingerprint to history if it exists
    if (account.fingerprint) {
      const historyEntry: AccountFingerprintVersion = {
        fingerprint: account.fingerprint,
        timestamp: this.dependencies.clock.now(),
        reason: "regenerated",
      }

      if (!account.fingerprintHistory) {
        account.fingerprintHistory = []
      }

      // Add to beginning of history (most recent first)
      account.fingerprintHistory.unshift(historyEntry)

      // Trim to max history size
      if (account.fingerprintHistory.length > MAX_FINGERPRINT_HISTORY) {
        account.fingerprintHistory = account.fingerprintHistory.slice(0, MAX_FINGERPRINT_HISTORY)
      }
    }

    // Generate and assign new fingerprint
    account.fingerprint = this.dependencies.generateFingerprint()
    this.requestSaveToDisk()

    return account.fingerprint
  }

  /**
   * Restore a fingerprint from history for an account.
   */
  restoreAccountFingerprint(accountIndex: number, historyIndex: number): AccountFingerprint | null {
    const account = this.accounts[accountIndex]
    if (!account) return null

    const history = account.fingerprintHistory
    if (!history || historyIndex < 0 || historyIndex >= history.length) {
      return null
    }

    // Capture the fingerprint to restore BEFORE modifying history
    const fingerprintToRestore = history[historyIndex]!.fingerprint

    // Save current fingerprint to history before restoring (if it exists)
    if (account.fingerprint) {
      const historyEntry: AccountFingerprintVersion = {
        fingerprint: account.fingerprint,
        timestamp: this.dependencies.clock.now(),
        reason: "restored",
      }

      account.fingerprintHistory!.unshift(historyEntry)

      // Trim to max history size
      if (account.fingerprintHistory!.length > MAX_FINGERPRINT_HISTORY) {
        account.fingerprintHistory = account.fingerprintHistory!.slice(0, MAX_FINGERPRINT_HISTORY)
      }
    }

    // Restore the fingerprint
    account.fingerprint = { ...fingerprintToRestore, createdAt: this.dependencies.clock.now() }

    this.requestSaveToDisk()

    return account.fingerprint
  }

  /**
   * Get fingerprint history for an account.
   */
  getAccountFingerprintHistory(accountIndex: number): AccountFingerprintVersion[] {
    const account = this.accounts[accountIndex]
    if (!account || !account.fingerprintHistory) {
      return []
    }
    return [...account.fingerprintHistory]
  }

  /** Replaces an account's cached quota reading at the injected time. */
  updateQuotaCache(accountIndex: number, quotaGroups: Partial<Record<QuotaGroup, PoolQuotaGroupSummary>>): void {
    const account = this.accounts[accountIndex]
    if (account) {
      account.cachedQuota = quotaGroups
      account.cachedQuotaUpdatedAt = this.dependencies.clock.now()
    }
  }

  /** Reports whether cached quota usage meets the configured threshold. */
  isAccountOverSoftQuota(
    account: ManagedAccount,
    family: ModelFamily,
    thresholdPercent: number,
    cacheTtlMs: number,
    model?: string | null,
  ): boolean {
    return this.isOverSoftQuota(account, family, thresholdPercent, cacheTtlMs, model)
  }

  /** Returns the credential-bearing account fields required by the quota probe. */
  getAccountsForQuotaCheck(): AccountMetadataV3[] {
    return this.accounts.map((a) => ({
      email: a.email,
      refreshToken: a.parts.refreshToken,
      projectId: a.parts.projectId,
      managedProjectId: a.parts.managedProjectId,
      addedAt: a.addedAt,
      lastUsed: a.lastUsed,
      enabled: a.enabled,
    }))
  }

  /** Returns the oldest enabled-account quota age, or null when any is unchecked. */
  getOldestQuotaCacheAge(): number | null {
    let oldest: number | null = null
    for (const acc of this.accounts) {
      if (acc.enabled === false) continue
      if (acc.cachedQuotaUpdatedAt == null) return null
      const age = this.dependencies.clock.now() - acc.cachedQuotaUpdatedAt
      if (oldest === null || age > oldest) oldest = age
    }
    return oldest
  }

  /**
   * Reports whether every enabled account exceeds the selected quota group.
   *
   * @example `manager.areAllAccountsOverSoftQuota("gemini", 90, ttl, model, group)`
   */
  areAllAccountsOverSoftQuota(
    family: ModelFamily,
    thresholdPercent: number,
    cacheTtlMs: number,
    model?: string | null,
    quotaGroup?: QuotaGroup,
  ): boolean {
    if (thresholdPercent >= 100) return false
    const enabled = this.accounts.filter((a) => a.enabled !== false)
    if (enabled.length === 0) return false
    return enabled.every((a) => this.isOverSoftQuota(a, family, thresholdPercent, cacheTtlMs, model, quotaGroup))
  }

  /**
   * Get minimum wait time until any account's soft quota resets.
   * Returns 0 if any account is available (not over threshold).
   * Returns the minimum resetTime across all over-threshold accounts.
   * Returns null if no resetTime data is available.
   * The request engine passes the quota group already resolved by inference.
   */
  getMinWaitTimeForSoftQuota(
    family: ModelFamily,
    thresholdPercent: number,
    cacheTtlMs: number,
    model?: string | null,
    quotaGroup?: QuotaGroup,
  ): number | null {
    if (thresholdPercent >= 100) return 0

    const enabled = this.accounts.filter((a) => a.enabled !== false)
    if (enabled.length === 0) return null

    // If any account is available (not over threshold), no wait needed
    const available = enabled.filter(
      (a) => !this.isOverSoftQuota(a, family, thresholdPercent, cacheTtlMs, model, quotaGroup),
    )
    if (available.length > 0) return 0

    // All accounts are over threshold - find earliest reset time
    // For gemini family, we MUST have the model to distinguish pro vs flash quotas.
    // Fail-open (return null = no wait info) if model is missing to avoid blocking on wrong quota.
    if (!model && family !== "claude") return null
    const resolvedQuotaGroup = resolveQuotaGroup(family, model, quotaGroup)
    const now = this.dependencies.clock.now()
    const waitTimes: number[] = []

    for (const acc of enabled) {
      const groupData = acc.cachedQuota?.[resolvedQuotaGroup]
      if (groupData?.resetTime) {
        const resetTimestamp = Date.parse(groupData.resetTime)
        if (Number.isFinite(resetTimestamp)) {
          waitTimes.push(Math.max(0, resetTimestamp - now))
        }
      }
    }

    if (waitTimes.length === 0) return null
    const minWait = Math.min(...waitTimes)
    // Treat 0 as stale cache (resetTime in the past) → fail-open to avoid spin loop
    return minWait === 0 ? null : minWait
  }
}
