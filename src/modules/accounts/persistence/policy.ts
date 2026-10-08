/** Stored account shapes and persistence policy shared by accounts and its filesystem adapter. */
export interface PersistedFingerprint {
  deviceId: string
  sessionToken: string
  userAgent: string
  apiClient: string
  clientMetadata: { ideType: string; platform: string; pluginType: string }
  createdAt: number
  quotaUser?: string
}

/** Persisted fingerprint snapshot with its account-lifecycle metadata. */
export interface PersistedFingerprintVersion {
  fingerprint: PersistedFingerprint
  timestamp: number
  reason: "initial" | "regenerated" | "restored"
}

/** Hashes refresh tokens without exposing hashing infrastructure to account policy. */
export type AccountTokenFingerprint = (refreshToken: string) => string

/** Any persisted schema version accepted while loading a store. */
export type AnyAccountStorage = AccountStorageV1 | AccountStorage | AccountStorageV3 | AccountStorageV4

/** Family cooldown timestamps stored by version 2. */
export interface RateLimitState {
  claude?: number
  gemini?: number
}

/** Family cooldown timestamps stored by versions 3 and 4. */
export interface RateLimitStateV3 {
  claude?: number
  "gemini-antigravity"?: number
  /** Legacy Gemini CLI cooldown retained when reading existing stores. */
  "gemini-cli"?: number
  [key: string]: number | undefined
}

/** Account record from the original v1 store schema. */
export interface AccountMetadataV1 {
  email?: string
  refreshToken: string
  projectId?: string
  managedProjectId?: string
  addedAt: number
  lastUsed: number
  isRateLimited?: boolean
  rateLimitResetTime?: number
  lastSwitchReason?: "rate-limit" | "initial" | "rotation"
}

/** Top-level account store from the original v1 schema. */
export interface AccountStorageV1 {
  version: 1
  accounts: AccountMetadataV1[]
  activeIndex: number
}

/** Account record from the v2 store schema. */
export interface AccountMetadata {
  email?: string
  refreshToken: string
  projectId?: string
  managedProjectId?: string
  addedAt: number
  lastUsed: number
  lastSwitchReason?: "rate-limit" | "initial" | "rotation"
  rateLimitResetTimes?: RateLimitState
}

/** Top-level account store from the v2 schema. */
export interface AccountStorage {
  version: 2
  accounts: AccountMetadata[]
  activeIndex: number
}

/** Explicit quota windows returned by Antigravity's grouped summary endpoint. */
export type QuotaSummaryWindow = "weekly" | "5h"

/** One persisted Antigravity summary bucket; absent values remain unknown. */
export interface QuotaSummaryBucket {
  remainingFraction?: number
  resetTime?: string
}

/** A vendor-labeled quota group with independent weekly and five-hour buckets. */
export interface QuotaSummaryGroup {
  displayName: string
  description?: string
  buckets: Partial<Record<QuotaSummaryWindow, QuotaSummaryBucket>>
}

/** Account record persisted by versions 3 and 4. */
export interface AccountMetadataV3 {
  /**
   * Durable opaque account id (e.g. a UUID) assigned by the account service.
   * Additive and optional for backward compatibility: legacy stores predate
   * it and are backfilled on service write paths. Never derived from token
   * material so it survives refresh-token rotation.
   */
  id?: string
  email?: string
  refreshToken: string
  projectId?: string
  managedProjectId?: string
  addedAt: number
  lastUsed: number
  enabled?: boolean
  lastSwitchReason?: "rate-limit" | "initial" | "rotation"
  rateLimitResetTimes?: RateLimitStateV3
  coolingDownUntil?: number
  cooldownReason?: "auth-failure" | "network-error" | "project-error" | "validation-required"

  fingerprint?: PersistedFingerprint
  fingerprintHistory?: PersistedFingerprintVersion[]

  verificationRequired?: boolean
  verificationRequiredAt?: number
  verificationRequiredReason?: string
  verificationUrl?: string
  lastVerificationAt?: number
  lastVerificationStatus?: "ok" | "blocked" | "error"

