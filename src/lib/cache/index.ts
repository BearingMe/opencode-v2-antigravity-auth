import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync, unlinkSync } from "node:fs"
import { dirname, join } from "node:path"
import { tmpdir } from "node:os"

interface CacheEntry {
  value: string
  timestamp: number
  [key: string]: unknown
}

interface CacheFile {
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

/** Options for a string cache that keeps a JSON snapshot on disk. */
export interface PersistentCacheOptions {
  /** Disables reads, writes, and background work when false. */
  enabled: boolean

  /** Destination for the versioned JSON snapshot. */
  filePath: string

  /** Maximum age of values while held in memory. */
  memoryTtlMs: number

  /** Maximum age of disk entries retained during load and merge. */
  diskTtlMs: number

  /** Interval between background saves, in milliseconds. */
  writeIntervalMs: number

  /** Optional host-specific setup run before each save. */
  prepareDirectory?: (directory: string) => void
}

/**
 * Stores string values in memory and periodically persists them to a JSON file.
 * The on-disk shape remains version 1.0 so existing cache files stay readable.
 */
export class PersistentCache {
  private readonly cache = new Map<string, CacheEntry>()
  private readonly options: PersistentCacheOptions
  private dirty = false
  private writeTimer: ReturnType<typeof setInterval> | null = null
  private cleanupTimer: ReturnType<typeof setInterval> | null = null
  private readonly stats = {
    memoryHits: 0,
    diskHits: 0,
    misses: 0,
    writes: 0,
  }

  /** Loads any existing snapshot and starts background tasks when enabled. */
  constructor(options: PersistentCacheOptions) {
    this.options = options

    if (this.options.enabled) {
      this.loadFromDisk()
      this.startBackgroundTasks()
    }
  }

  /** Adds or replaces a value and marks the in-memory snapshot dirty. */
  store(key: string, value: string): void {
    if (!this.options.enabled) return

    this.cache.set(key, { value, timestamp: Date.now() })
    this.dirty = true
  }

  /** Returns a non-expired value, or null when it is absent or expired. */
  retrieve(key: string): string | null {
    if (!this.options.enabled) return null

    const entry = this.cache.get(key)
    if (!entry) {
      this.stats.misses++
      return null
    }

    if (Date.now() - entry.timestamp <= this.options.memoryTtlMs) {
      this.stats.memoryHits++
      return entry.value
    }

    this.cache.delete(key)
    this.stats.misses++
    return null
  }

  /** Checks whether a non-expired value exists without changing cache statistics. */
  has(key: string): boolean {
    if (!this.options.enabled) return false

    const entry = this.cache.get(key)
    return Boolean(entry && Date.now() - entry.timestamp <= this.options.memoryTtlMs)
  }

  /** Writes the current cache state to disk and reports whether it succeeded. */
  async flush(): Promise<boolean> {
    if (!this.options.enabled) return true
    return this.saveToDisk()
  }

  /** Stops background timers and performs a final save. */
  async dispose(): Promise<boolean> {
    if (this.writeTimer) clearInterval(this.writeTimer)
    if (this.cleanupTimer) clearInterval(this.cleanupTimer)
    this.writeTimer = null
    this.cleanupTimer = null
    return this.flush()
  }

  /** Loads entries that are still within the configured disk TTL. */
  private loadFromDisk(): void {
    try {
      if (!existsSync(this.options.filePath)) return

      const cacheFile = JSON.parse(readFileSync(this.options.filePath, "utf-8")) as CacheFile
      if (cacheFile.version !== "1.0") return

      const now = Date.now()
      for (const [key, entry] of Object.entries(cacheFile.entries)) {
        if (now - entry.timestamp <= this.options.diskTtlMs) {
          this.cache.set(key, { value: entry.value, timestamp: entry.timestamp })
        }
      }
    } catch {
      // Cache data is optional; a missing or malformed file starts empty.
    }
  }

  /** Merges valid disk entries with memory entries, where memory wins conflicts. */
  private saveToDisk(): boolean {
    try {
      const directory = dirname(this.options.filePath)
      if (!existsSync(directory)) mkdirSync(directory, { recursive: true })
      this.options.prepareDirectory?.(directory)

      const now = Date.now()
      let existingEntries: Record<string, CacheEntry> = {}
      if (existsSync(this.options.filePath)) {
        try {
          const existing = JSON.parse(readFileSync(this.options.filePath, "utf-8")) as CacheFile
          existingEntries = existing.entries || {}
        } catch {
          // A corrupt previous snapshot is replaced by the entries still in memory.
        }
      }

      // Disk TTL may outlive memory TTL, so keep valid disk-only entries during a merge.
      const mergedEntries: Record<string, CacheEntry> = {}
      for (const [key, entry] of Object.entries(existingEntries)) {
        if (now - entry.timestamp <= this.options.diskTtlMs) {
          mergedEntries[key] = entry
        }
      }
      for (const [key, entry] of this.cache) {
        mergedEntries[key] = { value: entry.value, timestamp: entry.timestamp }
      }

      const cacheFile: CacheFile = {
        version: "1.0",
        memory_ttl_seconds: this.options.memoryTtlMs / 1000,
        disk_ttl_seconds: this.options.diskTtlMs / 1000,
        entries: mergedEntries,
        statistics: {
          memory_hits: this.stats.memoryHits,
          disk_hits: this.stats.diskHits,
          misses: this.stats.misses,
          writes: this.stats.writes + 1,
          last_write: now,
        },
      }

      const temporaryPath = join(tmpdir(), `persistent-cache-${Date.now()}-${Math.random().toString(36).slice(2)}.tmp`)
      writeFileSync(temporaryPath, JSON.stringify(cacheFile, null, 2), "utf-8")

      try {
        renameSync(temporaryPath, this.options.filePath)
      } catch {
        // The temporary directory may be on another volume, notably on Windows.
        writeFileSync(this.options.filePath, readFileSync(temporaryPath))
        try {
          unlinkSync(temporaryPath)
        } catch {
          // A leftover temporary file is harmless if cleanup is unavailable.
        }
      }

      this.stats.writes++
      this.dirty = false
      return true
    } catch {
      // Persistence is best-effort; callers can continue using the memory cache.
      return false
    }
  }

  /** Starts periodic persistence and memory-expiration cleanup. */
  private startBackgroundTasks(): void {
    this.writeTimer = setInterval(() => {
      if (this.dirty) this.saveToDisk()
    }, this.options.writeIntervalMs)

    this.cleanupTimer = setInterval(
      () => {
        this.cleanupExpired()
      },
      30 * 60 * 1000,
    )
  }

  /** Removes entries that have passed the shorter in-memory TTL. */
  private cleanupExpired(): void {
    const now = Date.now()
    for (const [key, entry] of this.cache) {
      if (now - entry.timestamp > this.options.memoryTtlMs) {
        this.cache.delete(key)
      }
    }
  }
}
