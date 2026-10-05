import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync, unlinkSync } from "node:fs"
import { createHash } from "node:crypto"
import { join, dirname } from "node:path"
import { homedir } from "node:os"
import { tmpdir } from "node:os"
import { ensureGitignoreSync } from "./account-store.js"

/** Configuration for the optional on-disk signature cache. */
export interface SignatureCacheConfig {
  enabled: boolean
  memory_ttl_seconds: number
  disk_ttl_seconds: number
  write_interval_seconds: number
}

/** Persistence operations used by the inference-owned in-memory cache. */
export interface SignatureCachePersistence {
  cache: SignatureCache
  get(sessionId: string, text: string): string | undefined
  set(sessionId: string, text: string, signature: string): void
  dispose(): Promise<boolean>
}

// =============================================================================
// Types
// =============================================================================

interface CacheEntry {
  value: string
  timestamp: number

  thinkingText?: string

  textPreview?: string

  toolIds?: string[]
}

interface CacheData {
  version: "1.0"
  memory_ttl_seconds: number
  disk_ttl_seconds: number
  entries: Record<string, CacheEntry>
  statistics: {
    memory_hits: number
    disk_hits: number
    misses: number
    writes: number
    last_write: number
  }
}

// =============================================================================
// Path Utilities
// =============================================================================

/** Resolves the user configuration directory for the persisted cache. */
function getConfigDir(): string {
  const platform = process.platform
  if (platform === "win32") {
    return join(process.env.APPDATA || join(homedir(), "AppData", "Roaming"), "opencode")
  }
  const xdgConfig = process.env.XDG_CONFIG_HOME || join(homedir(), ".config")
  return join(xdgConfig, "opencode")
}

/** Returns the signature-cache file path inside OpenCode's config directory. */
function getCacheFilePath(): string {
  return join(getConfigDir(), "antigravity-signature-cache.json")
}

// =============================================================================
// Signature Cache Class
// =============================================================================

/** Optional version-1 disk cache for thinking signatures. */
export class SignatureCache {
  // In-memory cache: key -> entry with signature and optional thinking text
  private cache: Map<string, CacheEntry> = new Map()

  // Configuration
  private memoryTtlMs: number
  private diskTtlMs: number
  private writeIntervalMs: number
  private cacheFilePath: string
  private enabled: boolean

  // State
  private dirty: boolean = false
  private writeTimer: ReturnType<typeof setInterval> | null = null
  private cleanupTimer: ReturnType<typeof setInterval> | null = null

  // Statistics
  private stats = {
    memoryHits: 0,
    diskHits: 0,
    misses: 0,
    writes: 0,
  }

  /** Creates the disk cache and starts its persistence/cleanup timers when enabled. */
  constructor(config: SignatureCacheConfig) {
    this.enabled = config.enabled
    this.memoryTtlMs = config.memory_ttl_seconds * 1000
    this.diskTtlMs = config.disk_ttl_seconds * 1000
    this.writeIntervalMs = config.write_interval_seconds * 1000
    this.cacheFilePath = getCacheFilePath()

    if (this.enabled) {
      this.loadFromDisk()
      this.startBackgroundTasks()
    }
  }

  // ===========================================================================
  // Public API
  // ===========================================================================

  /**
   * Store a signature in the cache.
   */
  store(key: string, signature: string): void {
    if (!this.enabled) return

    this.cache.set(key, {
      value: signature,
      timestamp: Date.now(),
    })
    this.dirty = true
  }

  /**
   * Retrieve a signature from the cache.
   * Returns null if not found or expired.
   */
  retrieve(key: string): string | null {
    if (!this.enabled) return null

    const entry = this.cache.get(key)
    if (entry) {
      const age = Date.now() - entry.timestamp
      if (age <= this.memoryTtlMs) {
        this.stats.memoryHits++
        return entry.value
      }
      // Expired from memory, remove it
      this.cache.delete(key)
    }

    this.stats.misses++
    return null
  }

  /**
   * Check if a key exists in the cache (without updating stats).
   */
  has(key: string): boolean {
    if (!this.enabled) return false

    const entry = this.cache.get(key)
    if (!entry) return false

    const age = Date.now() - entry.timestamp
    return age <= this.memoryTtlMs
  }

  /**
   * Manually trigger a disk save.
   */
  async flush(): Promise<boolean> {
    if (!this.enabled) return true
    return this.saveToDisk()
  }

  /** Stops background timers and flushes pending entries before shutdown. */
  async dispose(): Promise<boolean> {
    if (this.writeTimer) clearInterval(this.writeTimer)
    if (this.cleanupTimer) clearInterval(this.cleanupTimer)
    this.writeTimer = null
    this.cleanupTimer = null
    return this.flush()
  }

  // ===========================================================================
  // Disk Operations
  // ===========================================================================