  cachedQuota?: Record<string, { remainingFraction?: number; resetTime?: string; modelCount: number }>
  cachedQuotaUpdatedAt?: number
  cachedQuotaSummary?: QuotaSummaryGroup[]
  cachedQuotaSummaryUpdatedAt?: number
}

/** Top-level account store from the v3 schema. */
export interface AccountStorageV3 {
  version: 3
  accounts: AccountMetadataV3[]
  activeIndex: number
  activeIndexByFamily?: {
    claude?: number
    gemini?: number
  }
}

/** Current top-level account store, including deletion history. */
export interface AccountStorageV4 {
  version: 4
  accounts: AccountMetadataV3[]
  activeIndex: number
  activeIndexByFamily?: {
    claude?: number
    gemini?: number
  }
  /**
   * Tombstones for removed accounts. A removed account stays removed:
   * every load/persist path filters entries matching a tombstone, so a
   * stale in-memory manager or a merging background save cannot resurrect
   * a deleted account. Capped (see MAX_TOMBSTONES) to bound growth.
   */
  removedAccounts?: RemovedAccountTombstone[]
}

/**
 * Credential-free deletion record. Identity is a durable account id when
 * the account has one, plus a sha256 fingerprint of the refresh token and
 * a normalized email so pre-id accounts stay deleted too. Never carries
 * token material.
 */
export interface RemovedAccountTombstone {
  id?: string
  tokenFingerprint?: string
  email?: string
  removedAt: number
}

/** Maximum tombstones retained; oldest pruned first.
 * Bounded retention is intentional: protection covers the 50 most recent
 * deletions, realistic given the 10-account cap (it takes 50+ distinct
 * delete events before the oldest tombstone drops and that identity could
 * resurrect via a stale snapshot). Unbounded growth is rejected to keep the
 * accounts file small; no cheap strengthening exists because every dropped
 * tombstone can still reappear in a stale snapshot, so pruning only
 * "unreappearable" identities is not possible. */
export const MAX_TOMBSTONES = 50

/** Normalizes an external JSON value into the current stored account shape. */
export class AccountStorageFormatError extends Error {
  /** Creates a domain-level format failure for untrusted persisted data. */
  constructor(message: string) {
    super(message)
    this.name = "AccountStorageFormatError"
  }
}

/** Parses a store for a public load, retaining whether it needs migration persistence. */
export function parseAccountStorageForLoad(
  value: unknown,
  fingerprint: AccountTokenFingerprint,
  now = Date.now(),
): { storage: AccountStorageV4; migrated: boolean } {
  if (!isRecord(value) || !Array.isArray(value.accounts)) {
    throw new AccountStorageFormatError("Invalid account storage format: accounts is not an array")
  }

  const source = value as unknown as AnyAccountStorage
  const tombstones = sanitizeTombstones(value.removedAccounts)
  let storage: AccountStorageV4
  let migrated = false

  switch (source.version) {
    case 1:
      storage = migrateV3ToV4(migrateV2ToV3(migrateV1ToV2(source, now), now))
      migrated = true
      break
    case 2:
      storage = migrateV3ToV4(migrateV2ToV3(source, now))
      migrated = true
      break
    case 3:
      storage = migrateV3ToV4(source)
      migrated = true
      break
    case 4:
      storage = source
      break
    default:
      throw new AccountStorageFormatError(`Unsupported account storage version: ${String(value.version)}`)
  }

  const validAccounts = storage.accounts.filter(
    (account): account is AccountMetadataV3 =>
      !!account && typeof account === "object" && typeof account.refreshToken === "string",
  )
  const liveAccounts = filterTombstonedAccounts(validAccounts, tombstones, fingerprint)
  const accounts = deduplicateAccountsByEmail(liveAccounts)
  const activeIndex = clampActiveIndex(storage.activeIndex, accounts.length)

  return {
    storage: {
      version: 4,
      accounts,
      activeIndex,
      activeIndexByFamily: storage.activeIndexByFamily,
      removedAccounts: tombstones,
    },
    migrated,
  }
}

