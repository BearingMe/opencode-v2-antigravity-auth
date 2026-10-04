import { promises as fs } from "node:fs"
import { copyFileSync, existsSync, mkdirSync, renameSync, unlinkSync } from "node:fs"
import { createHash, randomBytes } from "node:crypto"
import { homedir } from "node:os"
import { dirname, join } from "node:path"
import lockfile from "proper-lockfile"
import type { AccountPersistencePort } from "../../modules/accounts/index.js"
import {
  AccountStorageFormatError,
  AccountStoreUnreadableError,
  createAccountPersistenceService,
  parseAccountStorageForLoad,
  parseAccountStorageForTransaction,
  type AccountStorageV4,
} from "../../modules/accounts/index.js"
import {
  ensureGitignore as ensureConfigGitignore,
  ensureGitignoreSync as ensureConfigGitignoreSync,
} from "./config-directory.js"
import type { GitignoreUpdate } from "./config-directory.js"
import { createLogger } from "../../plugin/logger.js"
import type { AccountStorageUpdater, SaveAccountsReplaceOptions } from "../../modules/accounts/index.js"

const log = createLogger("storage")

const LOCK_OPTIONS = {
  stale: 10000,
  retries: {
    retries: 5,
    minTimeout: 100,
    maxTimeout: 1000,
    factor: 2,
  },
}

export { GITIGNORE_ENTRIES } from "./config-directory.js"

/** Ensures the config directory ignores its private plugin state. */
export async function ensureGitignore(configDir: string): Promise<void> {
  reportGitignoreUpdate(await ensureConfigGitignore(configDir))
}

/** Synchronous variant used by existing startup and cache paths. */
export function ensureGitignoreSync(configDir: string): void {
  reportGitignoreUpdate(ensureConfigGitignoreSync(configDir))
}

/** Hashes a refresh token before it is used as a credential-free account identity. */
export function fingerprintRefreshToken(refreshToken: string): string {
  return createHash("sha256").update(refreshToken, "utf8").digest("hex")
}

/** Resolves the plugin config directory, honoring explicit and XDG paths. */
export function getConfigDir(): string {
  if (process.env.OPENCODE_CONFIG_DIR) return process.env.OPENCODE_CONFIG_DIR
  const xdgConfig = process.env.XDG_CONFIG_HOME || join(homedir(), ".config")
  return join(xdgConfig, "opencode")
}

/** Resolves the store path and migrates the former Windows location when possible. */
export function getStoragePath(): string {
  const path = join(getConfigDir(), "antigravity-accounts.json")
  if (process.platform !== "win32") return path

  const legacyPath = join(
    process.env.APPDATA || join(homedir(), "AppData", "Roaming"),
    "opencode",
    "antigravity-accounts.json",
  )
  if (!existsSync(legacyPath) || existsSync(path)) return path

  try {
    mkdirSync(dirname(path), { recursive: true })
    try {
      renameSync(legacyPath, path)
      log.info("Migrated Windows config via rename", { from: legacyPath, to: path })
    } catch {
      copyFileSync(legacyPath, path)
      unlinkSync(legacyPath)
      log.info("Migrated Windows config via copy+delete", { from: legacyPath, to: path })
    }
  } catch (error) {
    log.warn("Failed to migrate legacy Windows config, will use legacy path", {
      legacyPath,
      newPath: path,
      error: String(error),
    })
    if (existsSync(legacyPath) && !existsSync(path)) return legacyPath
  }

  return path
}

/** Account-store reads distinguish missing data from unreadable data for transactions. */
type StoreReadResult = { status: "ok"; storage: AccountStorageV4 | null } | { status: "unreadable"; error: unknown }

/** Filesystem-backed implementation of the account persistence transaction port. */
class FileAccountStore implements AccountPersistencePort<AccountStorageV4> {
  private migrationWriter: ((storage: AccountStorageV4) => Promise<void>) | undefined

  /** Connects legacy-version loading to the account-owned migration save policy. */
  setMigrationWriter(writer: (storage: AccountStorageV4) => Promise<void>): void {
    this.migrationWriter = writer
  }

  /** Reads, validates, and migrates the account file without exposing filesystem details. */
  async load(): Promise<AccountStorageV4 | null> {
    const path = getStoragePath()
    try {
      await ensureSecurePermissions(path)
      const parsed: unknown = JSON.parse(await fs.readFile(path, "utf-8"))
      const { storage, migrated } = parseAccountStorageForLoad(parsed, fingerprintRefreshToken)
      if (migrated) {
        log.info("Migrating account storage to v4")
        try {
          await this.migrationWriter?.(storage)
          log.info("Migration to v4 complete")
        } catch (error) {
          log.warn("Failed to persist migrated storage", { error: String(error) })
        }
      }
      return storage
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null
      log.error("Failed to load account storage", { error: String(error) })
      return null
    }
  }

  /** Runs an account update under the file lock and atomically commits changed state. */
  async transact<Result>(
    update: (state: AccountStorageV4) => Promise<{ state: AccountStorageV4; result: Result }>,
  ): Promise<Result> {
    const path = getStoragePath()
    await fs.mkdir(dirname(path), { recursive: true })
    await ensureGitignore(dirname(path))

    return withFileLock(path, async () => {
      const read = await readStoreUnsafe(path)
      throwIfUnreadable(read, path)
      const current = read.storage ?? emptyAccountStorage()
      const { state, result } = await update(current)
      if (state === current) return result
      await writeAtomically(path, state)
      return result
    })
  }

