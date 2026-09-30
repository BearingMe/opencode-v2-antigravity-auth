import { promises as fs } from "node:fs";
import {
  existsSync,
  readFileSync,
  writeFileSync,
  appendFileSync,
  mkdirSync,
  renameSync,
  copyFileSync,
  unlinkSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { createHash, randomBytes } from "node:crypto";
import lockfile from "proper-lockfile";
import type { HeaderStyle } from "../constants";
import { createLogger } from "./logger";

const log = createLogger("storage");

/**
 * Files/directories that should be gitignored in the config directory.
 * These contain sensitive data or machine-specific state.
 */
export const GITIGNORE_ENTRIES = [
  ".gitignore",
  "antigravity-accounts.json",
  "antigravity-accounts.json.*.tmp",
  "antigravity-signature-cache.json",
  "antigravity-logs/",
];

/**
 * Ensures a .gitignore file exists in the config directory with entries
 * for sensitive files. Creates the file if missing, or appends missing
 * entries if it already exists.
 */
export async function ensureGitignore(configDir: string): Promise<void> {
  const gitignorePath = join(configDir, ".gitignore");

  try {
    let content: string;
    let existingLines: string[] = [];

    try {
      content = await fs.readFile(gitignorePath, "utf-8");
      existingLines = content.split("\n").map((line) => line.trim());
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        return;
      }
      content = "";
    }

    const missingEntries = GITIGNORE_ENTRIES.filter(
      (entry) => !existingLines.includes(entry),
    );

    if (missingEntries.length === 0) {
      return;
    }

    if (content === "") {
      await fs.writeFile(
        gitignorePath,
        missingEntries.join("\n") + "\n",
        "utf-8",
      );
      log.info("Created .gitignore in config directory");
    } else {
      const suffix = content.endsWith("\n") ? "" : "\n";
      await fs.appendFile(
        gitignorePath,
        suffix + missingEntries.join("\n") + "\n",
        "utf-8",
      );
      log.info("Updated .gitignore with missing entries", {
        added: missingEntries,
      });
    }
  } catch {
    // Non-critical feature
  }
}

/**
 * Synchronous version of ensureGitignore for use in sync code paths.
 */
export function ensureGitignoreSync(configDir: string): void {
  const gitignorePath = join(configDir, ".gitignore");

  try {
    let content: string;
    let existingLines: string[] = [];

    if (existsSync(gitignorePath)) {
      content = readFileSync(gitignorePath, "utf-8");
      existingLines = content.split("\n").map((line) => line.trim());
    } else {
      content = "";
    }

    const missingEntries = GITIGNORE_ENTRIES.filter(
      (entry) => !existingLines.includes(entry),
    );

    if (missingEntries.length === 0) {
      return;
    }

    if (content === "") {
      writeFileSync(gitignorePath, missingEntries.join("\n") + "\n", "utf-8");
      log.info("Created .gitignore in config directory");
    } else {
      const suffix = content.endsWith("\n") ? "" : "\n";
      appendFileSync(
        gitignorePath,
        suffix + missingEntries.join("\n") + "\n",
        "utf-8",
      );
      log.info("Updated .gitignore with missing entries", {
        added: missingEntries,
      });
    }
  } catch {
    // Non-critical feature
  }
}

export type ModelFamily = "claude" | "gemini";
export type { HeaderStyle };

export interface RateLimitState {
  claude?: number;
  gemini?: number;
}

export interface RateLimitStateV3 {
  claude?: number;
  "gemini-antigravity"?: number;
  "gemini-cli"?: number;
  [key: string]: number | undefined;
}

export interface AccountMetadataV1 {
  email?: string;
  refreshToken: string;
  projectId?: string;
  managedProjectId?: string;
  addedAt: number;
  lastUsed: number;
  isRateLimited?: boolean;
  rateLimitResetTime?: number;
  lastSwitchReason?: "rate-limit" | "initial" | "rotation";
}

export interface AccountStorageV1 {
  version: 1;
  accounts: AccountMetadataV1[];
  activeIndex: number;
}

export interface AccountMetadata {
  email?: string;
  refreshToken: string;
  projectId?: string;
  managedProjectId?: string;
  addedAt: number;
  lastUsed: number;
  lastSwitchReason?: "rate-limit" | "initial" | "rotation";
  rateLimitResetTimes?: RateLimitState;
}

export interface AccountStorage {
  version: 2;
  accounts: AccountMetadata[];
  activeIndex: number;
}

export type CooldownReason = "auth-failure" | "network-error" | "project-error" | "validation-required";