/** Parses a store under a write lock; unknown shapes must fail closed, not reset. */
export function parseAccountStorageForTransaction(
  value: unknown,
  fingerprint: AccountTokenFingerprint,
  now = Date.now(),
): AccountStorageV4 {
  if (!isRecord(value) || !Array.isArray(value.accounts)) {
    throw new AccountStorageFormatError("Invalid account storage format: accounts is not an array")
  }

  const source = value as unknown as AnyAccountStorage
  const tombstones = sanitizeTombstones(value.removedAccounts)
  let storage: AccountStorageV4
  switch (source.version) {
    case 1:
      storage = migrateV3ToV4(migrateV2ToV3(migrateV1ToV2(source, now), now))
      break
    case 2:
      storage = migrateV3ToV4(migrateV2ToV3(source, now))
      break
    case 3:
      storage = migrateV3ToV4(source)
      break
    case 4:
      storage = source
      break
    default:
      throw new AccountStorageFormatError(`Unsupported account storage version: ${String(value.version)}`)
  }

  return {
    ...storage,
    accounts:
      source.version === 4
        ? deduplicateAccountsByEmail(filterTombstonedAccounts(storage.accounts, tombstones, fingerprint))
        : filterTombstonedAccounts(storage.accounts, tombstones, fingerprint),
    removedAccounts: tombstones,
  }
}

/** Keeps the active account index within the post-deduplication pool. */
function clampActiveIndex(value: unknown, accountCount: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || accountCount === 0) return 0
  return Math.min(Math.max(value, 0), accountCount - 1)
}

/** Narrows untrusted parsed JSON to a dictionary before reading store fields. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

/** Normalizes email identity comparisons without changing the stored account. */
function normalizeTombstoneEmail(email?: string): string | undefined {
  const normalized = email?.trim().toLowerCase()
  return normalized ? normalized : undefined
}

/** Creates a credential-free deletion record for one account generation. */
export function tombstoneForAccount(
  account: { id?: string; refreshToken: string; email?: string },
  fingerprint: AccountTokenFingerprint,
  removedAt: number = Date.now(),
): RemovedAccountTombstone {
  const tombstone: RemovedAccountTombstone = { removedAt }
  if (account.id) {
    tombstone.id = account.id
  }
  if (account.refreshToken) {
    tombstone.tokenFingerprint = fingerprint(account.refreshToken)
  }
  const email = normalizeTombstoneEmail(account.email)
  if (email) {
    tombstone.email = email
  }
  return tombstone
}

/**
 * True when the tombstone identifies this account for deletion filtering.
 *
 * Generation matching: equal durable ids plus one corroborating field (token
 * fingerprint or normalized email) always match, and equal token fingerprints
 * always match — a fingerprint identifies the credential itself, so it holds
 * across the pre-id upgrade path where a delete backfills an id the stale
 * snapshot lacks. Email alone only matches as a legacy fallback when both
 * sides lack an id and token material. In particular a re-added generation
 * (fresh id and fresh token under the same email) never matches the stale
 * deletion, so a stale save cannot poison it.
 */
export function tombstoneMatchesAccount(
  tombstone: RemovedAccountTombstone,
  account: { id?: string; refreshToken?: string; email?: string },
  fingerprint: AccountTokenFingerprint,
): boolean {
  const idMatch = !!tombstone.id && !!account.id && tombstone.id === account.id
  let fingerprintMatch = false
  if (tombstone.tokenFingerprint && account.refreshToken) {
    fingerprintMatch = tombstone.tokenFingerprint === fingerprint(account.refreshToken)
  }
  if (idMatch) {
    const tombstoneEmail = normalizeTombstoneEmail(tombstone.email)
    const accountEmail = normalizeTombstoneEmail(account.email)
    const emailMatch = !!tombstoneEmail && !!accountEmail && tombstoneEmail === accountEmail
    return fingerprintMatch || emailMatch
  }
  if (fingerprintMatch) {
    return true
  }
  if (!tombstone.id && !account.id && !tombstone.tokenFingerprint && !account.refreshToken) {
    const tombstoneEmail = normalizeTombstoneEmail(tombstone.email)
    const accountEmail = normalizeTombstoneEmail(account.email)
    return !!tombstoneEmail && !!accountEmail && tombstoneEmail === accountEmail
  }
  return false
}

