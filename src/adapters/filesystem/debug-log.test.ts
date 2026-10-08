import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"
import { createDebugFileDestination } from "./debug-log"

const temporaryDirectories: string[] = []

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllEnvs()
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

/** Creates an isolated filesystem root for debug destination tests. */
function createTemporaryRoot(): string {
  const directory = mkdtempSync(join(tmpdir(), "antigravity-debug-log-"))
  temporaryDirectories.push(directory)
  if (process.platform === "win32") {
    vi.stubEnv("APPDATA", directory)
  } else {
    vi.stubEnv("XDG_CONFIG_HOME", directory)
  }
  mkdirSync(join(directory, "opencode"), { recursive: true })
  return directory
}

describe("debug file destination", () => {
  it("writes timestamped lines and keeps the config ignore entries current", async () => {
    const root = createTemporaryRoot()
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2025-01-02T03:04:05.000Z"))
    const ignoreUpdates: unknown[] = []
    const destination = createDebugFileDestination(true, undefined, (outcome) => ignoreUpdates.push(outcome))

    expect(destination.filePath).toContain("antigravity-debug-2025-01-02T03-04-05-000Z.log")
    destination.writeLine("request complete")
    await destination.close()
    expect(readFileSync(destination.filePath!, "utf8")).toContain("[2025-01-02T03:04:05.000Z] request complete")

    const ignoreFile = readFileSync(join(root, "opencode", ".gitignore"), "utf8")
    expect(ignoreFile).toContain("antigravity-accounts.json")
    expect(ignoreFile).toContain("antigravity-logs/")
    expect(ignoreUpdates).toEqual([{ status: "created" }])
  })

  it("restricts debug-log permissions on POSIX, including an existing file", async () => {
    if (process.platform === "win32") return

    const root = createTemporaryRoot()
    const logsDir = join(root, "private-logs")
    mkdirSync(logsDir)
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2025-01-02T03:04:05.000Z"))
    const existingLog = join(logsDir, "antigravity-debug-2025-01-02T03-04-05-000Z.log")
    writeFileSync(existingLog, "previous debug data", { mode: 0o644 })
    chmodSync(existingLog, 0o644)

    const destination = createDebugFileDestination(true, logsDir)
    destination.writeLine("private debug data")
    await destination.close()

    expect(statSync(existingLog).mode & 0o777).toBe(0o600)
  })

  it("removes only logs older than the newest 25 and degrades when writes fail", async () => {
    const root = createTemporaryRoot()
    const logsDir = join(root, "custom-logs")
    mkdirSync(logsDir, { recursive: true })
    const historicalLogs = Array.from({ length: 26 }, (_, index) => {
      const filePath = join(logsDir, `antigravity-debug-old-${index}.log`)
      writeFileSync(filePath, "old")
      const mtime = new Date(index * 1_000)
      utimesSync(filePath, mtime, mtime)
      return filePath
    })

    const destination = createDebugFileDestination(true, logsDir)
    expect(existsSync(historicalLogs[0]!)).toBe(false)
    expect(historicalLogs.slice(1).every(existsSync)).toBe(true)
    destination.writeLine("custom directory")
    await destination.close()
    expect(readFileSync(destination.filePath!, "utf8")).toContain("custom directory")

    const blockedParent = join(root, "not-a-directory")
    writeFileSync(blockedParent, "file")
    const failedDestination = createDebugFileDestination(true, blockedParent)
    expect(() => failedDestination.writeLine("best effort")).not.toThrow()
    await failedDestination.close()
  })

  it("has no path and no-op writes when file logging is disabled", async () => {
    createTemporaryRoot()
    const destination = createDebugFileDestination(false)

    expect(destination.filePath).toBeUndefined()
    expect(() => destination.writeLine("not written")).not.toThrow()
    await destination.close()
  })
})
