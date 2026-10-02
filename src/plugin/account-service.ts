import { randomUUID } from "node:crypto"
import { z } from "zod"
import { ANTIGRAVITY_PROVIDER_ID } from "../constants.js"
import { checkAccountsQuota, type AccountQuotaResult } from "./quota.js"
import {
  addTombstones,
  clearTombstonesForAccount,
  fingerprintRefreshToken,
  loadAccounts,
  tombstoneForAccount,
  updateAccounts,
  type AccountMetadataV3,
  type AccountStorageV4,
  type ModelFamily,
  type QuotaSummaryGroup,
  type QuotaSummaryWindow,
} from "./storage.js"
import { verifyAccountAccess } from "./verify.js"
import { createLogger } from "./logger.js"
import type { PluginClient, RefreshParts } from "./types.js"

const log = createLogger("account-service")

export const MAX_SAVED_ACCOUNTS = 10

export type VerificationStatus = "verification_required" | "ok" | "blocked" | "error" | "not_checked"

export interface AccountSummary {
  /**
   * Durable opaque account id. Stable across refresh-token rotation.
   * Accounts predating ids report a deterministic token fingerprint until a
   * service write backfills a durable id; that fallback never resolves as a
   * mutation target (fail closed).
   */
  id: string
  index: number
  email: string
  enabled: boolean
  active: boolean
  verificationRequired: boolean
  verificationStatus: VerificationStatus
  lastVerificationAt?: number
  cooldownUntil?: number
  quotaResetTimes?: AccountMetadataV3["rateLimitResetTimes"]
}

export interface AccountList {
  activeIndex: number
  activeIndexByFamily: { claude: number; gemini: number }
  accounts: AccountSummary[]
}

export type RedactedQuotaResult = Omit<AccountQuotaResult, "updatedAccount">

export interface QuotaCheckOutcome {
  results: RedactedQuotaResult[]

  persistedUpdates: number
}

export type QuotaPresentationGroup = "claude" | "gemini-pro" | "gemini-flash"

export const quotaPresentationSchema = z
  .object({
    activeIndexByFamily: z.object({ claude: z.number().int().nonnegative(), gemini: z.number().int().nonnegative() }),
    accounts: z.array(
      z
        .object({
          id: z.string(),
          email: z.string(),
          enabled: z.boolean(),
          status: z.enum(["ok", "error", "unknown"]),
          groups: z.record(
            z.enum(["claude", "gemini-pro", "gemini-flash"]),
            z
              .object({
                remainingFraction: z.number().min(0).max(1).nullable(),
                consumedPercent: z.number().min(0).max(100).nullable(),
                resetTime: z.number().finite().nullable(),
              })
              .strict(),
          ),
          quotaSummary: z
            .object({
              groups: z.array(
                z
                  .object({
                    displayName: z.string().max(120),
                    description: z.string().max(300).nullable(),
                    buckets: z
                      .object({
                        weekly: z
                          .object({
                            remainingFraction: z.number().min(0).max(1).nullable(),
                            resetTime: z.number().finite().nullable(),
                          })
                          .strict(),
                        "5h": z
                          .object({
                            remainingFraction: z.number().min(0).max(1).nullable(),
                            resetTime: z.number().finite().nullable(),
                          })
                          .strict(),
                      })
                      .strict(),
                  })
                  .strict(),
              ),
              checkedAt: z.number().finite().nullable(),
              freshness: z.enum(["fresh", "stale", "unchecked"]),
              status: z.enum(["ok", "error", "unknown"]),
            })
            .strict(),
          checkedAt: z.number().finite().nullable(),
          freshness: z.enum(["fresh", "stale", "unchecked"]),
          verificationRequired: z.boolean(),
          cooldownUntil: z.number().finite().nullable(),
          coolingDown: z.boolean(),
          selectedByFamily: z.object({ claude: z.boolean(), gemini: z.boolean() }).strict(),
        })
        .strict(),
    ),
  })
  .strict()

export type QuotaPresentation = z.infer<typeof quotaPresentationSchema>

export interface QuotaPresentationOptions {
  refresh?: boolean

  timeoutMs?: number