export interface AccountMetadataV3 {
  /**
   * Durable opaque account id (e.g. a UUID) assigned by the account service.
   * Additive and optional for backward compatibility: legacy stores predate
   * it and are backfilled on service write paths. Never derived from token
   * material so it survives refresh-token rotation.
   */
  id?: string;
  email?: string;
  refreshToken: string;
  projectId?: string;
  managedProjectId?: string;
  addedAt: number;
  lastUsed: number;
  enabled?: boolean;
  lastSwitchReason?: "rate-limit" | "initial" | "rotation";
  rateLimitResetTimes?: RateLimitStateV3;
  coolingDownUntil?: number;
  cooldownReason?: CooldownReason;
  /** Per-account device fingerprint for rate limit mitigation */
  fingerprint?: import("./fingerprint").Fingerprint;
  fingerprintHistory?: import("./fingerprint").FingerprintVersion[];
  /** Set when Google asks the user to verify this account before requests can continue. */
  verificationRequired?: boolean;
  verificationRequiredAt?: number;
  verificationRequiredReason?: string;
  verificationUrl?: string;
  lastVerificationAt?: number;
  lastVerificationStatus?: "ok" | "blocked" | "error";
  /** Cached soft quota data */
  cachedQuota?: Record<string, { remainingFraction?: number; resetTime?: string; modelCount: number }>;
  cachedQuotaUpdatedAt?: number;
}

export interface AccountStorageV3 {
  version: 3;
  accounts: AccountMetadataV3[];
  activeIndex: number;
  activeIndexByFamily?: {
    claude?: number;
    gemini?: number;
  };
}

export interface AccountStorageV4 {
  version: 4;
  accounts: AccountMetadataV3[];
  activeIndex: number;
  activeIndexByFamily?: {
    claude?: number;
    gemini?: number;
  };
  /**
   * Tombstones for removed accounts. A removed account stays removed:
   * every load/persist path filters entries matching a tombstone, so a
   * stale in-memory manager or a merging background save cannot resurrect
   * a deleted account. Capped (see MAX_TOMBSTONES) to bound growth.
   */
  removedAccounts?: RemovedAccountTombstone[];
}

/**
 * Credential-free deletion record. Identity is a durable account id when
 * the account has one, plus a sha256 fingerprint of the refresh token and
 * a normalized email so pre-id accounts stay deleted too. Never carries
 * token material.
 */
export interface RemovedAccountTombstone {
  id?: string;
  tokenFingerprint?: string;
  email?: string;
  removedAt: number;
}

/** Maximum tombstones retained; oldest pruned first.
 * Bounded retention is intentional: protection covers the 50 most recent
 * deletions, realistic given the 10-account cap (it takes 50+ distinct
 * delete events before the oldest tombstone drops and that identity could
 * resurrect via a stale snapshot). Unbounded growth is rejected to keep the
 * accounts file small; no cheap strengthening exists because every dropped
 * tombstone can still reappear in a stale snapshot, so pruning only
 * "unreappearable" identities is not possible. */
export const MAX_TOMBSTONES = 50;

/** Deterministic credential-free identity for token matching. */
export function fingerprintRefreshToken(refreshToken: string): string {
  return createHash("sha256").update(refreshToken, "utf8").digest("hex");
}

function normalizeTombstoneEmail(email?: string): string | undefined {
  const normalized = email?.trim().toLowerCase();
  return normalized ? normalized : undefined;
}

/** Builds a tombstone for a removed account. */
export function tombstoneForAccount(
  account: { id?: string; refreshToken: string; email?: string },
  removedAt: number = Date.now(),
): RemovedAccountTombstone {
  const tombstone: RemovedAccountTombstone = { removedAt };
  if (account.id) {
    tombstone.id = account.id;
  }
  if (account.refreshToken) {
    tombstone.tokenFingerprint = fingerprintRefreshToken(account.refreshToken);
  }
  const email = normalizeTombstoneEmail(account.email);
  if (email) {
    tombstone.email = email;
  }
  return tombstone;
}

/**
 * True when the tombstone identifies this account for deletion filtering.
 *
 * Generation matching: equal durable ids plus one corroborating field (token
 * fingerprint or normalized email) always match, and equal token fingerprints
 * always match — a fingerprint identifies the credential itself, so it holds
 * across the pre-id upgrade path where a delete backfills an id the stale
 * snapshot lacks. Email alone only matches as a legacy fallback when both
 * sides lack an id and token material. In particular a re-added generation
 * (fresh id and fresh token under the same email) never matches the stale
 * deletion, so a stale save cannot poison it.
 */
