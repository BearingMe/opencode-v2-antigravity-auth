import {
  clearTombstonesForAccount as clearPolicyTombstones,
  filterTombstonedAccounts as filterPolicyTombstones,
  isTombstoned as isPolicyTombstoned,
  reconcilePendingTombstones as reconcilePolicyTombstones,
  tombstoneForAccount as createPolicyTombstone,
  tombstoneMatchesAccount as matchPolicyTombstone,
  tombstoneMatchesReAdd as matchPolicyReAdd,
  type RemovedAccountTombstone,
} from "../modules/accounts/index.js"
import { fingerprintRefreshToken } from "../adapters/filesystem/account-store.js"

export {
  clearAccounts,
  ensureGitignore,
  ensureGitignoreSync,
  getConfigDir,
  getStoragePath,
  loadAccounts,
  saveAccounts,
  saveAccountsReplace,
  updateAccounts,
} from "../adapters/filesystem/account-store.js"
export { AccountStoreUnreadableError, GITIGNORE_ENTRIES } from "../adapters/filesystem/account-store.js"
export type {
  AccountMetadata,
  AccountMetadataV1,
  AccountMetadataV3,
  AccountStorage,
  AccountStorageV1,
  AccountStorageV3,
  AccountStorageV4,
  CooldownReason,
  ModelFamily,
  QuotaSummaryBucket,
  QuotaSummaryGroup,
  QuotaSummaryWindow,
  RateLimitState,
  RateLimitStateV3,
  RemovedAccountTombstone,
  SaveAccountsReplaceOptions,
} from "../modules/accounts/index.js"
export {
  addTombstones,
  deduplicateAccountsByEmail,
  migrateV2ToV3,
  migrateV3ToV4,
  sanitizeTombstones,
  MAX_TOMBSTONES,
} from "../modules/accounts/index.js"

/** Hashes a refresh token for backward-compatible account identity lookups. */
export { fingerprintRefreshToken } from "../adapters/filesystem/account-store.js"

/** Creates a deletion tombstone using the filesystem adapter's hash implementation. */
export function tombstoneForAccount(
  account: { id?: string; refreshToken: string; email?: string },
  removedAt = Date.now(),
): RemovedAccountTombstone {
  return createPolicyTombstone(account, fingerprintRefreshToken, removedAt)
}

/** Checks whether a stored deletion record identifies the given account generation. */
export function tombstoneMatchesAccount(
  tombstone: RemovedAccountTombstone,
  account: { id?: string; refreshToken?: string; email?: string },
): boolean {
  return matchPolicyTombstone(tombstone, account, fingerprintRefreshToken)
}

/** Checks whether explicit account re-addition should clear a tombstone. */
export function tombstoneMatchesReAdd(
  tombstone: RemovedAccountTombstone,
  identity: { id?: string; refreshToken?: string; email?: string },
): boolean {
  return matchPolicyReAdd(tombstone, identity, fingerprintRefreshToken)
}

/** Reports whether a stored account is excluded by deletion history. */
export function isTombstoned(
  account: { id?: string; refreshToken?: string; email?: string },
  tombstones?: RemovedAccountTombstone[],
): boolean {
  return isPolicyTombstoned(account, tombstones, fingerprintRefreshToken)
}

/** Filters deleted account generations from a persistence snapshot. */
export function filterTombstonedAccounts<T extends { id?: string; refreshToken?: string; email?: string }>(
  accounts: T[],
  tombstones?: RemovedAccountTombstone[],
): T[] {
  return filterPolicyTombstones(accounts, tombstones, fingerprintRefreshToken)
}

/** Removes tombstones matched by a deliberate re-add of an account identity. */
export function clearTombstonesForAccount(
  tombstones: RemovedAccountTombstone[] | undefined,
  identity: { id?: string; refreshToken?: string; email?: string },
): RemovedAccountTombstone[] | undefined {
  return clearPolicyTombstones(tombstones, identity, fingerprintRefreshToken)
}

/** Keeps only pending deletion records that still identify a locked disk account. */
export function reconcilePendingTombstones(
  pending: RemovedAccountTombstone[],
  diskAccounts: { id?: string; refreshToken?: string; email?: string }[],
): RemovedAccountTombstone[] {
  return reconcilePolicyTombstones(pending, diskAccounts, fingerprintRefreshToken)
}
