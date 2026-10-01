import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { AccountManager } from "./accounts"
import { deleteAllAccounts, mutateAccount, persistOAuthAccount } from "./account-service.js"
import {
  AccountStoreUnreadableError,
  MAX_TOMBSTONES,
  addTombstones,
  getStoragePath,
  loadAccounts,
  saveAccounts,
  saveAccountsReplace,
  tombstoneForAccount,
  updateAccounts,
  type AccountMetadataV3,
  type AccountStorageV4,
} from "./storage"

let configDir = ""

function seedAccount(overrides: Partial<AccountMetadataV3> & { refreshToken: string }): AccountMetadataV3 {
  return {
    addedAt: 1,
    lastUsed: 2,
    enabled: true,
    ...overrides,
  }
}

async function seedStore(accounts: AccountMetadataV3[]): Promise<void> {
  await updateAccounts((current) => ({
    storage: { ...current, accounts: [...accounts] },
    result: undefined,
  }))
}

const baseSeed = () => [
  seedAccount({ id: "acc-one", email: "one@example.com", refreshToken: "token-one" }),
  seedAccount({ id: "acc-two", email: "two@example.com", refreshToken: "token-two" }),
]

describe("account tombstones", () => {
  beforeEach(async () => {
    configDir = await mkdtemp(join(tmpdir(), "antigravity-tombstone-"))
    process.env.OPENCODE_CONFIG_DIR = configDir
    await seedStore(baseSeed())
  })

  afterEach(async () => {
    delete process.env.OPENCODE_CONFIG_DIR
    await rm(configDir, { recursive: true, force: true })
  })

  it("delete-then-reload stays deleted", async () => {
    const outcome = await mutateAccount({ index: 0 }, "delete")

    expect(outcome).toMatchObject({ op: "delete", remaining: 1 })
    const reloaded = await loadAccounts()
    expect(reloaded?.accounts.map((account) => account.email)).toEqual(["two@example.com"])
    expect(reloaded?.removedAccounts).toMatchObject([{ id: "acc-one" }])
  })

  it("a stale merging save does not resurrect the deleted account", async () => {
    await mutateAccount({ index: 0 }, "delete")

    // Simulate a stale snapshot (e.g. an in-memory manager loaded before
    // the delete) persisted through the merging save path.
    const stale: AccountStorageV4 = { version: 4, accounts: baseSeed(), activeIndex: 0 }
    await saveAccounts(stale)

    const reloaded = await loadAccounts()
    expect(reloaded?.accounts.map((account) => account.email)).toEqual(["two@example.com"])
  })

  it("last-account removal empties the pool and tombstones everything", async () => {
    await deleteAllAccounts()

    const reloaded = await loadAccounts()
    expect(reloaded?.accounts).toHaveLength(0)
    expect(reloaded?.removedAccounts).toHaveLength(2)

    const manager = await AccountManager.loadFromDisk()
    expect(manager.getAccountCount()).toBe(0)
  })

  it("re-adding the same account via fresh OAuth clears its tombstone", async () => {
    await mutateAccount({ index: 0 }, "delete")

    const outcome = await persistOAuthAccount(
      { refresh: "token-one-fresh", email: "one@example.com", projectId: "p1" },
      "add",
    )

    expect(outcome.accountCount).toBe(2)
    const reloaded = await loadAccounts()
    expect(reloaded?.accounts.map((account) => account.email)).toEqual(["two@example.com", "one@example.com"])
    expect(reloaded?.removedAccounts ?? []).toHaveLength(0)
  })

  it("a stale background manager save does not resurrect the deleted account", async () => {
    const staleManager = await AccountManager.loadFromDisk()
    expect(staleManager.getTotalAccountCount()).toBe(2)

    await mutateAccount({ id: "acc-two" }, "delete")

    // Background refresh-queue style persist from the stale manager.
    await staleManager.saveToDisk()

    const reloaded = await loadAccounts()
    expect(reloaded?.accounts.map((account) => account.email)).toEqual(["one@example.com"])
    expect(reloaded?.removedAccounts).toMatchObject([{ id: "acc-two" }])
  })

  it("manager-side removal (invalid_grant eviction path) persists through save", async () => {
    const manager = await AccountManager.loadFromDisk()
    const victim = manager.getAccounts().find((account) => account.id === "acc-one")
    expect(victim).toBeDefined()
    if (!victim) return

    expect(manager.removeAccount(victim)).toBe(true)
    await manager.saveToDisk()

    const reloaded = await loadAccounts()
    expect(reloaded?.accounts.map((account) => account.email)).toEqual(["two@example.com"])
    expect(reloaded?.removedAccounts).toMatchObject([{ id: "acc-one" }])
  })

  it("pre-id accounts stay deleted via token fingerprint", async () => {
    await seedStore([seedAccount({ email: "legacy@example.com", refreshToken: "legacy-token" })])

    await mutateAccount({ index: 0 }, "delete")

    const stale: AccountStorageV4 = {
      version: 4,
      accounts: [seedAccount({ email: "legacy@example.com", refreshToken: "legacy-token" })],
      activeIndex: 0,
    }
    await saveAccounts(stale)

    const reloaded = await loadAccounts()
    expect(reloaded?.accounts).toHaveLength(0)
    expect(reloaded?.removedAccounts?.[0]).toMatchObject({ email: "legacy@example.com" })
    expect(reloaded?.removedAccounts?.[0]?.tokenFingerprint).toEqual(expect.any(String))
    expect(JSON.stringify(reloaded?.removedAccounts)).not.toContain("legacy-token")
  })

  it("duplicate tombstone refreshes removedAt to the latest deletion", async () => {
    const first = tombstoneForAccount({ id: "acc-one", refreshToken: "token-one" }, 100)
    const existing = addTombstones(undefined, [first])
    expect(existing?.[0]?.removedAt).toBe(100)

    const second = tombstoneForAccount({ id: "acc-one", refreshToken: "token-one" }, 200)
    const refreshed = addTombstones(existing, [second])

    expect(refreshed).toHaveLength(1)
    expect(refreshed?.[0]?.removedAt).toBe(200)
  })

  it("caps tombstones at MAX_TOMBSTONES, pruning the oldest", async () => {
    const entries = Array.from({ length: MAX_TOMBSTONES + 5 }, (_, index) =>
      tombstoneForAccount({ id: `acc-${index}`, refreshToken: `token-${index}` }, index),
    )

    const capped = addTombstones(undefined, entries)

    expect(capped).toHaveLength(MAX_TOMBSTONES)
    expect(capped?.[0]?.id).toBe("acc-5")
    expect(capped?.[capped.length - 1]?.id).toBe(`acc-${MAX_TOMBSTONES + 4}`)
  })

  it("delete, re-add with a fresh token, then a stale deleter save keeps the re-added account", async () => {
    const staleDeleter = await AccountManager.loadFromDisk()
    const victim = staleDeleter.getAccounts().find((account) => account.id === "acc-one")
    expect(victim).toBeDefined()
    if (!victim) return
    expect(staleDeleter.removeAccount(victim)).toBe(true)

    // Service-side delete plus a fresh re-add for the same email lands
    // before the stale deleter flushes: the re-add is a new generation with
    // a new durable id, so the stale tombstone must not match it.
    await mutateAccount({ id: "acc-one" }, "delete")
    const outcome = await persistOAuthAccount(
      { refresh: "token-one-fresh", email: "one@example.com", projectId: "p1" },
      "add",
    )
    expect(outcome.accountCount).toBe(2)

    await staleDeleter.saveToDisk()

    const reloaded = await loadAccounts()
    expect(reloaded?.accounts.map((account) => account.email).sort()).toEqual(["one@example.com", "two@example.com"])
  })

  it("replace with a stale snapshot lacking removedAccounts preserves disk tombstones", async () => {
    await mutateAccount({ index: 0 }, "delete")
    expect((await loadAccounts())?.removedAccounts).toHaveLength(1)

    // Stale snapshot from before the delete: no removedAccounts at all.
    const stale: AccountStorageV4 = { version: 4, accounts: baseSeed(), activeIndex: 0 }
    await saveAccountsReplace(stale)

    const reloaded = await loadAccounts()
    expect(reloaded?.accounts.map((account) => account.email)).toEqual(["two@example.com"])
    expect(reloaded?.removedAccounts).toHaveLength(1)
  })

  it("replace with clearTombstones wipes tombstones for intentional full clears", async () => {
    await mutateAccount({ index: 0 }, "delete")
    expect((await loadAccounts())?.removedAccounts).toHaveLength(1)

    const stale: AccountStorageV4 = { version: 4, accounts: baseSeed(), activeIndex: 0 }
    await saveAccountsReplace(stale, { clearTombstones: true })

    const reloaded = await loadAccounts()
    expect(reloaded?.accounts).toHaveLength(2)
    expect(reloaded?.removedAccounts ?? []).toHaveLength(0)
  })

  it("a corrupt store is never overwritten by an update", async () => {
    const storePath = getStoragePath()
    const before = await readFile(storePath, "utf-8")
    await writeFile(storePath, "{corrupt-json")
    await expect(
      updateAccounts((current) => ({
        storage: { ...current, accounts: [] },
        result: undefined,
      })),
    ).rejects.toThrow(AccountStoreUnreadableError)
    expect(await readFile(storePath, "utf-8")).toBe("{corrupt-json")
    await writeFile(storePath, before)
    expect((await loadAccounts())?.accounts).toHaveLength(2)
  })

  it("a corrupt store is never overwritten by a merging save", async () => {
    const storePath = getStoragePath()
    const before = await readFile(storePath, "utf-8")
    await writeFile(storePath, "{corrupt-json")
    await expect(saveAccounts({ version: 4, accounts: [], activeIndex: 0 })).rejects.toThrow(
      AccountStoreUnreadableError,
    )
    expect(await readFile(storePath, "utf-8")).toBe("{corrupt-json")
    await writeFile(storePath, before)
  })

  it("a corrupt store is never overwritten by a replace save", async () => {
    const storePath = getStoragePath()
    const before = await readFile(storePath, "utf-8")
    await writeFile(storePath, "{corrupt-json")
    await expect(saveAccountsReplace({ version: 4, accounts: [], activeIndex: 0 })).rejects.toThrow(
      AccountStoreUnreadableError,
    )
    expect(await readFile(storePath, "utf-8")).toBe("{corrupt-json")
    await writeFile(storePath, before)
    expect((await loadAccounts())?.accounts).toHaveLength(2)
  })

  it("an unknown future version is never overwritten", async () => {
    const storePath = getStoragePath()
    const before = await readFile(storePath, "utf-8")
    const future = JSON.stringify({ version: 999, accounts: [], activeIndex: 0 })
    await writeFile(storePath, future)
    const empty: AccountStorageV4 = { version: 4, accounts: [], activeIndex: 0 }
    await expect(
      updateAccounts((current) => ({ storage: { ...current, accounts: [] }, result: undefined })),
    ).rejects.toThrow(AccountStoreUnreadableError)
    await expect(saveAccounts(empty)).rejects.toThrow(AccountStoreUnreadableError)
    await expect(saveAccountsReplace(empty)).rejects.toThrow(AccountStoreUnreadableError)
    expect(await readFile(storePath, "utf-8")).toBe(future)
    await writeFile(storePath, before)
    expect((await loadAccounts())?.accounts).toHaveLength(2)
  })
})
