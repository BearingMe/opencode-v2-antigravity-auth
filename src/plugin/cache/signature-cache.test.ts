import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"
import { createSignatureCache } from "./signature-cache"

describe("signature cache adapter", () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it("returns null when disabled", () => {
    expect(
      createSignatureCache({
        enabled: false,
        memory_ttl_seconds: 60,
        disk_ttl_seconds: 3600,
        write_interval_seconds: 10,
      }),
    ).toBeNull()
  })

  it("maps plugin paths and settings to the standalone cache", async () => {
    const configDirectory = mkdtempSync(join(tmpdir(), "signature-cache-test-"))
    const envName = process.platform === "win32" ? "APPDATA" : "XDG_CONFIG_HOME"
    vi.stubEnv(envName, configDirectory)

    const cache = createSignatureCache({
      enabled: true,
      memory_ttl_seconds: 60,
      disk_ttl_seconds: 3600,
      write_interval_seconds: 10,
    })

    try {
      expect(cache).not.toBeNull()
      cache?.store("signature", "cached-value")
      await expect(cache?.flush()).resolves.toBe(true)

      const cacheFile = join(configDirectory, "opencode", "antigravity-signature-cache.json")
      expect(existsSync(cacheFile)).toBe(true)
      expect(JSON.parse(readFileSync(cacheFile, "utf-8")).memory_ttl_seconds).toBe(60)
      expect(readFileSync(join(configDirectory, "opencode", ".gitignore"), "utf-8")).toContain(
        "antigravity-signature-cache.json",
      )
    } finally {
      await cache?.dispose()
      rmSync(configDirectory, { recursive: true, force: true })
    }
  })
})