  staleAfterMs?: number
}

export type AccountTarget = { id: string } | { index: number }

export type TargetResolution =
  { ok: true; index: number } | { ok: false; kind: "invalid-index" | "not-found" | "ambiguous"; accountCount: number }

export type ResolutionFailure = Exclude<TargetResolution, { ok: true }>

export interface VerifyOutcome {
  index: number
  email?: string
  checkedAt: number
  status: "ok" | "blocked" | "error"
  message: string
  verifyUrl?: string
}

export type MutationOp = "select" | "enable" | "disable" | "delete"

export interface MutateOptions {
  /**
   * Family-scoped selection for future UI use. When omitted (legacy tool
   * path), `select` moves the global cursor and both family cursors; see
   * LEGACY_TOOL_SELECT_UPDATES_BOTH_FAMILIES.
   */
  family?: ModelFamily
}

export interface SelectedAccount {
  id: string
  index: number
  email?: string
  refreshParts: RefreshParts
}

export interface MutationOutcome {
  op: MutationOp
  index: number
  nextActiveIndex: number
  activeIndexByFamily: { claude: number; gemini: number }
  remaining: number

  selected: SelectedAccount | null
}

export type MutationFailure = ResolutionFailure | { ok: false; kind: "unknown-op"; accountCount: number }

export interface OAuthPersistInput {
  refresh: string
  email?: string
  projectId: string
}

export interface OAuthPersistOutcome {
  selectedIndex: number

  selectedId: string
  selectedRefreshParts: RefreshParts
  accountCount: number
  isNew: boolean
}

/**
 * Legacy tool behavior, explicit: request routing follows the per-family
 * cursors (AccountManager.loadFromDisk defaults each family to the stored
 * cursor), so a family-agnostic `select` from the `antigravity_accounts` tool
 * moves the global cursor AND both family cursors. Family-scoped selects
 * (MutateOptions.family) move only their own family cursor.
 */
export const LEGACY_TOOL_SELECT_UPDATES_BOTH_FAMILIES = true

function emptyStorage(): AccountStorageV4 {
  return { version: 4, accounts: [], activeIndex: 0 }
}

function clampCursor(value: number | undefined, fallback: number, length: number): number {
  if (length <= 0) return 0
  if (typeof value !== "number" || !Number.isFinite(value)) return Math.min(fallback, length - 1)
  return Math.min(Math.max(Math.trunc(value), 0), length - 1)
}

export { fingerprintRefreshToken } from "./storage.js"

/**
 * Backfill durable ids for accounts that predate them. Returns true when any
 * id was assigned; callers on write paths persist the result. Read paths
 * (listAccounts) never save: backfill reaches disk on the next service write.
 */
export function ensureAccountIds(accounts: AccountMetadataV3[]): boolean {
  let changed = false
  for (const account of accounts) {
    if (!account.id) {
      account.id = randomUUID()
      changed = true
    }
  }
  return changed
}

function summarize(storage: AccountStorageV4, account: AccountMetadataV3, index: number): AccountSummary {
  const summary: AccountSummary = {
    id: account.id ?? fingerprintRefreshToken(account.refreshToken),
    index,
    email: account.email ?? `Account ${index + 1}`,
    enabled: account.enabled !== false,
    active: index === storage.activeIndex,
    verificationRequired: account.verificationRequired === true,
    verificationStatus:
      account.verificationRequired === true
        ? "verification_required"
        : (account.lastVerificationStatus ?? "not_checked"),
  }
  if (typeof account.lastVerificationAt === "number" && Number.isFinite(account.lastVerificationAt)) {
    summary.lastVerificationAt = account.lastVerificationAt
  }
  if (typeof account.coolingDownUntil === "number" && Number.isFinite(account.coolingDownUntil)) {
    summary.cooldownUntil = account.coolingDownUntil
  }
  if (account.rateLimitResetTimes && typeof account.rateLimitResetTimes === "object") {
    const validResetTimes: Record<string, number> = {}
    let hasValid = false
    for (const [key, value] of Object.entries(account.rateLimitResetTimes)) {
      if (typeof value === "number" && Number.isFinite(value)) {
        validResetTimes[key] = value
        hasValid = true
      }
    }
    if (hasValid) {
      summary.quotaResetTimes = validResetTimes
    }
  }
  return summary
}

