import type { QuotaPresentation, QuotaPresentationOptions } from "../index.js"
import type { AccountPersistenceService } from "../persistence/service.js"
import type {
  AccountMetadataV3,
  AccountStorageV4,
  QuotaSummaryGroup,
  QuotaSummaryWindow,
} from "../persistence/policy.js"
import type { AccountQuotaGroup, AccountQuotaResult } from "./types.js"

/** Quota results safe to return after removing rotated credential fields. */
export type RedactedQuotaResult = Omit<AccountQuotaResult, "updatedAccount">

/** Outcome of checking accounts and persisting any safe token rotations. */
export interface QuotaCheckOutcome {
  results: RedactedQuotaResult[]
  persistedUpdates: number
}

/** Quota families presented by account management. */
export type QuotaPresentationGroup = AccountQuotaGroup

/** Ports required by quota checking, cache persistence, and presentation policy. */
export interface AccountQuotaPolicyDependencies {
  persistence: AccountPersistenceService
  fingerprintRefreshToken(refreshToken: string): string
  generateId(): string
  now(): number
  checkQuota(accounts: AccountMetadataV3[], signal?: AbortSignal): Promise<AccountQuotaResult[]>
  warn(message: string): void
}

/** Provides the empty in-memory representation when no account store exists. */
function emptyStorage(): AccountStorageV4 {
  return { version: 4, accounts: [], activeIndex: 0 }
}

/** Keeps a selected account cursor inside the persisted pool. */
function clampCursor(value: number | undefined, fallback: number, length: number): number {
  if (length <= 0) return 0
  if (typeof value !== "number" || !Number.isFinite(value)) return Math.min(fallback, length - 1)
  return Math.min(Math.max(Math.trunc(value), 0), length - 1)
}

/** Resolves the current cursors, falling back to the legacy global index. */
function familyCursors(storage: AccountStorageV4, length: number): { claude: number; gemini: number } {
  const fallback = length > 0 ? clampCursor(storage.activeIndex, 0, length) : 0
  return {
    claude: clampCursor(storage.activeIndexByFamily?.claude, fallback, length),
    gemini: clampCursor(storage.activeIndexByFamily?.gemini, fallback, length),
  }
}

/** Assigns durable ids to legacy account records before a quota write. */
function ensureAccountIds(accounts: AccountMetadataV3[], generateId: () => string): void {
  for (const account of accounts) {
    if (!account.id) account.id = generateId()
  }
}
/** Removes rotated credential material before returning quota results. */
function redactQuotaResult(result: AccountQuotaResult): RedactedQuotaResult {
  const { updatedAccount: _removed, ...redacted } = result
  return redacted
}

/**
 * Check quota for every saved account and return redacted results. Rotated
 * token/project metadata reported via `updatedAccount` is persisted back to
 * the plugin disk store (matched by previous refresh token against freshly
 * loaded storage, token/project fields only); unmatched entries are skipped
 * without failing the whole check.
 */
export async function checkQuota(dependencies: AccountQuotaPolicyDependencies): Promise<QuotaCheckOutcome> {
  const stored = (await dependencies.persistence.load()) ?? emptyStorage()
  const accounts = [...stored.accounts]
  const results = await dependencies.checkQuota(accounts)

  let persistedUpdates = 0
  const pending = results.filter((result) => result.updatedAccount !== undefined)
  if (pending.length > 0) {
    // Apply rotated token/project metadata inside one lock acquisition so a
    // concurrent mutation cannot interleave between the read and the write.
    // Matching is by previous refresh token against freshly locked storage;
    // unmatched or ambiguous entries are skipped without failing the check.
    persistedUpdates = await dependencies.persistence.update((current) => {
      const freshAccounts = [...current.accounts]
      ensureAccountIds(freshAccounts, dependencies.generateId)
      let applied = 0
      let dirty = false
      for (const [position, account] of accounts.entries()) {
        const updated = results[position]?.updatedAccount
        if (!updated) continue
        const candidates = freshAccounts.filter((entry) => entry.refreshToken === account.refreshToken)
        if (candidates.length !== 1 || !candidates[0]) continue
        candidates[0].refreshToken = updated.refreshToken
        candidates[0].projectId = updated.projectId
        candidates[0].managedProjectId = updated.managedProjectId
        dirty = true
        applied += 1
      }
      if (!dirty) return { storage: current, result: 0 }
      return { storage: { ...current, accounts: freshAccounts }, result: applied }
    })
  }

  return { results: results.map(redactQuotaResult), persistedUpdates }
}

