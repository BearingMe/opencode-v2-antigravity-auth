import { createHash } from "node:crypto"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it, vi } from "vitest"
import { createSignatureCachePersistence } from "./signature-cache-store.js"

describe("filesystem signature-cache compatibility", () => {
  it("reads a version-1 cache entry using the previous SHA-256 key format", async () => {
    const temporaryRoot = mkdtempSync(join(tmpdir(), "antigravity-signature-cache-test-"))
    const appData = join(temporaryRoot, "appdata")
    const xdgConfig = join(temporaryRoot, "xdg")
    vi.stubEnv("APPDATA", appData)
    vi.stubEnv("XDG_CONFIG_HOME", xdgConfig)
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"))

    let persistence: ReturnType<typeof createSignatureCachePersistence> = null

    try {
      const configDirectory = process.platform === "win32" ? join(appData, "opencode") : join(xdgConfig, "opencode")
      mkdirSync(configDirectory, { recursive: true })

      const text = "legacy thinking text"
      const textHash = createHash("sha256").update(text, "utf8").digest("hex").slice(0, 16)
      const key = `legacy-scope:${textHash}`
      writeFileSync(
        join(configDirectory, "antigravity-signature-cache.json"),
        JSON.stringify({
          version: "1.0",
          memory_ttl_seconds: 3600,
          disk_ttl_seconds: 172800,
          entries: { [key]: { value: "provider-signature", timestamp: Date.now() } },
        }),
      )

      persistence = createSignatureCachePersistence({
        enabled: true,
        memory_ttl_seconds: 3600,
        disk_ttl_seconds: 172800,
        write_interval_seconds: 60,
      })

      expect(persistence).not.toBeNull()
      expect(persistence!.get("legacy-scope", text)).toBe("provider-signature")
    } finally {
      await persistence?.dispose()
      vi.useRealTimers()
      vi.unstubAllEnvs()
      rmSync(temporaryRoot, { recursive: true, force: true })
    }
  })
})
