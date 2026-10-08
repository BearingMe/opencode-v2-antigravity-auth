import type { AccountPersistencePort } from "../ports.js"
import {
  addTombstones,
  filterTombstonedAccounts,
  mergeAccountStorage,
  sanitizeTombstones,
  type AccountStorageV4,
  type AccountTokenFingerprint,
} from "./policy.js"

/** Options for replacing persisted accounts without carrying forward disk tombstones. */
export interface SaveAccountsReplaceOptions {
  /** Clears current disk tombstones only for an intentional full store reset. */
  clearTombstones?: boolean
}

/** Read-modify-write callback used by account persistence updates. */
export type AccountStorageUpdater<Result> = (
  current: AccountStorageV4,
) => { storage: AccountStorageV4; result: Result } | Promise<{ storage: AccountStorageV4; result: Result }>

/** Account persistence use cases, independent of filesystem and locking mechanics. */
export interface AccountPersistenceService {
  load(): Promise<AccountStorageV4 | null>
  save(storage: AccountStorageV4): Promise<void>
  saveReplace(storage: AccountStorageV4, options?: SaveAccountsReplaceOptions): Promise<void>
  update<Result>(updater: AccountStorageUpdater<Result>): Promise<Result>
}

/**
 * Applies account-store merge, replacement, and tombstone rules over a persistence port.
 *
 * @example `createAccountPersistenceService(fileStore, fingerprintToken)`
 */
export function createAccountPersistenceService(
  port: AccountPersistencePort<AccountStorageV4>,
  fingerprint: AccountTokenFingerprint,
): AccountPersistenceService {
  return {
    load: () => port.load(),
    save: (storage) =>
      port.transact(async (current) => ({
        state: mergeAccountStorage(current, storage, fingerprint),
        result: undefined,
      })),
    saveReplace: (storage, options) => {
      if (options?.clearTombstones) {
        const tombstones = sanitizeTombstones(storage.removedAccounts)
        return port.replace({
          ...storage,
          version: 4,
          accounts: filterTombstonedAccounts(storage.accounts, tombstones, fingerprint),
          removedAccounts: tombstones,
        })
      }

      return port.transact(async (current) => {
        const tombstones = addTombstones(current.removedAccounts, storage.removedAccounts ?? [])
        return {
          state: {
            ...storage,
            version: 4,
            accounts: filterTombstonedAccounts(storage.accounts, tombstones, fingerprint),
            removedAccounts: tombstones,
          },
          result: undefined,
        }
      })
    },
    update: (updater) =>
      port.transact(async (current) => {
        const normalized = normalizeTransactionInput(current, fingerprint)
        const { storage, result } = await updater(normalized)
        if (storage === normalized) return { state: current, result }

        const tombstones = sanitizeTombstones(storage.removedAccounts)
        return {
          state: {
            ...storage,
            version: 4,
            accounts: filterTombstonedAccounts(storage.accounts, tombstones, fingerprint),
            removedAccounts: tombstones,
          },
          result,
        }
      }),
  }
}

/** Clamps and tombstone-filters the locked value before account code can mutate it. */
function normalizeTransactionInput(current: AccountStorageV4, fingerprint: AccountTokenFingerprint): AccountStorageV4 {
  const activeIndex =
    current.accounts.length > 0 ? Math.min(Math.max(current.activeIndex, 0), current.accounts.length - 1) : 0
  return {
    ...current,
    version: 4,
    activeIndex,
    accounts: filterTombstonedAccounts(current.accounts, current.removedAccounts, fingerprint),
    removedAccounts: sanitizeTombstones(current.removedAccounts),
  }
}
