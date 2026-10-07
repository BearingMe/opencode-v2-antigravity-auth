import { randomUUID } from "node:crypto"
import {
  AccountPoolManager,
  type AccountPoolDependencies,
  type AccountStorageV4,
  type PoolOAuthAuth,
} from "../../modules/accounts/index.js"
import { fingerprintRefreshToken, loadAccounts, updateAccounts } from "../filesystem/account-store.js"
import { generateFingerprint, updateFingerprintVersion } from "../antigravity/fingerprint.js"
import { debugLogToFile } from "./debug.js"
import { formatAccountLabel } from "../../modules/accounts/index.js"

/** Constructs persistence, identity, and logging dependencies for an OpenCode account pool. */
function createAccountPoolDependencies(): AccountPoolDependencies {
  return {
    clock: { now: () => Date.now() },
    update: updateAccounts,
    fingerprintToken: fingerprintRefreshToken,
    generateId: randomUUID,
    generateFingerprint,
    updateFingerprintVersion,
    processId: process.pid,
    formatAccountLabel,
    logSoftQuotaSkipped: debugLogToFile,
    logSelection: debugLogToFile,
    random: () => Math.random(),
  }
}

/** OpenCode account-manager adapter backed by the accounts module pool. */
export class AccountManager extends AccountPoolManager {
  /** Loads account state through the filesystem adapter. */
  static async loadFromDisk(authFallback?: PoolOAuthAuth): Promise<AccountManager> {
    return new AccountManager(authFallback, await loadAccounts())
  }

  /** Constructs the module pool with OpenCode persistence and identity adapters. */
  constructor(authFallback?: PoolOAuthAuth, stored?: AccountStorageV4 | null) {
    super(authFallback, stored, createAccountPoolDependencies())
  }
}