  /** Replaces state under lock without reading a store explicitly cleared by the caller. */
  async replace(state: AccountStorageV4): Promise<void> {
    const path = getStoragePath()
    await fs.mkdir(dirname(path), { recursive: true })
    await ensureGitignore(dirname(path))
    await withFileLock(path, () => writeAtomically(path, state))
  }
}

const fileStore = new FileAccountStore()
const persistence = createAccountPersistenceService(fileStore, fingerprintRefreshToken)
fileStore.setMigrationWriter(persistence.save)

/** Loads normalized account state, returning null when no usable store exists. */
export function loadAccounts(): Promise<AccountStorageV4 | null> {
  return persistence.load()
}

/** Merges a snapshot with current disk state without restoring tombstoned accounts. */
export function saveAccounts(storage: AccountStorageV4): Promise<void> {
  return persistence.save(storage)
}

/** Replaces the store while retaining tombstones unless an explicit full clear is requested. */
export function saveAccountsReplace(storage: AccountStorageV4, options?: SaveAccountsReplaceOptions): Promise<void> {
  return persistence.saveReplace(storage, options)
}

/** Performs a lock-scoped read-modify-write using account-owned state policy. */
export function updateAccounts<Result>(updater: AccountStorageUpdater<Result>): Promise<Result> {
  return persistence.update(updater)
}

/** Removes the account file, treating an already-missing store as cleared. */
export async function clearAccounts(): Promise<void> {
  try {
    await fs.unlink(getStoragePath())
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      log.error("Failed to clear account storage", { error: String(error) })
    }
  }
}

/** Keeps the existing storage-service log messages for config ignore changes. */
function reportGitignoreUpdate(outcome: GitignoreUpdate): void {
  if (outcome.status === "created") {
    log.info("Created .gitignore in config directory")
  } else if (outcome.status === "updated") {
    log.info("Updated .gitignore with missing entries", { added: outcome.added })
  }
}

/** Provides the default v4 state used before the first account is saved. */
function emptyAccountStorage(): AccountStorageV4 {
  return { version: 4, accounts: [], activeIndex: 0 }
}

/** Applies best-effort POSIX permissions when an existing store is read. */
async function ensureSecurePermissions(path: string): Promise<void> {
  try {
    await fs.chmod(path, 0o600)
  } catch {
    // chmod is unavailable on some filesystems and Windows; data access still proceeds.
  }
}

/** Creates the initial store before acquiring the lock, matching the existing lockfile protocol. */
async function ensureFileExists(path: string): Promise<void> {
  try {
    await fs.access(path)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error
    await fs.mkdir(dirname(path), { recursive: true })
    await fs.writeFile(path, JSON.stringify(emptyAccountStorage(), null, 2), {
      encoding: "utf-8",
      mode: 0o600,
    })
  }
}

/** Acquires and releases the account-file lock around one transaction. */
async function withFileLock<Result>(path: string, action: () => Promise<Result>): Promise<Result> {
  await ensureFileExists(path)
  let release: (() => Promise<void>) | null = null
  try {
    release = await lockfile.lock(path, LOCK_OPTIONS)
    return await action()
  } finally {
    if (release) {
      try {
        await release()
      } catch (error) {
        log.warn("Failed to release lock", { error: String(error) })
      }
    }
  }
}

/** Reads and normalizes the current file, preserving failures for fail-closed writes. */
async function readStoreUnsafe(path: string): Promise<StoreReadResult> {
  try {
    await ensureSecurePermissions(path)
    const parsed: unknown = JSON.parse(await fs.readFile(path, "utf-8"))
    return {
      status: "ok",
      storage: parseAccountStorageForTransaction(parsed, fingerprintRefreshToken),
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { status: "ok", storage: null }
    return { status: "unreadable", error }
  }
}

/** Converts an unsafe read result into the compatibility error before any write can occur. */
function throwIfUnreadable(
  read: StoreReadResult,
  path: string,
): asserts read is { status: "ok"; storage: AccountStorageV4 | null } {
  if (read.status === "unreadable") {
    const code = (read.error as NodeJS.ErrnoException)?.code
    log.error("Refusing to overwrite unreadable account storage", { error: String(read.error) })
    const message =
      read.error instanceof AccountStorageFormatError
        ? `${read.error.message}. Refusing to overwrite ${path} so saved accounts are preserved.`
        : undefined
    throw new AccountStoreUnreadableError(path, code, message)
  }
}

/** Writes v4 JSON through a same-directory temporary file before atomic replacement. */
async function writeAtomically(path: string, storage: AccountStorageV4): Promise<void> {
  const tempPath = `${path}.${randomBytes(6).toString("hex")}.tmp`
  try {
    await fs.writeFile(tempPath, JSON.stringify(storage, null, 2), { encoding: "utf-8", mode: 0o600 })
    await fs.rename(tempPath, path)
  } catch (error) {
    try {
      await fs.unlink(tempPath)
    } catch (cleanupError) {
      if ((cleanupError as NodeJS.ErrnoException).code !== "ENOENT") {
        log.warn("Failed to remove temporary account store", { tempPath, error: String(cleanupError) })
      }
    }
    throw error
  }
}

export type { SaveAccountsReplaceOptions, AccountStorageUpdater } from "../../modules/accounts/index.js"
export { AccountStoreUnreadableError } from "../../modules/accounts/index.js"