  /**
   * Load cache from disk file with TTL validation.
   */
  private loadFromDisk(): void {
    try {
      if (!existsSync(this.cacheFilePath)) {
        return
      }

      const content = readFileSync(this.cacheFilePath, "utf-8")
      const data = JSON.parse(content) as CacheData

      if (data.version !== "1.0") {
        // Version mismatch - silently start fresh
        return
      }

      const now = Date.now()
      let loaded = 0
      let expired = 0

      for (const [key, entry] of Object.entries(data.entries)) {
        const age = now - entry.timestamp
        if (age <= this.diskTtlMs) {
          this.cache.set(key, {
            value: entry.value,
            timestamp: entry.timestamp,
          })
          loaded++
        } else {
          expired++
        }
      }

      // Silently load - no console output
    } catch {
      // Silently start fresh on any error (corruption, file not found, etc.)
    }
  }

  /**
   * Save cache to disk with atomic write pattern.
   * Merges with existing disk entries that haven't expired.
   */
  private saveToDisk(): boolean {
    try {
      // Ensure directory exists
      const dir = dirname(this.cacheFilePath)
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true })
      }

      ensureGitignoreSync(dir)

      const now = Date.now()

      // Step 1: Load existing disk entries (if any)
      let existingEntries: Record<string, CacheEntry> = {}
      if (existsSync(this.cacheFilePath)) {
        try {
          const content = readFileSync(this.cacheFilePath, "utf-8")
          const data = JSON.parse(content) as CacheData
          existingEntries = data.entries || {}
        } catch {
          // Start fresh if corrupted
        }
      }

      // Step 2: Filter existing disk entries by disk_ttl
      const validDiskEntries: Record<string, CacheEntry> = {}
      for (const [key, entry] of Object.entries(existingEntries)) {
        const age = now - entry.timestamp
        if (age <= this.diskTtlMs) {
          validDiskEntries[key] = entry
        }
      }

      // Step 3: Merge - memory entries take precedence
      const mergedEntries: Record<string, CacheEntry> = { ...validDiskEntries }
      for (const [key, entry] of this.cache.entries()) {
        mergedEntries[key] = {
          value: entry.value,
          timestamp: entry.timestamp,
        }
      }

      // Step 4: Build cache data
      const cacheData: CacheData = {
        version: "1.0",
        memory_ttl_seconds: this.memoryTtlMs / 1000,
        disk_ttl_seconds: this.diskTtlMs / 1000,
        entries: mergedEntries,
        statistics: {
          memory_hits: this.stats.memoryHits,
          disk_hits: this.stats.diskHits,
          misses: this.stats.misses,
          writes: this.stats.writes + 1,
          last_write: now,
        },
      }

      // Step 5: Atomic write (temp file + rename)
      const tmpPath = join(tmpdir(), `antigravity-cache-${Date.now()}-${Math.random().toString(36).slice(2)}.tmp`)
      writeFileSync(tmpPath, JSON.stringify(cacheData, null, 2), "utf-8")

      try {
        renameSync(tmpPath, this.cacheFilePath)
      } catch {
        // On Windows, rename across volumes may fail
        // Fall back to copy + delete
        writeFileSync(this.cacheFilePath, readFileSync(tmpPath))
        try {
          unlinkSync(tmpPath)
        } catch {
          // Ignore cleanup errors
        }
      }

      this.stats.writes++
      this.dirty = false
      return true
    } catch {
      // Silently fail - disk cache is optional
      return false
    }
  }

  // ===========================================================================
  // Background Tasks
  // ===========================================================================

  /**
   * Start background write and cleanup timers.
   */
  private startBackgroundTasks(): void {
    // Periodic disk writes
    this.writeTimer = setInterval(() => {
      if (this.dirty) {
        this.saveToDisk()
      }
    }, this.writeIntervalMs)

    // Periodic memory cleanup (every 30 minutes)
    this.cleanupTimer = setInterval(
      () => {
        this.cleanupExpired()
      },
      30 * 60 * 1000,
    )
  }

  /**
   * Remove expired entries from memory.
   */
  private cleanupExpired(): void {
    const now = Date.now()
    let cleaned = 0

    for (const [key, entry] of this.cache.entries()) {
      const age = now - entry.timestamp
      if (age > this.memoryTtlMs) {
        this.cache.delete(key)
        cleaned++
      }
    }

    // Silently clean - no console output
  }
}

// =============================================================================
// Factory Function
// =============================================================================

/**
 * Create a signature cache with the given configuration.
 * Returns null if caching is disabled.
 */
export function createSignatureCache(config: SignatureCacheConfig | undefined): SignatureCache | null {
  if (!config || !config.enabled) {
    return null
  }

  return new SignatureCache(config)
}

/** Hashes signature text using the cache's stable, truncated SHA-256 key format. */
export function hashSignatureText(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex").slice(0, 16)
}

/** Builds the version-compatible on-disk key for a signature and its text. */
function signatureDiskKey(sessionId: string, text: string): string {
  return `${sessionId}:${hashSignatureText(text)}`
}

/** Adapts the generic disk cache to inference's session/text persistence contract. */
export function createSignatureCachePersistence(
  config: SignatureCacheConfig | undefined,
): SignatureCachePersistence | null {
  const cache = createSignatureCache(config)
  if (!cache) return null

  return {
    cache,
    get: (sessionId, text) => cache.retrieve(signatureDiskKey(sessionId, text)) ?? undefined,
    set: (sessionId, text, signature) => cache.store(signatureDiskKey(sessionId, text), signature),
    dispose: () => cache.dispose(),
  }
}
