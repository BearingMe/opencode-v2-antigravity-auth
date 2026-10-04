import { randomUUID } from "node:crypto"
import { AccountPoolManager, type AccountPoolDependencies, type AccountStorageV4 } from "../modules/accounts/index.js"
import { fingerprintRefreshToken, loadAccounts, updateAccounts } from "./storage"
import { generateFingerprint, updateFingerprintVersion } from "./fingerprint"
import { debugLogToFile } from "./debug"
import { formatAccountLabel } from "./logging-utils"
import type { OAuthAuthDetails } from "./types"

export type { ModelFamily, CooldownReason, AccountSelectionStrategy } from "../modules/accounts/index.js"
export type { ManagedAccount } from "../modules/accounts/index.js"
export type { RateLimitReason } from "../modules/accounts/index.js"
export {
  calculateBackoffMs,
  computeSoftQuotaCacheTtlMs,
  parseRateLimitReason,
  resolveQuotaGroup,
} from "../modules/accounts/index.js"

/** Compatibility result shape retained for existing callers. */
export interface RateLimitBackoffResult {
  backoffMs: number
  reason: import("../modules/accounts/index.js").RateLimitReason
}

/** Constructs the concrete services used by legacy plugin-facing account managers. */
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

/** Legacy account-manager facade backed by the accounts module pool. */
export class AccountManager extends AccountPoolManager {
  /** Loads account state using the existing plugin storage boundary. */
  static async loadFromDisk(authFallback?: OAuthAuthDetails): Promise<AccountManager> {
    return new AccountManager(authFallback, await loadAccounts())
  }

  /** Keeps existing constructor callers while supplying infrastructure at the plugin boundary. */
  constructor(authFallback?: OAuthAuthDetails, stored?: AccountStorageV4 | null) {
    super(authFallback, stored, createAccountPoolDependencies())
  }
}
