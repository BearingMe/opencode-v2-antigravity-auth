import type {
  AccountAdministration,
  AccountList,
  AccountSummary,
  AccountMutation,
  AccountMutationOptions,
  AccountMutationResult,
  AccountRefreshParts,
  SelectedAccountCredential,
  AccountTarget,
  AccountTargetFailure,
  AccountVerificationResult,
  ModelFamily,
} from "./index.js"
import type { AccountPersistenceService } from "./persistence/service.js"
import {
  addTombstones,
  clearTombstonesForAccount,
  tombstoneForAccount,
  type AccountMetadataV3,
  type AccountStorageV4,
} from "./persistence/policy.js"
import { createAccountQuotaPolicy } from "./quota/policy.js"
import type { QuotaCheckOutcome } from "./quota/policy.js"
import type { AccountQuotaResult } from "./quota/types.js"
import type { AccountAccessVerificationResult } from "./verification/types.js"
import { verifyAccount as verifyAccountPolicy } from "./verification/policy.js"

/** Maximum size of the persisted Antigravity account pool. */
export const MAX_SAVED_ACCOUNTS = 10

/** Resolved account target or its fail-closed failure. */
export type TargetResolution = { ok: true; index: number } | AccountTargetFailure
/** Failure returned when a target cannot be resolved. */
export type ResolutionFailure = AccountTargetFailure
/** Mutation operation supported by account administration. */
export type MutationOp = AccountMutation
/** Optional mutation policy controls. */
export type MutateOptions = AccountMutationOptions
/** Successful account mutation result. */
export type MutationOutcome = Extract<AccountMutationResult, { op: AccountMutation }>
/** Account mutation failure. */
export type MutationFailure = Exclude<AccountMutationResult, { op: AccountMutation }>

/** OAuth fields retained by account persistence after a login. */
export interface OAuthPersistInput {
  refresh: string
  email?: string
  projectId: string
}