export function tombstoneMatchesAccount(
  tombstone: RemovedAccountTombstone,
  account: { id?: string; refreshToken?: string; email?: string },
): boolean {
  const idMatch = !!tombstone.id && !!account.id && tombstone.id === account.id
  let fingerprintMatch = false
  if (tombstone.tokenFingerprint && account.refreshToken) {
    fingerprintMatch = tombstone.tokenFingerprint === fingerprintRefreshToken(account.refreshToken)
  }
  if (idMatch) {
    const tombstoneEmail = normalizeTombstoneEmail(tombstone.email)
    const accountEmail = normalizeTombstoneEmail(account.email)
    const emailMatch = !!tombstoneEmail && !!accountEmail && tombstoneEmail === accountEmail
    return fingerprintMatch || emailMatch
  }
  if (fingerprintMatch) {
    return true
  }
  if (!tombstone.id && !account.id && !tombstone.tokenFingerprint && !account.refreshToken) {
    const tombstoneEmail = normalizeTombstoneEmail(tombstone.email)
    const accountEmail = normalizeTombstoneEmail(account.email)
    return !!tombstoneEmail && !!accountEmail && tombstoneEmail === accountEmail
  }
  return false
}

/**
 * Loose any-field match for explicit re-add clearing (user intent).
 * A fresh OAuth login for a previously deleted identity clears its tombstone
 * through id, token, or email — unlike deletion filtering, which requires
 * strict generation corroboration.
 */
export function tombstoneMatchesReAdd(
  tombstone: RemovedAccountTombstone,
  identity: { id?: string; refreshToken?: string; email?: string },
): boolean {
  if (tombstone.id && identity.id && tombstone.id === identity.id) {
    return true
  }
  if (
    tombstone.tokenFingerprint &&
    identity.refreshToken &&
    tombstone.tokenFingerprint === fingerprintRefreshToken(identity.refreshToken)
  ) {
    return true
  }
  const email = normalizeTombstoneEmail(identity.email)
  if (tombstone.email && email && tombstone.email === email) {
    return true
  }
  return false
}

/** True when any tombstone identifies this account. */
export function isTombstoned(
  account: { id?: string; refreshToken?: string; email?: string },
  tombstones?: RemovedAccountTombstone[],
): boolean {
  if (!tombstones || tombstones.length === 0) {
    return false;
  }
  return tombstones.some((tombstone) => tombstoneMatchesAccount(tombstone, account));
}

/** Drops every account identified by a tombstone. */
export function filterTombstonedAccounts<T extends { id?: string; refreshToken?: string; email?: string }>(
  accounts: T[],
  tombstones?: RemovedAccountTombstone[],
): T[] {
  if (!tombstones || tombstones.length === 0) {
    return accounts;
  }
  return accounts.filter((account) => !isTombstoned(account, tombstones));
}

function isValidTombstone(value: unknown): value is RemovedAccountTombstone {
  if (!value || typeof value !== "object") {
    return false;
  }
  const entry = value as Record<string, unknown>;
  const hasIdentity =
    typeof entry.id === "string" ||
    typeof entry.tokenFingerprint === "string" ||
    typeof entry.email === "string";
  return hasIdentity && typeof entry.removedAt === "number" && Number.isFinite(entry.removedAt);
}

/** Drops malformed tombstone entries from untrusted disk data. */
export function sanitizeTombstones(value: unknown): RemovedAccountTombstone[] | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!Array.isArray(value)) {
    return undefined;
  }
  const valid = value.filter(isValidTombstone);
  return valid.length > 0 ? valid : undefined;
}

/**
 * Merges tombstone lists, deduplicating by id/token fingerprint and
 * pruning the oldest entries beyond MAX_TOMBSTONES. A duplicate refreshes
 * removedAt to the latest deletion time so delete/re-add/delete cycles
 * keep full protection instead of inheriting a stale timestamp.
 */
export function addTombstones(
  existing: RemovedAccountTombstone[] | undefined,
  entries: RemovedAccountTombstone[],
): RemovedAccountTombstone[] | undefined {
  const merged = (existing ?? []).map((tombstone) => ({ ...tombstone }));
  for (const entry of entries) {
    const duplicateIndex = merged.findIndex(
      (tombstone) =>
        (entry.id !== undefined && tombstone.id === entry.id) ||
        (entry.tokenFingerprint !== undefined && tombstone.tokenFingerprint === entry.tokenFingerprint),
    );
    if (duplicateIndex >= 0) {
      const current = merged[duplicateIndex];
      if (current !== undefined) {
        merged[duplicateIndex] = { ...current, removedAt: Math.max(current.removedAt, entry.removedAt) };
      }
    } else {
      merged.push({ ...entry });
    }
  }
  merged.sort((a, b) => a.removedAt - b.removedAt);
  const pruned = merged.length > MAX_TOMBSTONES ? merged.slice(merged.length - MAX_TOMBSTONES) : merged;
  return pruned.length > 0 ? pruned : undefined;
}