const QUOTA_PRESENTATION_GROUPS: QuotaPresentationGroup[] = ["claude", "gemini-pro", "gemini-flash"]
const QUOTA_SUMMARY_WINDOWS: QuotaSummaryWindow[] = ["weekly", "5h"]

/** Validates cached or fetched summary groups before they cross the RPC boundary. */
function normalizeQuotaSummaryGroups(value: unknown): QuotaSummaryGroup[] {
  if (!Array.isArray(value)) return []
  const groups: QuotaSummaryGroup[] = []
  for (const candidate of value.slice(0, 10)) {
    if (typeof candidate !== "object" || candidate === null || Array.isArray(candidate)) continue
    const group = candidate as Record<string, unknown>
    if (typeof group.displayName !== "string") continue
    const displayName = sanitizeQuotaSummaryText(group.displayName, 120)
    if (!displayName) continue

    const rawBuckets = typeof group.buckets === "object" && group.buckets !== null ? group.buckets : {}
    const buckets: QuotaSummaryGroup["buckets"] = {}
    for (const window of QUOTA_SUMMARY_WINDOWS) {
      const rawBucket = (rawBuckets as Record<string, unknown>)[window]
      if (typeof rawBucket !== "object" || rawBucket === null || Array.isArray(rawBucket)) continue
      const bucket = rawBucket as Record<string, unknown>
      const fraction = bucket.remainingFraction
      const remainingFraction =
        typeof fraction === "number" && Number.isFinite(fraction) && fraction >= 0 && fraction <= 1
          ? fraction
          : undefined
      const resetTime = parseQuotaResetTime(bucket.resetTime)
      if (remainingFraction === undefined && resetTime === null) continue
      buckets[window] = {
        ...(remainingFraction === undefined ? {} : { remainingFraction }),
        ...(resetTime === null ? {} : { resetTime: new Date(resetTime).toISOString() }),
      }
    }
    if (Object.keys(buckets).length === 0) continue

    const description = typeof group.description === "string" ? sanitizeQuotaSummaryText(group.description, 300) : ""
    groups.push({ displayName, ...(description ? { description } : {}), buckets })
  }
  return groups
}

/** Removes terminal control characters from text loaded from the account store. */
function sanitizeQuotaSummaryText(value: string, maxLength: number): string {
  return Array.from(value)
    .filter((character) => {
      const codePoint = character.codePointAt(0) ?? 0
      return codePoint >= 0x20 && (codePoint < 0x7f || codePoint > 0x9f)
    })
    .join("")
    .trim()
    .slice(0, maxLength)
}

/** Projects saved quota data to fixed weekly and five-hour UI buckets. */
function presentQuotaSummaryGroups(groups: QuotaSummaryGroup[]) {
  return groups.map((group) => {
    const buckets = Object.fromEntries(
      QUOTA_SUMMARY_WINDOWS.map((window) => {
        const bucket = group.buckets[window]
        const fraction = bucket?.remainingFraction
        return [
          window,
          {
            remainingFraction:
              typeof fraction === "number" && Number.isFinite(fraction) && fraction >= 0 && fraction <= 1
                ? fraction
                : null,
            resetTime: parseQuotaResetTime(bucket?.resetTime),
          },
        ]
      }),
    ) as Record<QuotaSummaryWindow, { remainingFraction: number | null; resetTime: number | null }>
    return {
      displayName: group.displayName,
      description: group.description ?? null,
      buckets,
    }
  })
}

