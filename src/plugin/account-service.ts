import { createHash, randomUUID } from "node:crypto"
import { ANTIGRAVITY_PROVIDER_ID } from "../constants.js"
import { formatRefreshParts } from "./auth.js"
import { checkAccountsQuota, type AccountQuotaResult } from "./quota.js"
import {
  loadAccounts,
  saveAccountsReplace,
  type AccountMetadataV3,
  type AccountStorageV4,
  type ModelFamily,
} from "./storage.js"
import { verifyAccountAccess } from "./verify.js"
import type { PluginClient, RefreshParts } from "./types.js"

/**
 * Shared account-management service.
 *
 * Owns every read/write of the plugin account store (`antigravity-accounts.json`)
 * plus the redacted, credential-free view models consumed by the
 * `antigravity_accounts` tool and (later) the `/antigravity` TUI RPC.
 *
 * Deliberately out of scope (Task 1 gate): host credential-store removal,
 * tombstones, and any host-store mutation. This service only touches the
 * plugin disk store and returns outcomes; `src/v2-plugin.ts` applies
 * in-memory effects (currentAuth, manager invalidation) from those outcomes.
 *
 * Known limitation (pre-existing, unchanged): `getAuth()` in
 * `src/v2-plugin.ts` resolves the active host connection first, so while a
 * host connection is active the saved selection (and `currentAuth`) is
 * bypassed for request routing. Selection mutations still persist to the
 * plugin store and take effect once the host connection no longer resolves.
 * Do not "fix" precedence here and do not touch host credentials: host
 * credential handling is gated by Task 1.
 */

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

/** Quota result with credential material removed. Never carries updatedAccount. */
export type RedactedQuotaResult = Omit<AccountQuotaResult, "updatedAccount">

export interface QuotaCheckOutcome {
  results: RedactedQuotaResult[]
  /** Number of accounts whose rotated token/project metadata was persisted. */
  persistedUpdates: number
}

export type AccountTarget = { id: string } | { index: number }

export type TargetResolution =
  | { ok: true; index: number }
  | { ok: false; kind: "invalid-index" | "not-found" | "ambiguous"; accountCount: number }

/** Failure half of a resolution. Service entry points never return ok:true. */
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
  /** Durable account id of the selected account. */
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
  /** Account the caller should point auth at; null when none remain. */
  selected: SelectedAccount | null
}

export type MutationFailure =
  | ResolutionFailure
  | { ok: false; kind: "unknown-op"; accountCount: number }

export interface OAuthPersistInput {
  refresh: string
  email?: string
  projectId: string
}

export interface OAuthPersistOutcome {
  selectedIndex: number
  /** Durable id of the selected account. */
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

/** Deterministic fallback identity for accounts predating durable ids. */
export function fingerprintRefreshToken(refreshToken: string): string {
  return createHash("sha256").update(refreshToken, "utf8").digest("hex")
}

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
  return {
    id: account.id ?? fingerprintRefreshToken(account.refreshToken),
    index,
    email: account.email ?? `Account ${index + 1}`,
    enabled: account.enabled !== false,
    active: index === storage.activeIndex,
    verificationRequired: account.verificationRequired === true,
    verificationStatus: account.verificationRequired === true
      ? "verification_required"
      : account.lastVerificationStatus ?? "not_checked",
    lastVerificationAt: account.lastVerificationAt,
    cooldownUntil: account.coolingDownUntil,
    quotaResetTimes: account.rateLimitResetTimes,
  }
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
  const storage = await loadAccounts() ?? emptyStorage()
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
  const stored = await loadAccounts() ?? emptyStorage()
  const accounts = [...stored.accounts]
  const results = await checkAccountsQuota(accounts, client, providerId)

  let persistedUpdates = 0
  const pending = results.filter((result) => result.updatedAccount !== undefined)
  if (pending.length > 0) {
    const fresh = await loadAccounts() ?? emptyStorage()
    let dirty = ensureAccountIds(fresh.accounts)
    for (const [position, account] of accounts.entries()) {
      const updated = results[position]?.updatedAccount
      if (!updated) continue
      const candidates = fresh.accounts.filter((entry) => entry.refreshToken === account.refreshToken)
      if (candidates.length !== 1 || !candidates[0]) continue
      candidates[0].refreshToken = updated.refreshToken
      candidates[0].projectId = updated.projectId
      candidates[0].managedProjectId = updated.managedProjectId
      dirty = true
      persistedUpdates += 1
    }
    if (dirty) await saveAccountsReplace(fresh)
  }

  return { results: results.map(redactQuotaResult), persistedUpdates }
}