/**
 * Clears tombstones identifying a re-added account (fresh OAuth for the
 * same email or token), so the account can return after deletion.
 * Intentionally loose (any-field match): an explicit re-add is user intent,
 * unlike deletion filtering which requires strict generation corroboration.
 */
export function clearTombstonesForAccount(
  tombstones: RemovedAccountTombstone[] | undefined,
  identity: { id?: string; refreshToken?: string; email?: string },
): RemovedAccountTombstone[] | undefined {
  if (!tombstones || tombstones.length === 0) {
    return tombstones;
  }
  const hasIdentity =
    identity.id !== undefined ||
    identity.refreshToken !== undefined ||
    normalizeTombstoneEmail(identity.email) !== undefined;
  if (!hasIdentity) {
    return tombstones;
  }
  const kept = tombstones.filter((tombstone) => !tombstoneMatchesReAdd(tombstone, identity));
  return kept.length === tombstones.length ? tombstones : kept.length > 0 ? kept : undefined;
}

/**
 * Drops stale pending tombstones that no longer identify anything on disk.
 * A pending deletion only applies when a disk account still matches it under
 * strict generation rules (durable id with token/email corroboration, or an
 * identical token fingerprint); a re-added account with a fresh id and fresh
 * token is a new generation and is spared, even when the email is unchanged.
 * Call inside the updateAccounts lock with the freshly loaded disk membership.
 */
export function reconcilePendingTombstones(
  pending: RemovedAccountTombstone[],
  diskAccounts: { id?: string; refreshToken?: string; email?: string }[],
): RemovedAccountTombstone[] {
  return pending.filter((tombstone) =>
    diskAccounts.some((account) => tombstoneMatchesAccount(tombstone, account)),
  );
}

type AnyAccountStorage =
  | AccountStorageV1
  | AccountStorage
  | AccountStorageV3
  | AccountStorageV4;

/**
 * Gets the legacy Windows config directory (%APPDATA%\opencode).
 * Used for migration from older plugin versions.
 */
function getLegacyWindowsConfigDir(): string {
  return join(
    process.env.APPDATA || join(homedir(), "AppData", "Roaming"),
    "opencode",
  );
}

/**
 * Gets the config directory path, with the following precedence:
 * 1. OPENCODE_CONFIG_DIR env var (if set)
 * 2. ~/.config/opencode (all platforms, including Windows)
 *
 * On Windows, also checks for legacy %APPDATA%\opencode path for migration.
 */
function getConfigDir(): string {
  // 1. Check for explicit override via env var
  if (process.env.OPENCODE_CONFIG_DIR) {
    return process.env.OPENCODE_CONFIG_DIR;
  }

  // 2. Use ~/.config/opencode on all platforms (including Windows)
  const xdgConfig = process.env.XDG_CONFIG_HOME || join(homedir(), ".config");
  return join(xdgConfig, "opencode");
}

/**
 * Migrates config from legacy Windows location to the new path.
 * Moves the file if legacy exists and new doesn't.
 * Returns true if migration was performed.
 */
function migrateLegacyWindowsConfig(): boolean {
  if (process.platform !== "win32") {
    return false;
  }

  const newPath = join(getConfigDir(), "antigravity-accounts.json");
  const legacyPath = join(
    getLegacyWindowsConfigDir(),
    "antigravity-accounts.json",
  );

  // Only migrate if legacy exists and new doesn't
  if (!existsSync(legacyPath) || existsSync(newPath)) {
    return false;
  }

  try {
    // Ensure new config directory exists
    const newConfigDir = getConfigDir();

    mkdirSync(newConfigDir, { recursive: true });

    // Try rename first (atomic, but fails across filesystems)
    try {
      renameSync(legacyPath, newPath);
      log.info("Migrated Windows config via rename", { from: legacyPath, to: newPath });
    } catch {
      // Fallback: copy then delete (for cross-filesystem moves)
      copyFileSync(legacyPath, newPath);
      unlinkSync(legacyPath);
      log.info("Migrated Windows config via copy+delete", { from: legacyPath, to: newPath });
    }

    return true;
  } catch (error) {
    log.warn("Failed to migrate legacy Windows config, will use legacy path", {
      legacyPath,
      newPath,
      error: String(error),
    });
    return false;
  }
}

/**
 * Gets the storage path, migrating from legacy Windows location if needed.
 * On Windows, attempts to move legacy config to new path for alignment.
 */
function getStoragePathWithMigration(): string {
  const newPath = join(getConfigDir(), "antigravity-accounts.json");

  // On Windows, attempt to migrate legacy config to new location
  if (process.platform === "win32") {
    migrateLegacyWindowsConfig();

    // If migration failed and legacy still exists, fall back to it
    if (!existsSync(newPath)) {
      const legacyPath = join(
        getLegacyWindowsConfigDir(),
        "antigravity-accounts.json",
      );
      if (existsSync(legacyPath)) {
        log.info("Using legacy Windows config path (migration failed)", {
          legacyPath,
          newPath,
        });
        return legacyPath;
      }
    }
  }

  return newPath;
}