/** Persists only newer successful quota readings for the same account generation. */
async function persistQuotaSnapshots(
  dependencies: AccountQuotaPolicyDependencies,
  accounts: Array<AccountMetadataV3>,
  results: Array<AccountQuotaResult | undefined>,
  checkedAt: number,
): Promise<AccountStorageV4> {
  if (
    !results.some(
      (result) =>
        result?.status === "ok" &&
        ((result.quota && !result.quota.error) ||
          (result.quota?.quotaSummaryStatus === "ok" && result.quota.quotaSummaryGroups)),
    )
  ) {
    return (await dependencies.persistence.load()) ?? emptyStorage()
  }
  return dependencies.persistence.update((current) => {
    let dirty = false
    const next = current.accounts.map((account) => {
      // Reconnects change the token, deletions remove the identity. Never
      // apply an in-flight check to a different generation of that account.
      const index = accounts.findIndex(
        (source) =>
          source.id === account.id &&
          source.refreshToken === account.refreshToken &&
          source.addedAt === account.addedAt,
      )
      const result = results[index]
      if (!result || result.status !== "ok" || !result.quota) return account
      let updated = account

      if (!result.quota.error && (account.cachedQuotaUpdatedAt ?? 0) <= checkedAt) {
        const groups: NonNullable<AccountMetadataV3["cachedQuota"]> = {}
        for (const key of QUOTA_PRESENTATION_GROUPS) {
          const group = result.quota.groups[key]
          const fraction = group?.remainingFraction
          if (typeof fraction !== "number" || !Number.isFinite(fraction) || fraction < 0 || fraction > 1) continue
          const reset = parseQuotaResetTime(group?.resetTime)
          groups[key] = {
            remainingFraction: fraction,
            modelCount: group?.modelCount ?? 0,
            ...(reset === null ? {} : { resetTime: new Date(reset).toISOString() }),
          }
        }
        if (Object.keys(groups).length > 0) {
          updated = { ...updated, cachedQuota: groups, cachedQuotaUpdatedAt: checkedAt }
        }
      }

      const summaryGroups = normalizeQuotaSummaryGroups(result.quota.quotaSummaryGroups)
      if (
        result.quota.quotaSummaryStatus === "ok" &&
        summaryGroups.length > 0 &&
        (account.cachedQuotaSummaryUpdatedAt ?? 0) <= checkedAt
      ) {
        updated = { ...updated, cachedQuotaSummary: summaryGroups, cachedQuotaSummaryUpdatedAt: checkedAt }
      }
      if (updated === account) return account
      dirty = true
      return updated
    })
    const storage = dirty ? { ...current, accounts: next } : current
    return { storage, result: storage }
  })
}

const DEFAULT_QUOTA_STALE_AFTER_MS = 15 * 60 * 1000
const DEFAULT_QUOTA_TIMEOUT_MS = 12_000

/** Converts a stored reset value to epoch milliseconds when valid. */
function parseQuotaResetTime(value: unknown): number | null {
  if (typeof value !== "string" || value.trim() === "") return null
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : null
}

/** Keeps UI-requested quota timeouts inside the supported bound. */
function boundedTimeout(value: number | undefined): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.min(Math.max(Math.trunc(value), 1_000), 30_000)
    : DEFAULT_QUOTA_TIMEOUT_MS
}

