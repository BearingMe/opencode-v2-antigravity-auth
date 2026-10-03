import { homedir } from "node:os"
import { join } from "node:path"
import { PersistentCache } from "../../lib/cache/index.js"
import { ensureGitignoreSync } from "../storage"
import type { SignatureCacheConfig } from "../config"

/** Returns OpenCode's per-user configuration directory. */
function getConfigDir(): string {
  if (process.platform === "win32") {
    return join(process.env.APPDATA || join(homedir(), "AppData", "Roaming"), "opencode")
  }
  return join(process.env.XDG_CONFIG_HOME || join(homedir(), ".config"), "opencode")
}

/** Builds the plugin-owned path for its persistent thinking-signature cache. */
function getCacheFilePath(): string {
  return join(getConfigDir(), "antigravity-signature-cache.json")
}

/**
 * Adapts plugin cache settings and filesystem policy to the standalone cache.
 * The public methods are inherited to keep existing plugin callers unchanged.
 */
export class SignatureCache extends PersistentCache {
  /** Converts plugin settings to the standalone cache's millisecond options. */
  constructor(config: SignatureCacheConfig) {
    super({
      enabled: config.enabled,
      filePath: getCacheFilePath(),
      memoryTtlMs: config.memory_ttl_seconds * 1000,
      diskTtlMs: config.disk_ttl_seconds * 1000,
      writeIntervalMs: config.write_interval_seconds * 1000,
      prepareDirectory: ensureGitignoreSync,
    })
  }
}

/** Creates a signature cache when enabled, otherwise returns null. */
export function createSignatureCache(config: SignatureCacheConfig | undefined): SignatureCache | null {
  if (!config || !config.enabled) return null
  return new SignatureCache(config)
}