export function getStoragePath(): string {
  return getStoragePathWithMigration();
}

/**
 * Gets the config directory path. Exported for use by other modules.
 */
export { getConfigDir };

const LOCK_OPTIONS = {
  stale: 10000,
  retries: {
    retries: 5,
    minTimeout: 100,
    maxTimeout: 1000,
    factor: 2,
  },
};

/**
 * Ensures the file has secure permissions (0600) on POSIX systems.
 * This is a best-effort operation and ignores errors on Windows/unsupported FS.
 */
async function ensureSecurePermissions(path: string): Promise<void> {
  try {
    await fs.chmod(path, 0o600);
  } catch {
    // Ignore errors (e.g. Windows, file doesn't exist, FS doesn't support chmod)
  }
}

async function ensureFileExists(path: string): Promise<void> {
  try {
    await fs.access(path);
  } catch {
    await fs.mkdir(dirname(path), { recursive: true });
    await fs.writeFile(
      path,
      JSON.stringify({ version: 4, accounts: [], activeIndex: 0 }, null, 2),
      { encoding: "utf-8", mode: 0o600 },
    );
  }
}

async function withFileLock<T>(path: string, fn: () => Promise<T>): Promise<T> {
  await ensureFileExists(path);
  let release: (() => Promise<void>) | null = null;
  try {
    release = await lockfile.lock(path, LOCK_OPTIONS);
    return await fn();
  } finally {
    if (release) {
      try {
        await release();
      } catch (unlockError) {
        log.warn("Failed to release lock", { error: String(unlockError) });
      }
    }
  }
}

function mergeAccountStorage(
  existing: AccountStorageV4,
  incoming: AccountStorageV4,
): AccountStorageV4 {
  const accountMap = new Map<string, AccountMetadataV3>();

  for (const acc of existing.accounts) {
    if (acc.refreshToken) {
      accountMap.set(acc.refreshToken, acc);
    }
  }

  for (const acc of incoming.accounts) {
    if (acc.refreshToken) {
      const existingAcc = accountMap.get(acc.refreshToken);
      if (existingAcc) {
        accountMap.set(acc.refreshToken, {
          ...existingAcc,
          ...acc,
          // Preserve manually configured projectId/managedProjectId if not in incoming
          projectId: acc.projectId ?? existingAcc.projectId,
          managedProjectId: acc.managedProjectId ?? existingAcc.managedProjectId,
          rateLimitResetTimes: {
            ...existingAcc.rateLimitResetTimes,
            ...acc.rateLimitResetTimes,
          },
          lastUsed: Math.max(existingAcc.lastUsed || 0, acc.lastUsed || 0),
        });
      } else {
        accountMap.set(acc.refreshToken, acc);
      }
    }
  }

  // Merging must never resurrect a tombstoned (deleted) account.
  const tombstones = addTombstones(existing.removedAccounts, incoming.removedAccounts ?? []);

  return {
    version: 4,
    accounts: filterTombstonedAccounts(Array.from(accountMap.values()), tombstones),
    activeIndex: incoming.activeIndex,
    activeIndexByFamily: incoming.activeIndexByFamily,
    removedAccounts: tombstones,
  };
}

export function deduplicateAccountsByEmail<
  T extends { email?: string; lastUsed?: number; addedAt?: number },
>(accounts: T[]): T[] {
  const emailToNewestIndex = new Map<string, number>();
  const indicesToKeep = new Set<number>();

  // First pass: find the newest account for each email (by lastUsed, then addedAt)
  for (let i = 0; i < accounts.length; i++) {
    const acc = accounts[i];
    if (!acc) continue;

    if (!acc.email) {
      // No email - keep this account (can't deduplicate without email)
      indicesToKeep.add(i);
      continue;
    }

    const existingIndex = emailToNewestIndex.get(acc.email);
    if (existingIndex === undefined) {
      emailToNewestIndex.set(acc.email, i);
      continue;
    }

    // Compare to find which is newer
    const existing = accounts[existingIndex];
    if (!existing) {
      emailToNewestIndex.set(acc.email, i);
      continue;
    }

    // Prefer higher lastUsed, then higher addedAt
    // Compare fields separately to avoid integer overflow with large timestamps
    const currLastUsed = acc.lastUsed || 0;
    const existLastUsed = existing.lastUsed || 0;
    const currAddedAt = acc.addedAt || 0;
    const existAddedAt = existing.addedAt || 0;

    const isNewer =
      currLastUsed > existLastUsed ||
      (currLastUsed === existLastUsed && currAddedAt > existAddedAt);

    if (isNewer) {
      emailToNewestIndex.set(acc.email, i);
    }
  }

  // Add all the newest email-based indices to the keep set
  for (const idx of emailToNewestIndex.values()) {
    indicesToKeep.add(idx);
  }

  // Build the deduplicated list, preserving original order for kept items
  const result: T[] = [];
  for (let i = 0; i < accounts.length; i++) {
    if (indicesToKeep.has(i)) {
      const acc = accounts[i];
      if (acc) {
        result.push(acc);
      }
    }
  }

  return result;
}