/** Result of persisting an OAuth account for trusted plugin callers. */
export interface OAuthPersistOutcome {
  selectedIndex: number
  selectedId: string
  selectedRefreshParts: AccountRefreshParts
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

/** Dependencies required to run account administration without host clients. */
export interface AccountAdminDependencies {
  persistence: AccountPersistenceService
  fingerprintRefreshToken(refreshToken: string): string
  generateId(): string
  now(): number
  checkQuota(accounts: AccountMetadataV3[], signal?: AbortSignal): Promise<AccountQuotaResult[]>
  verifyAccount(account: AccountMetadataV3): Promise<AccountAccessVerificationResult>
  warn(message: string): void
}

/** Account-administration API plus the legacy tool's full quota result. */
export interface AccountAdminService extends AccountAdministration {
  checkQuota(): Promise<QuotaCheckOutcome>
  persistOAuthAccount(input: OAuthPersistInput, action: "add" | "replace"): Promise<OAuthPersistOutcome>
  persistRefreshRotation(previousRefreshToken: string, rotatedRefreshToken: string): Promise<boolean>
}

/** Provides the in-memory empty representation when no store exists yet. */
function emptyStorage(): AccountStorageV4 {
  return { version: 4, accounts: [], activeIndex: 0 }
}

/** Keeps a stored account cursor inside the current account pool. */
function clampCursor(value: number | undefined, fallback: number, length: number): number {
  if (length <= 0) return 0
  if (typeof value !== "number" || !Number.isFinite(value)) return Math.min(fallback, length - 1)
  return Math.min(Math.max(Math.trunc(value), 0), length - 1)
}

/**
 * Backfill durable ids for accounts that predate them. Returns true when any
 * id was assigned; callers on write paths persist the result. Read paths
 * (listAccounts) never save: backfill reaches disk on the next service write.
 */
export function ensureAccountIds(accounts: AccountMetadataV3[], generateId: () => string): boolean {
  let changed = false
  for (const account of accounts) {
    if (!account.id) {
      account.id = generateId()
      changed = true
    }
  }
  return changed
}

/** Projects one persisted account to its credential-free summary. */
function summarize(
  storage: AccountStorageV4,
  account: AccountMetadataV3,
  index: number,
  fingerprintRefreshToken: AccountAdminDependencies["fingerprintRefreshToken"],
): AccountSummary {
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

/** Resolves and clamps account cursors for both model families. */
function familyCursors(storage: AccountStorageV4, length: number): { claude: number; gemini: number } {
  const fallback = length > 0 ? clampCursor(storage.activeIndex, 0, length) : 0
  return {
    claude: clampCursor(storage.activeIndexByFamily?.claude, fallback, length),
    gemini: clampCursor(storage.activeIndexByFamily?.gemini, fallback, length),
  }
}

/** Projects persisted state into credential-free account summaries and cursors. */
export function toAccountList(
  storage: AccountStorageV4,
  fingerprintRefreshToken: AccountAdminDependencies["fingerprintRefreshToken"],
): AccountList {
  return {
    activeIndex: storage.activeIndex,
    activeIndexByFamily: familyCursors(storage, storage.accounts.length),
    accounts: storage.accounts.map((account, index) => summarize(storage, account, index, fingerprintRefreshToken)),
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

/** Returns credential-free summaries without writing legacy ID backfills. */
export async function listAccounts(dependencies: AccountAdminDependencies): Promise<AccountList> {
  const storage = (await dependencies.persistence.load()) ?? emptyStorage()
  return toAccountList(storage, dependencies.fingerprintRefreshToken)
}

/** Verifies an account and records its latest verification outcome. */
export async function verifyAccount(
  dependencies: AccountAdminDependencies,
  target: AccountTarget,
): Promise<AccountVerificationResult | ResolutionFailure> {
  return verifyAccountPolicy(dependencies, target)
}

/** Projects the selected account credential only for trusted auth replacement. */
function selectedAccount(accounts: AccountMetadataV3[], index: number): SelectedAccountCredential | null {
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

/** Reindexes both family cursors after removing one account. */
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

/** Applies one fail-closed account mutation inside a persistence transaction. */
export async function mutateAccount(
  dependencies: AccountAdminDependencies,
  target: AccountTarget,
  op: MutationOp,
  options: MutateOptions = {},
): Promise<MutationOutcome | MutationFailure> {
  if (op !== "select" && op !== "enable" && op !== "disable" && op !== "delete") {
    const stored = (await dependencies.persistence.load()) ?? emptyStorage()
    return { ok: false, kind: "unknown-op", accountCount: stored.accounts.length }
  }
  // Resolve and apply inside one lock acquisition: a concurrent delete or
  // persist between the read and the write must not shift the target or
  // resurrect removed accounts via a stale snapshot.
  return dependencies.persistence.update<MutationOutcome | MutationFailure>((current) => {
    const accounts = [...current.accounts]
    const resolution = resolveAccountTarget(accounts, target)
    if (!resolution.ok) return { storage: current, result: resolution }
    const index = resolution.index
    ensureAccountIds(accounts, dependencies.generateId)
    const previous = familyCursors(current, accounts.length)
    let removedTombstone: ReturnType<typeof tombstoneForAccount> | undefined

    if (op === "delete") {
      const [removed] = accounts.splice(index, 1)
      if (removed) {
        removedTombstone = tombstoneForAccount(
          {
            id: removed.id,
            refreshToken: removed.refreshToken,
            email: removed.email,
          },
          dependencies.fingerprintRefreshToken,
          dependencies.now(),
        )
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

/** Deletes all accounts and records their identities as tombstones transactionally. */
export async function deleteAllAccounts(dependencies: AccountAdminDependencies): Promise<{ remaining: 0 }> {
  await dependencies.persistence.update((current) => ({
    storage: {
      version: 4,
      accounts: [],
      activeIndex: 0,
      activeIndexByFamily: { claude: 0, gemini: 0 },
      removedAccounts: addTombstones(
        current.removedAccounts,
        current.accounts.map((account) =>
          tombstoneForAccount(
            {
              id: account.id,
              refreshToken: account.refreshToken,
              email: account.email,
            },
            dependencies.fingerprintRefreshToken,
            dependencies.now(),
          ),
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
  dependencies: AccountAdminDependencies,
  input: OAuthPersistInput,
  action: "add" | "replace",
): Promise<OAuthPersistOutcome> {
  // Dedupe and the 10-account cap are enforced inside the transaction, so two
  // concurrent logins cannot both pass the check and exceed the cap.
  return dependencies.persistence.update<OAuthPersistOutcome>((current) => {
    const now = dependencies.now()
    const account: AccountMetadataV3 = {
      id: dependencies.generateId(),
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
    ensureAccountIds(accounts, dependencies.generateId)
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
    const removedAccounts = clearTombstonesForAccount(
      current.removedAccounts,
      { refreshToken: account.refreshToken, email: account.email },
      dependencies.fingerprintRefreshToken,
    )
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
  dependencies: AccountAdminDependencies,
  previousRefreshToken: string,
  rotatedRefreshToken: string,
): Promise<boolean> {
  if (!rotatedRefreshToken || rotatedRefreshToken === previousRefreshToken) return false
  // Fast path: avoid the lock when nothing matches. The transaction below
  // re-checks, so a concurrent change cannot corrupt the store.
  const snapshot = await dependencies.persistence.load()
  if (!snapshot?.accounts.some((account) => account.refreshToken === previousRefreshToken)) return false
  return dependencies.persistence.update<boolean>((current) => {
    if (!current.accounts.some((account) => account.refreshToken === previousRefreshToken)) {
      return { storage: current, result: false }
    }
    ensureAccountIds(current.accounts, dependencies.generateId)
    const accounts = current.accounts.map((account) =>
      account.refreshToken === previousRefreshToken ? { ...account, refreshToken: rotatedRefreshToken } : account,
    )
    return { storage: { ...current, accounts }, result: true }
  })
}

/** Binds account policies to persistence, clock, identity, quota, and verification ports. */
export function createAccountAdmin(dependencies: AccountAdminDependencies): AccountAdminService {
  const quotaPolicy = createAccountQuotaPolicy(dependencies)
  return {
    list: () => listAccounts(dependencies),
    checkQuota: quotaPolicy.check,
    quota: quotaPolicy.present,
    verify: (target) => verifyAccount(dependencies, target),
    mutate: (target, operation, options) => mutateAccount(dependencies, target, operation, options),
    deleteAll: () => deleteAllAccounts(dependencies),
    persistOAuth: async (input, action) => {
      await persistOAuthAccount(dependencies, input, action)
    },
    persistOAuthAccount: (input, action) => persistOAuthAccount(dependencies, input, action),
    persistRefreshRotation: (previous, rotated) => persistRefreshRotation(dependencies, previous, rotated),
  }
}