/**
 * Loose any-field match for explicit re-add clearing (user intent).
 * A fresh OAuth login for a previously deleted identity clears its tombstone
 * through id, token, or email — unlike deletion filtering, which requires
 * strict generation corroboration.
 */
export function tombstoneMatchesReAdd(
  tombstone: RemovedAccountTombstone,
  identity: { id?: string; refreshToken?: string; email?: string },
  fingerprint: AccountTokenFingerprint,
): boolean {
  if (tombstone.id && identity.id && tombstone.id === identity.id) {
    return true
  }
  if (
    tombstone.tokenFingerprint &&
    identity.refreshToken &&
    tombstone.tokenFingerprint === fingerprint(identity.refreshToken)
  ) {
    return true
  }
  const email = normalizeTombstoneEmail(identity.email)
  if (tombstone.email && email && tombstone.email === email) {
    return true
  }
  return false
}

/** Reports whether strict generation matching finds a deletion record. */
export function isTombstoned(
  account: { id?: string; refreshToken?: string; email?: string },
  tombstones: RemovedAccountTombstone[] | undefined,
  fingerprint: AccountTokenFingerprint,
): boolean {
  if (!tombstones || tombstones.length === 0) {
    return false
  }
  return tombstones.some((tombstone) => tombstoneMatchesAccount(tombstone, account, fingerprint))
}

/** Removes accounts identified by the supplied deletion records. */
export function filterTombstonedAccounts<T extends { id?: string; refreshToken?: string; email?: string }>(
  accounts: T[],
  tombstones: RemovedAccountTombstone[] | undefined,
  fingerprint: AccountTokenFingerprint,
): T[] {
  if (!tombstones || tombstones.length === 0) {
    return accounts
  }
  return accounts.filter((account) => !isTombstoned(account, tombstones, fingerprint))
}

/** Accepts only credential-free deletion records with a usable identity and timestamp. */
function isValidTombstone(value: unknown): value is RemovedAccountTombstone {
  if (!value || typeof value !== "object") {
    return false
  }
  const entry = value as Record<string, unknown>
  const hasIdentity =
    typeof entry.id === "string" || typeof entry.tokenFingerprint === "string" || typeof entry.email === "string"
  return hasIdentity && typeof entry.removedAt === "number" && Number.isFinite(entry.removedAt)
}

/** Drops malformed tombstone entries while keeping the optional empty representation. */
export function sanitizeTombstones(value: unknown): RemovedAccountTombstone[] | undefined {
  if (value === undefined) {
    return undefined
  }
  if (!Array.isArray(value)) {
    return undefined
  }
  const valid = value.filter(isValidTombstone)
  return valid.length > 0 ? valid : undefined
}

/**
 * Merges tombstone lists, deduplicating by id/token fingerprint and
 * pruning the oldest entries beyond MAX_TOMBSTONES. A duplicate refreshes
 * removedAt to the latest deletion time so delete/re-add/delete cycles
 * keep full protection instead of inheriting a stale timestamp.
 */
export function addTombstones(
  existing: RemovedAccountTombstone[] | undefined,
  entries: RemovedAccountTombstone[],
): RemovedAccountTombstone[] | undefined {
  const merged = (existing ?? []).map((tombstone) => ({ ...tombstone }))
  for (const entry of entries) {
    const duplicateIndex = merged.findIndex(
      (tombstone) =>
        (entry.id !== undefined && tombstone.id === entry.id) ||
        (entry.tokenFingerprint !== undefined && tombstone.tokenFingerprint === entry.tokenFingerprint),
    )
    if (duplicateIndex >= 0) {
      const current = merged[duplicateIndex]
      if (current !== undefined) {
        merged[duplicateIndex] = { ...current, removedAt: Math.max(current.removedAt, entry.removedAt) }
      }
    } else {
      merged.push({ ...entry })
    }
  }
  merged.sort((a, b) => a.removedAt - b.removedAt)
  const pruned = merged.length > MAX_TOMBSTONES ? merged.slice(merged.length - MAX_TOMBSTONES) : merged
  return pruned.length > 0 ? pruned : undefined
}

