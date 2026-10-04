import type { AccountTarget, AccountTargetFailure, AccountVerificationResult } from "../index.js"
import type { AccountPersistenceService } from "../persistence/service.js"
import type { AccountMetadataV3, AccountStorageV4 } from "../persistence/policy.js"
import type { AccountAccessVerificationResult } from "./types.js"

/** Dependencies needed to persist account verification policy decisions. */
export interface AccountVerificationPolicyDependencies {
  persistence: AccountPersistenceService
  generateId(): string
  now(): number
  verifyAccount(account: AccountMetadataV3): Promise<AccountAccessVerificationResult>
}

/** Resolves, verifies, and transactionally records one account's access state. */
export async function verifyAccount(
  dependencies: AccountVerificationPolicyDependencies,
  target: AccountTarget,
): Promise<AccountVerificationResult | AccountTargetFailure> {
  const stored = (await dependencies.persistence.load()) ?? emptyStorage()
  const accounts = [...stored.accounts]
  const resolution = resolveAccountTarget(accounts, target)
  if (!resolution.ok) return resolution
  const account = accounts[resolution.index]
  if (!account) return { ok: false, kind: "not-found", accountCount: accounts.length }
  const hadDurableId = typeof account.id === "string" && account.id.length > 0
  ensureAccountIds(accounts, dependencies.generateId)

  // Re-find the account after network work so a concurrent removal fails closed.
  const targetId = accounts[resolution.index]?.id
  const targetRefreshToken = account.refreshToken
  const verification = await dependencies.verifyAccount(account)
  const checkedAt = dependencies.now()

  return dependencies.persistence.update<AccountVerificationResult | AccountTargetFailure>((current) => {
    const currentAccounts = [...current.accounts]
    ensureAccountIds(currentAccounts, dependencies.generateId)
    let index = targetId !== undefined ? currentAccounts.findIndex((entry) => entry.id === targetId) : -1
    if (index < 0 && !hadDurableId) {
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

/** Provides the empty persisted representation for a missing account file. */
function emptyStorage(): AccountStorageV4 {
  return { version: 4, accounts: [], activeIndex: 0 }
}

/** Assigns stable IDs before verification writes an account record. */
function ensureAccountIds(accounts: AccountMetadataV3[], generateId: () => string): void {
  for (const account of accounts) {
    if (!account.id) account.id = generateId()
  }
}

/** Resolves indices and durable ids without accepting token-derived fallbacks. */
function resolveAccountTarget(
  accounts: AccountMetadataV3[],
  target: AccountTarget,
): { ok: true; index: number } | AccountTargetFailure {
  if ("index" in target) {
    if (!Number.isInteger(target.index) || target.index < 0 || target.index >= accounts.length) {
      return { ok: false, kind: "invalid-index", accountCount: accounts.length }
    }
    return accounts[target.index]
      ? { ok: true, index: target.index }
      : { ok: false, kind: "not-found", accountCount: accounts.length }
  }
  const matches: number[] = []
  accounts.forEach((account, index) => {
    if (account.id !== undefined && account.id === target.id) matches.push(index)
  })
  if (matches.length === 0) return { ok: false, kind: "not-found", accountCount: accounts.length }
  if (matches.length > 1 || matches[0] === undefined) {
    return { ok: false, kind: "ambiguous", accountCount: accounts.length }
  }
  return { ok: true, index: matches[0] }
}
