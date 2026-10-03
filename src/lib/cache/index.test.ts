import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { PersistentCache } from "./index"

let testDirectory = ""
const caches: PersistentCache[] = []

/** Creates a cache backed by a file inside the current test's temporary directory. */
function createTestCache(
  fileName = "cache.json",
  overrides: Partial<ConstructorParameters<typeof PersistentCache>[0]> = {},
) {
  const cache = new PersistentCache({
    enabled: true,
    filePath: join(testDirectory, fileName),
    memoryTtlMs: 1000,
    diskTtlMs: 5000,
    writeIntervalMs: 60_000,
    ...overrides,
  })
  caches.push(cache)
  return cache
}

describe("PersistentCache", () => {
  beforeEach(() => {
    testDirectory = mkdtempSync(join(tmpdir(), "opencode-cache-test-"))
  })

  afterEach(async () => {
    await Promise.all(caches.splice(0).map((cache) => cache.dispose()))
    rmSync(testDirectory, { recursive: true, force: true })
    vi.useRealTimers()
  })

  it("expires memory values at the configured TTL boundary", () => {
    vi.useFakeTimers()
    vi.setSystemTime(0)

    const cache = createTestCache()
    cache.store("key", "value")

    expect(cache.has("key")).toBe(true)
    vi.setSystemTime(1000)
    expect(cache.retrieve("key")).toBe("value")
    vi.setSystemTime(1001)
    expect(cache.has("key")).toBe(false)
    expect(cache.retrieve("key")).toBeNull()
  })

  it("merges entries written after load and lets memory win conflicts", async () => {
    vi.useFakeTimers()
    vi.setSystemTime(10_000)

    const filePath = join(testDirectory, "cache.json")
    mkdirSync(testDirectory, { recursive: true })
    writeFileSync(
      filePath,
      JSON.stringify({
        version: "1.0",
        memory_ttl_seconds: 1,
        disk_ttl_seconds: 5,
        entries: {
          conflict: { value: "disk value", timestamp: 10_000 },
          diskOnly: { value: "keep", timestamp: 10_000 },
          expired: { value: "drop", timestamp: 4_999 },
        },
        statistics: { memory_hits: 0, disk_hits: 0, misses: 0, writes: 0, last_write: 0 },
      }),
    )

    const cache = createTestCache()
    cache.store("conflict", "memory value")
    writeFileSync(
      filePath,
      JSON.stringify({
        version: "1.0",
        memory_ttl_seconds: 1,
        disk_ttl_seconds: 5,
        entries: {
          writtenElsewhere: { value: "keep", timestamp: 10_000 },
          expired: { value: "drop", timestamp: 4_999 },
        },
        statistics: { memory_hits: 0, disk_hits: 0, misses: 0, writes: 0, last_write: 0 },
      }),
    )
    expect(await cache.flush()).toBe(true)

    const saved = JSON.parse(readFileSync(filePath, "utf-8")) as {
      entries: Record<string, { value: string }>
    }
    expect(saved.entries).toEqual({
      conflict: { value: "memory value", timestamp: 10_000 },
      diskOnly: { value: "keep", timestamp: 10_000 },
      writtenElsewhere: { value: "keep", timestamp: 10_000 },
    })

    const reopened = createTestCache()
    expect(reopened.retrieve("conflict")).toBe("memory value")
    expect(reopened.retrieve("diskOnly")).toBe("keep")
    expect(reopened.retrieve("writtenElsewhere")).toBe("keep")
    expect(reopened.retrieve("expired")).toBeNull()
  })

  it("starts empty for corrupt files and reports failed persistence without throwing", async () => {
    const filePath = join(testDirectory, "cache.json")
    writeFileSync(filePath, "not json")

    const cache = createTestCache("cache.json", {
      prepareDirectory: () => {
        throw new Error("directory setup failed")
      },
    })
    expect(cache.retrieve("missing")).toBeNull()
    cache.store("key", "value")

    await expect(cache.flush()).resolves.toBe(false)
  })

  it("persists on schedule and clears its timers when disposed", async () => {
    vi.useFakeTimers()
    const cache = createTestCache("scheduled.json", { writeIntervalMs: 100 })
    cache.store("key", "value")

    await vi.advanceTimersByTimeAsync(100)

    const filePath = join(testDirectory, "scheduled.json")
    expect(JSON.parse(readFileSync(filePath, "utf-8")).entries.key.value).toBe("value")
    expect(await cache.dispose()).toBe(true)
    expect(vi.getTimerCount()).toBe(0)
  })

  it("keeps disabled caches inert", async () => {
    const cache = createTestCache("disabled.json", { enabled: false })
    cache.store("key", "value")

    expect(cache.has("key")).toBe(false)
    expect(cache.retrieve("key")).toBeNull()
    expect(await cache.flush()).toBe(true)
    expect(existsSync(join(testDirectory, "disabled.json"))).toBe(false)
  })
})
