import { describe, expect, it } from "vitest"
import { parseAccountStorageForLoad, parseAccountStorageForTransaction, tombstoneForAccount } from "./policy.js"
import type { AccountMetadataV3, AccountPersistencePort, AccountStorageV4 } from "../index.js"
import { createAccountPersistenceService } from "./service.js"

/** Supplies stable token fingerprints so these policy tests need no crypto adapter. */
const fingerprint = (token: string): string => `fingerprint:${token}`
const migrationTime = 1_000

/** Creates a storage fixture around the supplied saved accounts. */
function storageWith(accounts: AccountMetadataV3[], activeIndex = 0): AccountStorageV4 {
  return { version: 4, accounts, activeIndex }
}

/** Provides an in-memory transaction port and exposes committed state for policy assertions. */
function createMemoryPort(initial: AccountStorageV4): {
  port: AccountPersistencePort<AccountStorageV4>
  readCommitted: () => AccountStorageV4
  writeCount: () => number
} {
  let state = initial
  let writes = 0
  return {
    port: {
      load: async () => state,
      transact: async (update) => {
        const next = await update(state)
        if (next.state !== state) {
          state = next.state
          writes += 1
        }
        return next.result
      },
      replace: async (nextState) => {
        state = nextState
        writes += 1
      },
    },
    readCommitted: () => state,
    writeCount: () => writes,
  }
}

describe("account persistence policy", () => {
  it("loads v1 through v4 into the current shape with deterministic migration time", () => {
    const v1 = {
      version: 1 as const,
      activeIndex: 0,
      accounts: [
        {
          refreshToken: "v1-token",
          addedAt: 1,
          lastUsed: 2,
          isRateLimited: true,
          rateLimitResetTime: migrationTime + 10,
        },
      ],
    }
    const v2 = {
      version: 2 as const,
      activeIndex: 0,
      accounts: [{ refreshToken: "v2-token", addedAt: 1, lastUsed: 2, rateLimitResetTimes: { gemini: 2_000 } }],
    }
    const v3 = {
      version: 3 as const,
      activeIndex: 0,
      activeIndexByFamily: { claude: 0, gemini: 0 },
      accounts: [{ refreshToken: "v3-token", addedAt: 1, lastUsed: 2 }],
    }
    const v4 = storageWith([{ refreshToken: "v4-token", addedAt: 1, lastUsed: 2 }])

    const migratedV1 = parseAccountStorageForLoad(v1, fingerprint, migrationTime)
    const migratedV2 = parseAccountStorageForLoad(v2, fingerprint, migrationTime)
    const migratedV3 = parseAccountStorageForLoad(v3, fingerprint, migrationTime)
    const currentV4 = parseAccountStorageForLoad(v4, fingerprint, migrationTime)

    expect(migratedV1.storage.accounts[0]?.rateLimitResetTimes).toEqual({
      claude: migrationTime + 10,
      "gemini-antigravity": migrationTime + 10,
    })
    expect(migratedV2.storage.accounts[0]?.rateLimitResetTimes).toEqual({ "gemini-antigravity": 2_000 })
    expect(migratedV3.storage.activeIndexByFamily).toEqual({ claude: 0, gemini: 0 })
    expect([migratedV1.migrated, migratedV2.migrated, migratedV3.migrated, currentV4.migrated]).toEqual([
      true,
      true,
      true,
      false,
    ])
    expect(currentV4.storage.accounts[0]?.refreshToken).toBe("v4-token")
  })

  it("preserves manual project settings and newest use time while merging snapshots", async () => {
    const existing = storageWith([
      {
        id: "saved-account",
        refreshToken: "same-token",
        projectId: "manual-project",
        managedProjectId: "manual-managed-project",
        addedAt: 1,
        lastUsed: 300,
        rateLimitResetTimes: { claude: 500 },
      },
    ])
    const memory = createMemoryPort(existing)
    const service = createAccountPersistenceService(memory.port, fingerprint)

    await service.save(
      storageWith([
        {
          id: "saved-account",
          refreshToken: "same-token",
          addedAt: 1,
          lastUsed: 200,
          rateLimitResetTimes: { "gemini-antigravity": 700 },
        },
      ]),
    )

    expect(memory.readCommitted().accounts[0]).toMatchObject({
      projectId: "manual-project",
      managedProjectId: "manual-managed-project",
      lastUsed: 300,
      rateLimitResetTimes: { claude: 500, "gemini-antigravity": 700 },
    })
  })

  it("does not restore an account matched by an existing deletion tombstone", async () => {
    const deleted = { id: "removed", refreshToken: "removed-token", email: "removed@example.invalid" }
    const tombstone = tombstoneForAccount(deleted, fingerprint, migrationTime)
    const memory = createMemoryPort({
      ...storageWith([]),
      removedAccounts: [tombstone],
    })
    const service = createAccountPersistenceService(memory.port, fingerprint)

    await service.save(storageWith([{ ...deleted, addedAt: 1, lastUsed: 2 }]))

    expect(memory.readCommitted().accounts).toHaveLength(0)
    expect(memory.readCommitted().removedAccounts).toEqual([tombstone])
  })

  it("deduplicates v4 account state before a locked transaction callback sees it", () => {
    const older = {
      refreshToken: "older-token",
      email: "same@example.invalid",
      addedAt: 1,
      lastUsed: 10,
    }
    const newer = {
      refreshToken: "newer-token",
      email: "same@example.invalid",
      addedAt: 2,
      lastUsed: 20,
    }

    const normalized = parseAccountStorageForTransaction(storageWith([older, newer]), fingerprint, migrationTime)

    expect(normalized.accounts).toEqual([newer])
  })
})