export async function verifyAccount(
  target: AccountTarget,
  client: PluginClient,
  providerId: string = ANTIGRAVITY_PROVIDER_ID,
): Promise<VerifyOutcome | ResolutionFailure> {
  const stored = await loadAccounts() ?? emptyStorage()
  const accounts = [...stored.accounts]
  const resolution = resolveAccountTarget(accounts, target)
  if (!resolution.ok) return resolution
  const account = accounts[resolution.index]
  if (!account) return { ok: false, kind: "not-found", accountCount: accounts.length }
  ensureAccountIds(accounts)

  const verification = await verifyAccountAccess(account, client, providerId)
  if (verification.status === "ok") {
    if (account.verificationRequired) account.enabled = true
    delete account.verificationRequired
    delete account.verificationRequiredAt
    delete account.verificationRequiredReason
    delete account.verificationUrl
  } else if (verification.status === "blocked") {
    account.enabled = false
    account.verificationRequired = true
    account.verificationRequiredAt = Date.now()
    account.verificationRequiredReason = verification.message
    account.verificationUrl = verification.verifyUrl
  }
  account.lastVerificationStatus = verification.status
  account.lastVerificationAt = Date.now()
  await saveAccountsReplace({ ...stored, accounts })
  return {
    index: resolution.index,
    email: account.email,
    checkedAt: account.lastVerificationAt,
    status: verification.status,
    message: verification.message,
    verifyUrl: verification.verifyUrl,
  }
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
    const stored = await loadAccounts() ?? emptyStorage()
    return { ok: false, kind: "unknown-op", accountCount: stored.accounts.length }
  }
  const stored = await loadAccounts() ?? emptyStorage()
  const accounts = [...stored.accounts]
  const resolution = resolveAccountTarget(accounts, target)
  if (!resolution.ok) return resolution
  const index = resolution.index
  ensureAccountIds(accounts)
  const previous = familyCursors(stored, accounts.length)

  if (op === "delete") {
    accounts.splice(index, 1)
  } else if (op === "enable" || op === "disable") {
    const account = accounts[index]
    if (account) account.enabled = op === "enable"
  } else if (op !== "select") {
    return { ok: false, kind: "unknown-op", accountCount: accounts.length }
  }

  const nextActiveIndex = op === "select"
    ? index
    : accounts.length === 0
      ? 0
      : index < stored.activeIndex
        ? stored.activeIndex - 1
        : Math.min(stored.activeIndex, accounts.length - 1)

  let nextFamily: { claude: number; gemini: number }
  if (op === "select" && options.family) {
    nextFamily = {
      ...familyCursors(stored, accounts.length),
      [options.family]: clampCursor(index, nextActiveIndex, accounts.length),
    }
  } else if (op === "select" && LEGACY_TOOL_SELECT_UPDATES_BOTH_FAMILIES) {
    nextFamily = { claude: nextActiveIndex, gemini: nextActiveIndex }
  } else if (op === "delete") {
    nextFamily = accounts.length === 0
      ? { claude: 0, gemini: 0 }
      : remapFamilyCursorsAfterDelete(previous, index, nextActiveIndex, accounts.length)
  } else {
    nextFamily = familyCursors({ ...stored, accounts, activeIndex: nextActiveIndex }, accounts.length)
  }

  await saveAccountsReplace({
    version: 4,
    accounts,
    activeIndex: nextActiveIndex,
    activeIndexByFamily: nextFamily,
  })
  return {
    op,
    index,
    nextActiveIndex,
    activeIndexByFamily: nextFamily,
    remaining: accounts.length,
    selected: selectedAccount(accounts, nextActiveIndex),
  }
}

export async function deleteAllAccounts(): Promise<{ remaining: 0 }> {
  await saveAccountsReplace({ version: 4, accounts: [], activeIndex: 0, activeIndexByFamily: { claude: 0, gemini: 0 } })
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
  const stored = await loadAccounts()
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

  const accounts = action === "replace" ? [] : [...(stored?.accounts ?? [])]
  ensureAccountIds(accounts)
  const matchIndex = accounts.findIndex((existing) =>
    existing.refreshToken === account.refreshToken ||
    (!!account.email && existing.email?.toLowerCase() === account.email.toLowerCase()),
  )
  let isNew = false
  if (matchIndex >= 0) {
    const existing = accounts[matchIndex]
    // Preserve the durable id and original add time across reconnects.
    if (existing) accounts[matchIndex] = { ...existing, ...account, id: existing.id ?? account.id, addedAt: existing.addedAt }
  } else {
    if (accounts.length >= MAX_SAVED_ACCOUNTS) throw new Error("Maximum of 10 Antigravity accounts reached")
    accounts.push(account)
    isNew = true
  }

  const activeIndex = accounts.findIndex((entry) => entry.refreshToken === account.refreshToken)
  const selectedIndex = activeIndex >= 0 ? activeIndex : 0
  await saveAccountsReplace({
    version: 4,
    accounts,
    activeIndex: selectedIndex,
    activeIndexByFamily: { claude: selectedIndex, gemini: selectedIndex },
  })
  const selected = accounts[selectedIndex]
  return {
    selectedIndex,
    selectedId: selected?.id ?? account.id ?? "",
    selectedRefreshParts: { refreshToken: account.refreshToken, projectId: account.projectId },
    accountCount: accounts.length,
    isNew,
  }
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
  const stored = await loadAccounts()
  if (!stored) return false
  if (!stored.accounts.some((account) => account.refreshToken === previousRefreshToken)) return false
  ensureAccountIds(stored.accounts)
  const accounts = stored.accounts.map((account) =>
    account.refreshToken === previousRefreshToken
      ? { ...account, refreshToken: rotatedRefreshToken }
      : account)
  await saveAccountsReplace({ ...stored, accounts })
  return true
}

export function formatSelectedRefresh(parts: RefreshParts): string {
  return formatRefreshParts(parts)
}