function migrateV1ToV2(v1: AccountStorageV1): AccountStorage {
  return {
    version: 2,
    accounts: v1.accounts.map((acc) => {
      const rateLimitResetTimes: RateLimitState = {};
      if (
        acc.isRateLimited &&
        acc.rateLimitResetTime &&
        acc.rateLimitResetTime > Date.now()
      ) {
        rateLimitResetTimes.claude = acc.rateLimitResetTime;
        rateLimitResetTimes.gemini = acc.rateLimitResetTime;
      }
      return {
        email: acc.email,
        refreshToken: acc.refreshToken,
        projectId: acc.projectId,
        managedProjectId: acc.managedProjectId,
        addedAt: acc.addedAt,
        lastUsed: acc.lastUsed,
        lastSwitchReason: acc.lastSwitchReason,
        rateLimitResetTimes:
          Object.keys(rateLimitResetTimes).length > 0
            ? rateLimitResetTimes
            : undefined,
      };
    }),
    activeIndex: v1.activeIndex,
  };
}

export function migrateV2ToV3(v2: AccountStorage): AccountStorageV3 {
  return {
    version: 3,
    accounts: v2.accounts.map((acc) => {
      const rateLimitResetTimes: RateLimitStateV3 = {};
      if (
        acc.rateLimitResetTimes?.claude &&
        acc.rateLimitResetTimes.claude > Date.now()
      ) {
        rateLimitResetTimes.claude = acc.rateLimitResetTimes.claude;
      }
      if (
        acc.rateLimitResetTimes?.gemini &&
        acc.rateLimitResetTimes.gemini > Date.now()
      ) {
        rateLimitResetTimes["gemini-antigravity"] =
          acc.rateLimitResetTimes.gemini;
      }
      return {
        email: acc.email,
        refreshToken: acc.refreshToken,
        projectId: acc.projectId,
        managedProjectId: acc.managedProjectId,
        addedAt: acc.addedAt,
        lastUsed: acc.lastUsed,
        lastSwitchReason: acc.lastSwitchReason,
        rateLimitResetTimes:
          Object.keys(rateLimitResetTimes).length > 0
            ? rateLimitResetTimes
            : undefined,
      };
    }),
    activeIndex: v2.activeIndex,
  };
}

export function migrateV3ToV4(v3: AccountStorageV3): AccountStorageV4 {
  return {
    version: 4,
    accounts: v3.accounts.map((acc) => ({
      ...acc,
      fingerprint: undefined,
      fingerprintHistory: undefined,
    })),
    activeIndex: v3.activeIndex,
    activeIndexByFamily: v3.activeIndexByFamily,
    removedAccounts: sanitizeTombstones((v3 as unknown as { removedAccounts?: unknown }).removedAccounts),
  };
}

