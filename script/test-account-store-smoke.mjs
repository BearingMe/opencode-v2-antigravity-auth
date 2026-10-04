import assert from "node:assert/strict"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const configDir = mkdtempSync(join(tmpdir(), "antigravity-account-store-smoke-"))
const storePath = join(configDir, "antigravity-accounts.json")
const previousConfigDir = process.env.OPENCODE_CONFIG_DIR

/** Runs account persistence against a synthetic legacy and current store. */
async function runAccountStoreSmoke() {
  process.env.OPENCODE_CONFIG_DIR = configDir
  const storage = await import("../dist/src/plugin/storage.js")

  assert.equal(await storage.loadAccounts(), null, "a missing account store should stay absent on load")

  const legacyStore = {
    version: 2,
    activeIndex: 0,
    accounts: [
      {
        email: "smoke@example.invalid",
        refreshToken: "synthetic-refresh-token-do-not-use",
        projectId: "synthetic-project",
        addedAt: 1,
        lastUsed: 2,
        rateLimitResetTimes: {},
      },
    ],
  }
  writeFileSync(storePath, JSON.stringify(legacyStore))

  const migrated = await storage.loadAccounts()
  assert.equal(migrated?.version, 4, "legacy account stores should migrate to v4")
  assert.equal(migrated?.accounts[0]?.email, "smoke@example.invalid")
  assert.equal(JSON.parse(readFileSync(storePath, "utf8")).version, 4, "the migration should persist")

  const { AccountPoolManager } = await import("../dist/src/modules/accounts/index.js")
  const { generateFingerprint, updateFingerprintVersion } = await import("../dist/src/plugin/fingerprint.js")
  const manager = new AccountPoolManager(undefined, migrated, {
    clock: { now: () => 100 },
    update: storage.updateAccounts,
    fingerprintToken: storage.fingerprintRefreshToken,
    generateId: () => "synthetic-account-id",
    generateFingerprint,
    updateFingerprintVersion,
    processId: 1,
    formatAccountLabel: (_email, index) => `Account ${index + 1}`,
    logSoftQuotaSkipped: () => undefined,
    logSelection: () => undefined,
    random: () => 0.5,
  })
  assert.equal(manager.getCurrentOrNextForFamily("gemini", undefined, "sticky")?.index, 0)
  manager.markAccountUsed(0)
  await manager.saveToDisk()
  const poolSaved = await storage.loadAccounts()
  assert.ok(poolSaved, "the synthetic pool save should produce a current store")
  assert.equal(poolSaved?.accounts[0]?.lastUsed, 100, "pool bookkeeping should persist through the storage port")

  const staleSnapshot = poolSaved
  const deleted = poolSaved?.accounts[0]
  assert.ok(deleted, "the synthetic account should be available for deletion")
  const tombstone = storage.tombstoneForAccount(deleted, 100)
  await storage.updateAccounts((current) => ({
    storage: {
      ...current,
      accounts: [],
      removedAccounts: storage.addTombstones(current.removedAccounts, [tombstone]),
    },
    result: undefined,
  }))

  await storage.saveAccounts(staleSnapshot)
  const afterStaleSave = await storage.loadAccounts()
  assert.equal(afterStaleSave?.accounts.length, 0, "a stale save must not resurrect the deleted account")
  assert.equal(
    afterStaleSave?.removedAccounts?.[0]?.tokenFingerprint,
    storage.fingerprintRefreshToken(deleted.refreshToken),
  )
  assert.equal("refreshToken" in (afterStaleSave?.removedAccounts?.[0] ?? {}), false)

  const corruptContents = "{synthetic-corrupt-store"
  writeFileSync(storePath, corruptContents)
  await assert.rejects(
    storage.updateAccounts((current) => ({ storage: { ...current, accounts: [] }, result: undefined })),
    { name: "AccountStoreUnreadableError" },
  )
  assert.equal(readFileSync(storePath, "utf8"), corruptContents, "a failed transaction must preserve unreadable data")
}

try {
  await runAccountStoreSmoke()
} finally {
  if (previousConfigDir === undefined) delete process.env.OPENCODE_CONFIG_DIR
  else process.env.OPENCODE_CONFIG_DIR = previousConfigDir
  rmSync(configDir, { recursive: true, force: true })
}

console.log(
  "Built-package account-store smoke passed (migration, pool persistence, stale-delete protection, and corrupt-store safety).",
)