function familyCursors(storage: AccountStorageV4, length: number): { claude: number; gemini: number } {
  const fallback = length > 0 ? clampCursor(storage.activeIndex, 0, length) : 0
  return {
    claude: clampCursor(storage.activeIndexByFamily?.claude, fallback, length),
    gemini: clampCursor(storage.activeIndexByFamily?.gemini, fallback, length),
  }
}

export function toAccountList(storage: AccountStorageV4): AccountList {
  return {
    activeIndex: storage.activeIndex,
    activeIndexByFamily: familyCursors(storage, storage.accounts.length),
    accounts: storage.accounts.map((account, index) => summarize(storage, account, index)),
  }
}

/**
 * Resolve a mutation target against freshly loaded accounts. Fails closed:
 * unknown ids, out-of-range indices, and duplicate ids resolve to an error
 * and must not write. Ids match durable account ids only; token-derived
 * values never resolve.
 */
export function resolveAccountTarget(accounts: AccountMetadataV3[], target: AccountTarget): TargetResolution {
  if ("index" in target) {
    if (!Number.isInteger(target.index) || target.index < 0 || target.index >= accounts.length) {
      return { ok: false, kind: "invalid-index", accountCount: accounts.length }
    }
    if (!accounts[target.index]) {
      return { ok: false, kind: "not-found", accountCount: accounts.length }
    }
    return { ok: true, index: target.index }
  }
  const matches: number[] = []
  accounts.forEach((account, index) => {
    if (account.id !== undefined && account.id === target.id) {
      matches.push(index)
    }
  })
  if (matches.length === 0) return { ok: false, kind: "not-found", accountCount: accounts.length }
  if (matches.length > 1 || matches[0] === undefined) {
    return { ok: false, kind: "ambiguous", accountCount: accounts.length }
  }
  return { ok: true, index: matches[0] }
}