/**
 * Clears tombstones identifying a re-added account (fresh OAuth for the
 * same email or token), so the account can return after deletion.
 * Intentionally loose (any-field match): an explicit re-add is user intent,
 * unlike deletion filtering which requires strict generation corroboration.
 */
export function clearTombstonesForAccount(
  tombstones: RemovedAccountTombstone[] | undefined,
  identity: { id?: string; refreshToken?: string; email?: string },
  fingerprint: AccountTokenFingerprint,
): RemovedAccountTombstone[] | undefined {
  if (!tombstones || tombstones.length === 0) {
    return tombstones
  }
  const hasIdentity =
    identity.id !== undefined ||
    identity.refreshToken !== undefined ||
    normalizeTombstoneEmail(identity.email) !== undefined
  if (!hasIdentity) {
    return tombstones
  }
  const kept = tombstones.filter((tombstone) => !tombstoneMatchesReAdd(tombstone, identity, fingerprint))
  return kept.length === tombstones.length ? tombstones : kept.length > 0 ? kept : undefined
}

/**
 * Drops stale pending tombstones that no longer identify anything on disk.
 * A pending deletion only applies when a disk account still matches it under
 * strict generation rules (durable id with token/email corroboration, or an
 * identical token fingerprint); a re-added account with a fresh id and fresh
 * token is a new generation and is spared, even when the email is unchanged.
 * Call inside the updateAccounts lock with the freshly loaded disk membership.
 */
export function reconcilePendingTombstones(
  pending: RemovedAccountTombstone[],
  diskAccounts: { id?: string; refreshToken?: string; email?: string }[],
  fingerprint: AccountTokenFingerprint,
): RemovedAccountTombstone[] {
  return pending.filter((tombstone) =>
    diskAccounts.some((account) => tombstoneMatchesAccount(tombstone, account, fingerprint)),
  )
}

/** Merges saved snapshots while preserving account settings and deletion tombstones. */
export function mergeAccountStorage(
  existing: AccountStorageV4,
  incoming: AccountStorageV4,
  fingerprint: AccountTokenFingerprint,
): AccountStorageV4 {
  const accountMap = new Map<string, AccountMetadataV3>()

  for (const acc of existing.accounts) {
    if (acc.refreshToken) {
      accountMap.set(acc.refreshToken, acc)
    }
  }

  for (const acc of incoming.accounts) {
    if (acc.refreshToken) {
      const existingAcc = accountMap.get(acc.refreshToken)
      if (existingAcc) {
        accountMap.set(acc.refreshToken, {
          ...existingAcc,
          ...acc,
          // Preserve manually configured projectId/managedProjectId if not in incoming
          projectId: acc.projectId ?? existingAcc.projectId,
          managedProjectId: acc.managedProjectId ?? existingAcc.managedProjectId,
          rateLimitResetTimes: {
            ...existingAcc.rateLimitResetTimes,
            ...acc.rateLimitResetTimes,
          },
          lastUsed: Math.max(existingAcc.lastUsed || 0, acc.lastUsed || 0),
        })
      } else {
        accountMap.set(acc.refreshToken, acc)
      }
    }
  }

  // Merging must never resurrect a tombstoned (deleted) account.
  const tombstones = addTombstones(existing.removedAccounts, incoming.removedAccounts ?? [])

  return {
    version: 4,
    accounts: filterTombstonedAccounts(Array.from(accountMap.values()), tombstones, fingerprint),
    activeIndex: incoming.activeIndex,
    activeIndexByFamily: incoming.activeIndexByFamily,
    removedAccounts: tombstones,
  }
}

