import assert from "node:assert/strict"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const configDir = mkdtempSync(join(tmpdir(), "antigravity-account-admin-smoke-"))
const previousConfigDir = process.env.OPENCODE_CONFIG_DIR

/** Exercises account administration against isolated storage and synthetic credentials. */
async function runAccountAdminSmoke() {
  process.env.OPENCODE_CONFIG_DIR = configDir
  const { createLegacyAccountAdministration } = await import("../dist/src/app/legacy-bridges/accounts.js")
  const { loadAccounts } = await import("../dist/src/plugin/storage.js")
  const administration = createLegacyAccountAdministration()

  await administration.persistOAuth(
    { refresh: "synthetic-refresh-0", email: "smoke-0@example.invalid", projectId: "synthetic-project" },
    "add",
  )
  const firstList = await administration.list()
  assert.equal(firstList.accounts.length, 1, "OAuth persistence should make the account available to list")
  assert.deepEqual(
    Object.keys(firstList.accounts[0] ?? {}).sort(),
    ["active", "email", "enabled", "id", "index", "verificationRequired", "verificationStatus"].sort(),
    "list results expose only approved credential-free account fields",
  )

  const stale = await administration.mutate({ id: "stale-account-id" }, "delete")
  assert.deepEqual(stale, { ok: false, kind: "not-found", accountCount: 1 })
  assert.equal((await administration.list()).accounts.length, 1, "a stale delete must leave persisted state untouched")

  for (let index = 1; index < 10; index += 1) {
    await administration.persistOAuth(
      {
        refresh: `synthetic-refresh-${index}`,
        email: `smoke-${index}@example.invalid`,
        projectId: "synthetic-project",
      },
      "add",
    )
  }
  await assert.rejects(
    administration.persistOAuth(
      { refresh: "synthetic-refresh-overflow", email: "overflow@example.invalid", projectId: "synthetic-project" },
      "add",
    ),
    /Maximum of 10 Antigravity accounts reached/,
  )
  assert.equal((await loadAccounts())?.accounts.length, 10, "capacity failure must not partially persist")

  await administration.deleteAll()
  assert.equal((await administration.list()).accounts.length, 0, "delete-all should clear the account pool")
}

try {
  await runAccountAdminSmoke()
} finally {
  if (previousConfigDir === undefined) delete process.env.OPENCODE_CONFIG_DIR
  else process.env.OPENCODE_CONFIG_DIR = previousConfigDir
  rmSync(configDir, { recursive: true, force: true })
}

console.log("Account administration smoke passed (synthetic credentials; isolated storage).")
