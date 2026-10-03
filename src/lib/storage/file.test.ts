import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type * as NodeFs from "node:fs"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { replaceFile, replaceFileSync } from "./file"

const { failNextRename } = vi.hoisted(() => ({
  failNextRename: { value: false },
}))

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof NodeFs>()
  return {
    ...actual,
    promises: {
      ...actual.promises,
      rename: (...args: Parameters<typeof actual.promises.rename>) => {
        if (failNextRename.value) {
          failNextRename.value = false
          return Promise.reject(new Error("rename failed"))
        }
        return actual.promises.rename(...args)
      },
    },
    renameSync: (...args: Parameters<typeof actual.renameSync>) => {
      if (failNextRename.value) {
        failNextRename.value = false
        throw new Error("rename failed")
      }
      return actual.renameSync(...args)
    },
  }
})

let testDirectory = ""

describe("file replacement", () => {
  beforeEach(() => {
    testDirectory = mkdtempSync(join(tmpdir(), "storage-file-test-"))
    failNextRename.value = false
  })

  afterEach(() => {
    rmSync(testDirectory, { recursive: true, force: true })
  })

  it("replaces a file asynchronously and removes the temporary file", async () => {
    const filePath = join(testDirectory, "data.json")
    writeFileSync(filePath, "before")

    await replaceFile(filePath, "after", { mode: 0o600 })

    expect(readFileSync(filePath, "utf-8")).toBe("after")
    expect(readdirSync(testDirectory)).toEqual(["data.json"])
  })

  it("preserves the destination and removes the temporary file when async replacement fails", async () => {
    const filePath = join(testDirectory, "data.json")
    writeFileSync(filePath, "before")
    failNextRename.value = true

    await expect(replaceFile(filePath, "after")).rejects.toThrow("rename failed")
    expect(readFileSync(filePath, "utf-8")).toBe("before")
    expect(readdirSync(testDirectory)).toEqual(["data.json"])
  })

  it("uses the non-atomic copy fallback when synchronous rename fails", () => {
    const filePath = join(testDirectory, "data.json")
    writeFileSync(filePath, "before")
    failNextRename.value = true

    replaceFileSync(filePath, "after", {
      temporaryDirectory: testDirectory,
      copyFallback: true,
    })

    expect(readFileSync(filePath, "utf-8")).toBe("after")
    expect(readdirSync(testDirectory)).toEqual(["data.json"])
  })

  it("applies the requested mode when fallback creates a new destination", () => {
    const filePath = join(testDirectory, "new-data.json")
    failNextRename.value = true

    replaceFileSync(filePath, "after", {
      temporaryDirectory: testDirectory,
      copyFallback: true,
      mode: 0o600,
    })

    expect(readFileSync(filePath, "utf-8")).toBe("after")
    if (process.platform !== "win32") {
      expect(statSync(filePath).mode & 0o777).toBe(0o600)
    }
  })

  it("preserves the original synchronous rename error when fallback is disabled", () => {
    const filePath = join(testDirectory, "data.json")
    writeFileSync(filePath, "before")
    failNextRename.value = true

    expect(() => replaceFileSync(filePath, "after")).toThrow("rename failed")
    expect(readFileSync(filePath, "utf-8")).toBe("before")
    expect(readdirSync(testDirectory)).toEqual(["data.json"])
  })
})