export async function listAccounts(): Promise<AccountList> {
  const storage = (await loadAccounts()) ?? emptyStorage()
  return toAccountList(storage)
}

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
export async function checkQuota(
  client: PluginClient,
  providerId: string = ANTIGRAVITY_PROVIDER_ID,
): Promise<QuotaCheckOutcome> {
  const stored = (await loadAccounts()) ?? emptyStorage()
  const accounts = [...stored.accounts]
  const results = await checkAccountsQuota(accounts, client, providerId)

  let persistedUpdates = 0
  const pending = results.filter((result) => result.updatedAccount !== undefined)
  if (pending.length > 0) {
    // Apply rotated token/project metadata inside one lock acquisition so a
    // concurrent mutation cannot interleave between the read and the write.
    // Matching is by previous refresh token against freshly locked storage;
    // unmatched or ambiguous entries are skipped without failing the check.
    persistedUpdates = await updateAccounts((current) => {
      const freshAccounts = [...current.accounts]
      ensureAccountIds(freshAccounts)
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

async function persistQuotaSnapshots(
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
    return (await loadAccounts()) ?? emptyStorage()
  }
  return updateAccounts((current) => {
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

function parseQuotaResetTime(value: unknown): number | null {
  if (typeof value !== "string" || value.trim() === "") return null
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : null
}

function boundedTimeout(value: number | undefined): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.min(Math.max(Math.trunc(value), 1_000), 30_000)
    : DEFAULT_QUOTA_TIMEOUT_MS
}

async function checkSingleAccountQuota(
  account: AccountMetadataV3,
  index: number,
  client: PluginClient,
  providerId: string,
  timeoutMs: number,
): Promise<AccountQuotaResult | undefined> {
  const controller = new AbortController()
  let timeout: ReturnType<typeof setTimeout> | undefined
  try {
    const check = checkAccountsQuota([account], client, providerId, controller.signal).then((results) => results[0])
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
  client: PluginClient,
  options: QuotaPresentationOptions = {},
  providerId: string = ANTIGRAVITY_PROVIDER_ID,
): Promise<QuotaPresentation> {
  let storage = (await loadAccounts()) ?? emptyStorage()
  const sources = storage.accounts
  const checkStartedAt = Date.now()
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
          return checkSingleAccountQuota(account, index, client, providerId, timeoutMs)
        }),
      )
    : []

  if (refresh) {
    try {
      storage = await persistQuotaSnapshots(sources, refreshed, checkStartedAt)
    } catch {
      // Cache persistence is best-effort. Reload authoritative identities and
      // metadata rather than projecting the pre-check pool after a failed write.
      // Do not log raw storage errors: they can contain credential material.
      log.warn("Failed to persist quota snapshots; reloading account state")
      storage = (await loadAccounts()) ?? emptyStorage()
    }
  }
  const familySelection = familyCursors(storage, storage.accounts.length)

  const now = Date.now()
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
    const accountId = account.id ?? fingerprintRefreshToken(account.refreshToken)

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

  return quotaPresentationSchema.parse({ activeIndexByFamily: familySelection, accounts })
}

export async function verifyAccount(
  target: AccountTarget,
  client: PluginClient,
  providerId: string = ANTIGRAVITY_PROVIDER_ID,
): Promise<VerifyOutcome | ResolutionFailure> {
  const stored = (await loadAccounts()) ?? emptyStorage()
  const accounts = [...stored.accounts]
  const resolution = resolveAccountTarget(accounts, target)
  if (!resolution.ok) return resolution
  const account = accounts[resolution.index]
  if (!account) return { ok: false, kind: "not-found", accountCount: accounts.length }
  ensureAccountIds(accounts)
  // Capture a stable identity before the network call: durable id when the
  // account has one, refresh token as a legacy fallback. The write path
  // re-resolves inside the lock, so a concurrent delete/select cannot be
  // clobbered by index and a vanished target fails closed.
  const targetId = accounts[resolution.index]?.id
  const targetRefreshToken = account.refreshToken

  const verification = await verifyAccountAccess(account, client, providerId)
  const checkedAt = Date.now()
  return updateAccounts<VerifyOutcome | ResolutionFailure>((current) => {
    const currentAccounts = [...current.accounts]
    ensureAccountIds(currentAccounts)
    let index = targetId !== undefined ? currentAccounts.findIndex((entry) => entry.id === targetId) : -1
    if (index < 0) {
      const tokenMatches: number[] = []
      currentAccounts.forEach((entry, entryIndex) => {
        if (entry.refreshToken === targetRefreshToken) tokenMatches.push(entryIndex)
      })
      index = tokenMatches.length === 1 && tokenMatches[0] !== undefined ? tokenMatches[0] : -1
    }
    const entry = index >= 0 ? currentAccounts[index] : undefined
    if (!entry || index < 0) {
      return { storage: current, result: { ok: false, kind: "not-found", accountCount: currentAccounts.length } }
    }
    if (verification.status === "ok") {
      if (entry.verificationRequired) entry.enabled = true
      delete entry.verificationRequired
      delete entry.verificationRequiredAt
      delete entry.verificationRequiredReason
      delete entry.verificationUrl
    } else if (verification.status === "blocked") {
      entry.enabled = false
      entry.verificationRequired = true
      entry.verificationRequiredAt = checkedAt
      entry.verificationRequiredReason = verification.message
      entry.verificationUrl = verification.verifyUrl
    }
    entry.lastVerificationStatus = verification.status
    entry.lastVerificationAt = checkedAt
    return {
      storage: { ...current, accounts: currentAccounts },
      result: {
        index,
        email: entry.email,
        checkedAt,
        status: verification.status,
        message: verification.message,
        verifyUrl: verification.verifyUrl,
      },
    }
  })
}

function selectedAccount(accounts: AccountMetadataV3[], index: number): SelectedAccount | null {
  const account = accounts[index]
  if (!account || !account.id) return null
  return {
    id: account.id,
    index,
    email: account.email,
    refreshParts: {
      refreshToken: account.refreshToken,
      projectId: account.projectId,
      managedProjectId: account.managedProjectId,
    },
  }
}

function remapFamilyCursorsAfterDelete(
  cursors: { claude: number; gemini: number },
  removedIndex: number,
  nextActiveIndex: number,
  length: number,
): { claude: number; gemini: number } {
  const remap = (cursor: number): number => {
    if (cursor === removedIndex) return nextActiveIndex
    if (cursor > removedIndex) return cursor - 1
    return cursor
  }
  return {
    claude: clampCursor(remap(cursors.claude), nextActiveIndex, length),
    gemini: clampCursor(remap(cursors.gemini), nextActiveIndex, length),
  }
}

export async function mutateAccount(
  target: AccountTarget,
  op: MutationOp,
  options: MutateOptions = {},
): Promise<MutationOutcome | MutationFailure> {
  if (op !== "select" && op !== "enable" && op !== "disable" && op !== "delete") {
    const stored = (await loadAccounts()) ?? emptyStorage()
    return { ok: false, kind: "unknown-op", accountCount: stored.accounts.length }
  }
  // Resolve and apply inside one lock acquisition: a concurrent delete or
  // persist between the read and the write must not shift the target or
  // resurrect removed accounts via a stale snapshot.
  return updateAccounts<MutationOutcome | MutationFailure>((current) => {
    const accounts = [...current.accounts]
    const resolution = resolveAccountTarget(accounts, target)
    if (!resolution.ok) return { storage: current, result: resolution }
    const index = resolution.index
    ensureAccountIds(accounts)
    const previous = familyCursors(current, accounts.length)
    let removedTombstone: ReturnType<typeof tombstoneForAccount> | undefined

    if (op === "delete") {
      const [removed] = accounts.splice(index, 1)
      if (removed) {
        removedTombstone = tombstoneForAccount({
          id: removed.id,
          refreshToken: removed.refreshToken,
          email: removed.email,
        })
      }
    } else if (op === "enable" || op === "disable") {
      const account = accounts[index]
      if (account) account.enabled = op === "enable"
    } else if (op !== "select") {
      return { storage: current, result: { ok: false, kind: "unknown-op", accountCount: accounts.length } }
    }

    const nextActiveIndex =
      op === "select"
        ? index
        : accounts.length === 0
          ? 0
          : index < current.activeIndex
            ? current.activeIndex - 1
            : Math.min(current.activeIndex, accounts.length - 1)

    let nextFamily: { claude: number; gemini: number }
    if (op === "select" && options.family) {
      nextFamily = {
        ...familyCursors(current, accounts.length),
        [options.family]: clampCursor(index, nextActiveIndex, accounts.length),
      }
    } else if (op === "select" && LEGACY_TOOL_SELECT_UPDATES_BOTH_FAMILIES) {
      nextFamily = { claude: nextActiveIndex, gemini: nextActiveIndex }
    } else if (op === "delete") {
      nextFamily =
        accounts.length === 0
          ? { claude: 0, gemini: 0 }
          : remapFamilyCursorsAfterDelete(previous, index, nextActiveIndex, accounts.length)
    } else {
      nextFamily = familyCursors({ ...current, accounts, activeIndex: nextActiveIndex }, accounts.length)
    }

    const storage: AccountStorageV4 = {
      version: 4,
      accounts,
      activeIndex: nextActiveIndex,
      activeIndexByFamily: nextFamily,
      // Non-delete ops preserve tombstones; delete appends the removed
      // identity in the same transaction.
      removedAccounts: removedTombstone
        ? addTombstones(current.removedAccounts, [removedTombstone])
        : current.removedAccounts,
    }
    return {
      storage,
      result: {
        op,
        index,
        nextActiveIndex,
        activeIndexByFamily: nextFamily,
        remaining: accounts.length,
        selected: selectedAccount(accounts, nextActiveIndex),
      },
    }
  })
}

export async function deleteAllAccounts(): Promise<{ remaining: 0 }> {
  await updateAccounts((current) => ({
    storage: {
      version: 4,
      accounts: [],
      activeIndex: 0,
      activeIndexByFamily: { claude: 0, gemini: 0 },
      removedAccounts: addTombstones(
        current.removedAccounts,
        current.accounts.map((account) =>
          tombstoneForAccount({
            id: account.id,
            refreshToken: account.refreshToken,
            email: account.email,
          }),
        ),
      ),
    },
    result: { remaining: 0 as const },
  }))
  return { remaining: 0 }
}

/**
 * Add or reconnect an OAuth account. Dedupe matches by refresh token first,
 * then case-insensitive email; the cap is enforced here at persistence time.
 * Throws when the store already holds MAX_SAVED_ACCOUNTS distinct accounts.
 */
export async function persistOAuthAccount(
  input: OAuthPersistInput,
  action: "add" | "replace",
): Promise<OAuthPersistOutcome> {
  // Dedupe and the 10-account cap are enforced inside the transaction, so two
  // concurrent logins cannot both pass the check and exceed the cap.
  return updateAccounts<OAuthPersistOutcome>((current) => {
    const now = Date.now()
    const account: AccountMetadataV3 = {
      id: randomUUID(),
      email: input.email,
      refreshToken: input.refresh,
      projectId: input.projectId,
      addedAt: now,
      lastUsed: now,
      enabled: true,
      lastVerificationAt: undefined,
      lastVerificationStatus: undefined,
      verificationRequired: undefined,
      verificationRequiredAt: undefined,
      verificationRequiredReason: undefined,
      verificationUrl: undefined,
    }

    const accounts = action === "replace" ? [] : [...current.accounts]
    ensureAccountIds(accounts)
    const matchIndex = accounts.findIndex(
      (existing) =>
        existing.refreshToken === account.refreshToken ||
        (!!account.email && existing.email?.toLowerCase() === account.email.toLowerCase()),
    )
    let isNew = false
    if (matchIndex >= 0) {
      const existing = accounts[matchIndex]
      // Preserve the durable id and original add time across reconnects.
      if (existing)
        accounts[matchIndex] = { ...existing, ...account, id: existing.id ?? account.id, addedAt: existing.addedAt }
    } else {
      if (accounts.length >= MAX_SAVED_ACCOUNTS) throw new Error("Maximum of 10 Antigravity accounts reached")
      accounts.push(account)
      isNew = true
    }

    const activeIndex = accounts.findIndex((entry) => entry.refreshToken === account.refreshToken)
    const selectedIndex = activeIndex >= 0 ? activeIndex : 0
    const selected = accounts[selectedIndex]
    // Fresh OAuth for a previously deleted identity clears its tombstone
    // through the same dedupe keys (email, then token).
    const removedAccounts = clearTombstonesForAccount(current.removedAccounts, {
      refreshToken: account.refreshToken,
      email: account.email,
    })
    return {
      storage: {
        version: 4,
        accounts,
        activeIndex: selectedIndex,
        activeIndexByFamily: { claude: selectedIndex, gemini: selectedIndex },
        removedAccounts,
      },
      result: {
        selectedIndex,
        selectedId: selected?.id ?? account.id ?? "",
        selectedRefreshParts: { refreshToken: account.refreshToken, projectId: account.projectId },
        accountCount: accounts.length,
        isNew,
      },
    }
  })
}

/**
 * Persist a rotated refresh token reported by the unified refresh path.
 * Matches by previous token against freshly loaded storage; skips the write
 * (fail closed) when nothing matches. The durable account id is preserved:
 * only token/project fields are overwritten.
 */
export async function persistRefreshRotation(
  previousRefreshToken: string,
  rotatedRefreshToken: string,
): Promise<boolean> {
  if (!rotatedRefreshToken || rotatedRefreshToken === previousRefreshToken) return false
  // Fast path: avoid the lock when nothing matches. The transaction below
  // re-checks, so a concurrent change cannot corrupt the store.
  const snapshot = await loadAccounts()
  if (!snapshot?.accounts.some((account) => account.refreshToken === previousRefreshToken)) return false
  return updateAccounts<boolean>((current) => {
    if (!current.accounts.some((account) => account.refreshToken === previousRefreshToken)) {
      return { storage: current, result: false }
    }
    ensureAccountIds(current.accounts)
    const accounts = current.accounts.map((account) =>
      account.refreshToken === previousRefreshToken ? { ...account, refreshToken: rotatedRefreshToken } : account,
    )
    return { storage: { ...current, accounts }, result: true }
  })
}