/** Keeps the most recently used account per exact email while preserving survivor order. */
export function deduplicateAccountsByEmail<T extends { email?: string; lastUsed?: number; addedAt?: number }>(
  accounts: T[],
): T[] {
  const emailToNewestIndex = new Map<string, number>()
  const indicesToKeep = new Set<number>()

  // First pass: find the newest account for each email (by lastUsed, then addedAt)
  for (let i = 0; i < accounts.length; i++) {
    const acc = accounts[i]
    if (!acc) continue

    if (!acc.email) {
      // No email - keep this account (can't deduplicate without email)
      indicesToKeep.add(i)
      continue
    }

    const existingIndex = emailToNewestIndex.get(acc.email)
    if (existingIndex === undefined) {
      emailToNewestIndex.set(acc.email, i)
      continue
    }

    // Compare to find which is newer
    const existing = accounts[existingIndex]
    if (!existing) {
      emailToNewestIndex.set(acc.email, i)
      continue
    }

    // Prefer higher lastUsed, then higher addedAt
    // Compare fields separately to avoid integer overflow with large timestamps
    const currLastUsed = acc.lastUsed || 0
    const existLastUsed = existing.lastUsed || 0
    const currAddedAt = acc.addedAt || 0
    const existAddedAt = existing.addedAt || 0

    const isNewer = currLastUsed > existLastUsed || (currLastUsed === existLastUsed && currAddedAt > existAddedAt)

    if (isNewer) {
      emailToNewestIndex.set(acc.email, i)
    }
  }

  // Add all the newest email-based indices to the keep set
  for (const idx of emailToNewestIndex.values()) {
    indicesToKeep.add(idx)
  }

  // Build the deduplicated list, preserving original order for kept items
  const result: T[] = []
  for (let i = 0; i < accounts.length; i++) {
    if (indicesToKeep.has(i)) {
      const acc = accounts[i]
      if (acc) {
        result.push(acc)
      }
    }
  }

  return result
}

/** Converts the original account-store shape to v2 while retaining active cooldowns. */
export function migrateV1ToV2(v1: AccountStorageV1, now = Date.now()): AccountStorage {
  return {
    version: 2,
    accounts: v1.accounts.map((acc) => {
      const rateLimitResetTimes: RateLimitState = {}
      if (acc.isRateLimited && acc.rateLimitResetTime && acc.rateLimitResetTime > now) {
        rateLimitResetTimes.claude = acc.rateLimitResetTime
        rateLimitResetTimes.gemini = acc.rateLimitResetTime
      }
      return {
        email: acc.email,
        refreshToken: acc.refreshToken,
        projectId: acc.projectId,
        managedProjectId: acc.managedProjectId,
        addedAt: acc.addedAt,
        lastUsed: acc.lastUsed,
        lastSwitchReason: acc.lastSwitchReason,
        rateLimitResetTimes: Object.keys(rateLimitResetTimes).length > 0 ? rateLimitResetTimes : undefined,
      }
    }),
    activeIndex: v1.activeIndex,
  }
}

/** Converts v2 family rate limits to their current persisted model-family keys. */
export function migrateV2ToV3(v2: AccountStorage, now = Date.now()): AccountStorageV3 {
  return {
    version: 3,
    accounts: v2.accounts.map((acc) => {
      const rateLimitResetTimes: RateLimitStateV3 = {}
      if (acc.rateLimitResetTimes?.claude && acc.rateLimitResetTimes.claude > now) {
        rateLimitResetTimes.claude = acc.rateLimitResetTimes.claude
      }
      if (acc.rateLimitResetTimes?.gemini && acc.rateLimitResetTimes.gemini > now) {
        rateLimitResetTimes["gemini-antigravity"] = acc.rateLimitResetTimes.gemini
      }
      return {
        email: acc.email,
        refreshToken: acc.refreshToken,
        projectId: acc.projectId,
        managedProjectId: acc.managedProjectId,
        addedAt: acc.addedAt,
        lastUsed: acc.lastUsed,
        lastSwitchReason: acc.lastSwitchReason,
        rateLimitResetTimes: Object.keys(rateLimitResetTimes).length > 0 ? rateLimitResetTimes : undefined,
      }
    }),
    activeIndex: v2.activeIndex,
  }
}

/** Converts v3 account metadata to the current persisted version. */
export function migrateV3ToV4(v3: AccountStorageV3): AccountStorageV4 {
  return {
    version: 4,
    accounts: v3.accounts.map((acc) => ({
      ...acc,
      fingerprint: undefined,
      fingerprintHistory: undefined,
    })),
    activeIndex: v3.activeIndex,
    activeIndexByFamily: v3.activeIndexByFamily,
    removedAccounts: sanitizeTombstones((v3 as unknown as { removedAccounts?: unknown }).removedAccounts),
  }
}