export async function loadAccounts(): Promise<AccountStorageV4 | null> {
  try {
    const path = getStoragePath();
    // Ensure permissions are correct on load (fixes existing files)
    await ensureSecurePermissions(path);

    const content = await fs.readFile(path, "utf-8");
    const data = JSON.parse(content) as AnyAccountStorage;

    if (!Array.isArray(data.accounts)) {
      log.warn("Invalid storage format, ignoring");
      return null;
    }

    let storage: AccountStorageV4;

    if (data.version === 1) {
      log.info("Migrating account storage from v1 to v4");
      const v2 = migrateV1ToV2(data);
      const v3 = migrateV2ToV3(v2);
      storage = migrateV3ToV4(v3);
      try {
        await saveAccounts(storage);
        log.info("Migration to v4 complete");
      } catch (saveError) {
        log.warn("Failed to persist migrated storage", {
          error: String(saveError),
        });
      }
    } else if (data.version === 2) {
      log.info("Migrating account storage from v2 to v4");
      const v3 = migrateV2ToV3(data);
      storage = migrateV3ToV4(v3);
      try {
        await saveAccounts(storage);
        log.info("Migration to v4 complete");
      } catch (saveError) {
        log.warn("Failed to persist migrated storage", {
          error: String(saveError),
        });
      }
    } else if (data.version === 3) {
      log.info("Migrating account storage from v3 to v4");
      storage = migrateV3ToV4(data);
      try {
        await saveAccounts(storage);
        log.info("Migration to v4 complete");
      } catch (saveError) {
        log.warn("Failed to persist migrated storage", {
          error: String(saveError),
        });
      }
    } else if (data.version === 4) {
      storage = data;
    } else {
      log.warn("Unknown storage version, ignoring", {
        version: (data as { version?: unknown }).version,
      });
      return null;
    }

    // Validate accounts have required fields
    const validAccounts = storage.accounts.filter(
      (a): a is AccountMetadataV3 => {
        return (
          !!a &&
          typeof a === "object" &&
          typeof (a as AccountMetadataV3).refreshToken === "string"
        );
      },
    );

    // Deduplicate accounts by email (keeps newest entry for each email)
    // Tombstoned (deleted) accounts are filtered first so a stale disk
    // entry can never reappear on load.
    const liveAccounts = filterTombstonedAccounts(validAccounts, storage.removedAccounts);
    const deduplicatedAccounts = deduplicateAccountsByEmail(liveAccounts);

    // Clamp activeIndex to valid range after deduplication
    let activeIndex =
      typeof storage.activeIndex === "number" &&
      Number.isFinite(storage.activeIndex)
        ? storage.activeIndex
        : 0;
    if (deduplicatedAccounts.length > 0) {
      activeIndex = Math.min(activeIndex, deduplicatedAccounts.length - 1);
      activeIndex = Math.max(activeIndex, 0);
    } else {
      activeIndex = 0;
    }

    return {
      version: 4,
      accounts: deduplicatedAccounts,
      activeIndex,
      activeIndexByFamily: storage.activeIndexByFamily,
      removedAccounts: storage.removedAccounts,
    };
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      return null;
    }
    log.error("Failed to load account storage", { error: String(error) });
    return null;
  }
}

export async function saveAccounts(storage: AccountStorageV4): Promise<void> {
  const path = getStoragePath();
  const configDir = dirname(path);
  await fs.mkdir(configDir, { recursive: true });
  await ensureGitignore(configDir);

  await withFileLock(path, async () => {
    const existing = await loadAccountsUnsafe();
    const merged = existing ? mergeAccountStorage(existing, storage) : storage;

    // Defensive: the merged result is already tombstone-filtered by
    // mergeAccountStorage, but filter again so a direct saveAccounts call
    // with a stale snapshot can never resurrect a deleted account.
    const tombstones = addTombstones(existing?.removedAccounts, merged.removedAccounts ?? []);
    const filtered: AccountStorageV4 = {
      ...merged,
      accounts: filterTombstonedAccounts(merged.accounts, tombstones),
      removedAccounts: tombstones,
    };

    const tempPath = `${path}.${randomBytes(6).toString("hex")}.tmp`;
    const content = JSON.stringify(filtered, null, 2);

    try {
      await fs.writeFile(tempPath, content, { encoding: "utf-8", mode: 0o600 });
      await fs.rename(tempPath, path);
    } catch (error) {
      // Clean up temp file on failure to prevent accumulation
      try {
        await fs.unlink(tempPath);
      } catch {
        // Ignore cleanup errors (file may not exist)
      }
      throw error;
    }
  });
}

/**
 * Save accounts storage by replacing the entire file (no merge).
 * Use this for destructive operations like delete where we need to
 * remove accounts that would otherwise be merged back from existing storage.
 */
export interface SaveAccountsReplaceOptions {
  /**
   * Skip merging current disk tombstones and write exactly the given store.
   * Only for intentional full clears; the default preserves disk tombstones
   * so a stale snapshot lacking removedAccounts can never resurrect a
   * deleted account.
   */
  clearTombstones?: boolean;
}

export async function saveAccountsReplace(
  storage: AccountStorageV4,
  options?: SaveAccountsReplaceOptions,
): Promise<void> {
  const path = getStoragePath();
  const configDir = dirname(path);
  await fs.mkdir(configDir, { recursive: true });
  await ensureGitignore(configDir);

  await withFileLock(path, async () => {
    const tempPath = `${path}.${randomBytes(6).toString("hex")}.tmp`;
    // Replace writes still honor tombstones: current disk tombstones are
    // merged in, so a stale snapshot passed here can never resurrect a
    // deleted account. Pass { clearTombstones: true } only for intentional
    // full clears.
    const existing = options?.clearTombstones ? undefined : await loadAccountsUnsafe();
    const tombstones = options?.clearTombstones
      ? sanitizeTombstones(storage.removedAccounts)
      : addTombstones(existing?.removedAccounts, storage.removedAccounts ?? []);
    const filtered: AccountStorageV4 = {
      ...storage,
      accounts: filterTombstonedAccounts(storage.accounts, tombstones),
      removedAccounts: tombstones,
    };
    const content = JSON.stringify(filtered, null, 2);

    try {
      await fs.writeFile(tempPath, content, { encoding: "utf-8", mode: 0o600 });
      await fs.rename(tempPath, path);
    } catch (error) {
      try {
        await fs.unlink(tempPath);
      } catch {
        // Ignore cleanup errors
      }
      throw error;
    }
  });
}