/** Stops waiting for one account's quota check without cancelling refresh/setup policy. */
async function checkSingleAccountQuota(
  dependencies: AccountQuotaPolicyDependencies,
  account: AccountMetadataV3,
  index: number,
  timeoutMs: number,
): Promise<AccountQuotaResult | undefined> {
  const controller = new AbortController()
  let timeout: ReturnType<typeof setTimeout> | undefined
  try {
    const check = dependencies.checkQuota([account], controller.signal).then((results) => results[0])
    return await Promise.race([
      check,
      new Promise<undefined>((resolve) => {
        timeout = setTimeout(() => {
          controller.abort()
          resolve(undefined)
        }, timeoutMs)
      }),
    ]).then((result) => (result ? { ...result, index } : undefined))
  } catch {
    return undefined
  } finally {
    if (timeout) clearTimeout(timeout)
  }
}

/**
 * Build credential-free quota bars and grouped quota windows for the UI.
 * Unknown Antigravity values stay null instead of being treated as available.
 */
export async function getQuotaPresentation(
  dependencies: AccountQuotaPolicyDependencies,
  options: QuotaPresentationOptions = {},
): Promise<QuotaPresentation> {
  let storage = (await dependencies.persistence.load()) ?? emptyStorage()
  const sources = storage.accounts
  const checkStartedAt = dependencies.now()
  const refresh = options.refresh !== false
  const timeoutMs = boundedTimeout(options.timeoutMs)
  const staleAfterMs =
    typeof options.staleAfterMs === "number" && Number.isFinite(options.staleAfterMs)
      ? Math.max(0, options.staleAfterMs)
      : DEFAULT_QUOTA_STALE_AFTER_MS

  const refreshed = refresh
    ? await Promise.all(
        storage.accounts.map(async (account, index) => {
          if (account.enabled === false) return undefined
          return checkSingleAccountQuota(dependencies, account, index, timeoutMs)
        }),
      )
    : []

  if (refresh) {
    try {
      storage = await persistQuotaSnapshots(dependencies, sources, refreshed, checkStartedAt)
    } catch {
      // Cache persistence is best-effort. Reload authoritative identities and
      // metadata rather than projecting the pre-check pool after a failed write.
      // Do not log raw storage errors: they can contain credential material.
      dependencies.warn("Failed to persist quota snapshots; reloading account state")
      storage = (await dependencies.persistence.load()) ?? emptyStorage()
    }
  }
  const familySelection = familyCursors(storage, storage.accounts.length)

  const now = dependencies.now()
  const accounts = storage.accounts.map((account, index) => {
    const sourceIndex = sources.findIndex(
      (source) =>
        source.id === account.id && source.refreshToken === account.refreshToken && source.addedAt === account.addedAt,
    )
    const result = refreshed[sourceIndex]
    const cachedAt =
      typeof account.cachedQuotaUpdatedAt === "number" && Number.isFinite(account.cachedQuotaUpdatedAt)
        ? account.cachedQuotaUpdatedAt
        : null
    const checkAttempted = refresh && sources[sourceIndex]?.enabled !== false && sourceIndex >= 0
    const resultHasError = checkAttempted && (!result || result.status === "error" || !!result.quota?.error)
    const resultHasKnownQuota = Object.values(result?.quota?.groups ?? {}).some((group) => {
      const value = group.remainingFraction
      return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1
    })
    const useFreshQuota =
      !!result && !resultHasError && resultHasKnownQuota && (account.cachedQuotaUpdatedAt ?? 0) <= checkStartedAt
    const checkedAt = useFreshQuota ? checkStartedAt : cachedAt
    const cacheIsStale = cachedAt === null || now - cachedAt > staleAfterMs || cachedAt > now
    const quotaGroups = useFreshQuota ? result.quota?.groups : account.cachedQuota
    const groups = Object.fromEntries(
      QUOTA_PRESENTATION_GROUPS.map((group) => {
        const quota = quotaGroups?.[group]
        const raw = quota?.remainingFraction
        const fraction = typeof raw === "number" && Number.isFinite(raw) && raw >= 0 && raw <= 1 ? raw : null
        return [
          group,
          {
            remainingFraction: fraction,
            consumedPercent: fraction === null ? null : Math.round((1 - fraction) * 1000) / 10,
            resetTime: parseQuotaResetTime(quota?.resetTime),
          },
        ]
      }),
    ) as QuotaPresentation["accounts"][number]["groups"]
    const resultSummaryGroups = normalizeQuotaSummaryGroups(result?.quota?.quotaSummaryGroups)
    const freshSummary =
      result?.status === "ok" &&
      result.quota?.quotaSummaryStatus === "ok" &&
      resultSummaryGroups.length > 0 &&
      (account.cachedQuotaSummaryUpdatedAt ?? 0) <= checkStartedAt
    const cachedSummaryGroups = normalizeQuotaSummaryGroups(account.cachedQuotaSummary)
    const summaryGroups = freshSummary ? resultSummaryGroups : cachedSummaryGroups
    const summaryCheckedAt = freshSummary
      ? checkStartedAt
      : typeof account.cachedQuotaSummaryUpdatedAt === "number" && Number.isFinite(account.cachedQuotaSummaryUpdatedAt)
        ? account.cachedQuotaSummaryUpdatedAt
        : null
    const summaryCacheIsStale =
      summaryCheckedAt === null || now - summaryCheckedAt > staleAfterMs || summaryCheckedAt > now
    const summaryCheckFailed =
      checkAttempted && (!result || result.status === "error" || result.quota?.quotaSummaryStatus === "error")
    let summaryStatus: "ok" | "error" | "unknown" = "unknown"
    if (freshSummary || (summaryGroups.length > 0 && result?.quota?.quotaSummaryStatus !== "unknown")) {
      summaryStatus = "ok"
    }
    if (summaryCheckFailed) summaryStatus = "error"
    if (result?.quota?.quotaSummaryStatus === "unknown" && !freshSummary) summaryStatus = "unknown"

    const quotaSummary: QuotaPresentation["accounts"][number]["quotaSummary"] = {
      groups: presentQuotaSummaryGroups(summaryGroups),
      checkedAt: summaryCheckedAt,
      freshness: freshSummary
        ? "fresh"
        : summaryCheckedAt === null
          ? "unchecked"
          : summaryCacheIsStale
            ? "stale"
            : "fresh",
      status: summaryStatus,
    }
    const hasKnownQuota = Object.values(groups).some((group) => group.remainingFraction !== null)
    const status: QuotaPresentation["accounts"][number]["status"] = resultHasError
      ? "error"
      : checkAttempted && !resultHasKnownQuota
        ? "unknown"
        : hasKnownQuota
          ? "ok"
          : "unknown"
    const freshness: QuotaPresentation["accounts"][number]["freshness"] = useFreshQuota
      ? "fresh"
      : cachedAt === null
        ? "unchecked"
        : cacheIsStale
          ? "stale"
          : "fresh"
    const accountId = account.id ?? dependencies.fingerprintRefreshToken(account.refreshToken)

    return {
      id: accountId,
      email: account.email ?? `Account ${index + 1}`,
      enabled: account.enabled !== false,
      status,
      groups,
      quotaSummary,
      checkedAt,
      freshness,
      verificationRequired: account.verificationRequired === true,
      cooldownUntil:
        typeof account.coolingDownUntil === "number" && Number.isFinite(account.coolingDownUntil)
          ? account.coolingDownUntil
          : null,
      coolingDown: typeof account.coolingDownUntil === "number" && account.coolingDownUntil > now,
      selectedByFamily: {
        claude: index === familySelection.claude,
        gemini: index === familySelection.gemini,
      },
    }
  })

  return { activeIndexByFamily: familySelection, accounts }
}

/** Creates quota-check and presentation operations over account-owned ports. */
export function createAccountQuotaPolicy(dependencies: AccountQuotaPolicyDependencies) {
  return {
    check: () => checkQuota(dependencies),
    present: (options?: QuotaPresentationOptions) => getQuotaPresentation(dependencies, options),
  }
}