/**
 * Read-modify-write accounts inside a single file-lock acquisition.
 * The updater receives the current store and returns the replacement store
 * plus a result value. A throwing updater aborts without writing.
 * Unlike saveAccounts there is no merge: the returned store replaces the
 * file, so deletions cannot be resurrected by a concurrent stale read.
 */
export async function updateAccounts<T>(
  updater: (current: AccountStorageV4) => { storage: AccountStorageV4; result: T } | Promise<{ storage: AccountStorageV4; result: T }>,
): Promise<T> {
  const path = getStoragePath();
  const configDir = dirname(path);
  await fs.mkdir(configDir, { recursive: true });
  await ensureGitignore(configDir);

  return withFileLock(path, async () => {
    const loaded = await loadAccountsUnsafe();
    const current: AccountStorageV4 = loaded ?? { version: 4, accounts: [], activeIndex: 0 };
    const clamped = current.accounts.length > 0
      ? Math.min(Math.max(current.activeIndex, 0), current.accounts.length - 1)
      : 0;
    const normalized: AccountStorageV4 = {
      ...current,
      version: 4,
      activeIndex: clamped,
      // The locked read is already tombstone-filtered; normalize defensively
      // so a hand-built updater input can never leak a deleted account.
      accounts: filterTombstonedAccounts(current.accounts, current.removedAccounts),
      removedAccounts: sanitizeTombstones(current.removedAccounts),
    };

    const { storage, result } = await updater(normalized);

    // Updaters return the input reference unchanged to signal "no change":
    // skip the write so read-only transactions never bump the file mtime.
    if (storage === normalized) return result;

    // Tombstone ownership is explicit: updaters that spread the locked
    // input preserve its tombstones, while updaters building a fresh store
    // set removedAccounts themselves (delete tombstones, re-add clears).
    // The written accounts are always filtered so a stale snapshot that
    // forgot tombstones still cannot resurrect a deleted account that is
    // tombstoned in the written store.
    const tombstones = sanitizeTombstones(storage.removedAccounts);
    const filtered: AccountStorageV4 = {
      ...storage,
      version: 4,
      accounts: filterTombstonedAccounts(storage.accounts, tombstones),
      removedAccounts: tombstones,
    };

    const tempPath = `${path}.${randomBytes(6).toString("hex")}.tmp`;
    const content = JSON.stringify(filtered, null, 2);

    try {
      await fs.writeFile(tempPath, content, { encoding: "utf-8", mode: 0o600 });
      await fs.rename(tempPath, path);
    } catch (error) {
      try {
        await fs.unlink(tempPath);
      } catch {
        // Ignore cleanup errors
      }
      throw error;
    }
    return result;
  });
}

async function loadAccountsUnsafe(): Promise<AccountStorageV4 | null> {
  try {
    const path = getStoragePath();
    // Ensure permissions are correct on load (fixes existing files)
    await ensureSecurePermissions(path);

    const content = await fs.readFile(path, "utf-8");
    const parsed = JSON.parse(content);

    if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.accounts)) {
      return null;
    }

    const tombstones = sanitizeTombstones(parsed.removedAccounts);
    const withoutTombstoned = filterTombstonedAccounts(parsed.accounts, tombstones);

    if (parsed.version === 1) {
      const migrated = migrateV3ToV4(migrateV2ToV3(migrateV1ToV2(parsed)));
      return { ...migrated, accounts: filterTombstonedAccounts(migrated.accounts, tombstones), removedAccounts: tombstones };
    }
    if (parsed.version === 2) {
      const migrated = migrateV3ToV4(migrateV2ToV3(parsed));
      return { ...migrated, accounts: filterTombstonedAccounts(migrated.accounts, tombstones), removedAccounts: tombstones };
    }
    if (parsed.version === 3) {
      const migrated = migrateV3ToV4(parsed);
      return { ...migrated, accounts: filterTombstonedAccounts(migrated.accounts, tombstones), removedAccounts: tombstones };
    }

    return {
      ...parsed,
      accounts: deduplicateAccountsByEmail(withoutTombstoned),
      removedAccounts: tombstones,
    };
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      return null;
    }
    return null;
  }
}

export async function clearAccounts(): Promise<void> {
  try {
    const path = getStoragePath();
    await fs.unlink(path);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "ENOENT") {
      log.error("Failed to clear account storage", { error: String(error) });
    }
  }
}
