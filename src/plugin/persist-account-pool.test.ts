/**
 * Storage and recovery tests for account persistence (loadAccounts / saveAccounts).
 *
 * Covers Issue #89 failure modes (missing files, malformed JSON, schema migrations,
 * and save error safety) against storage.ts.
 */

import { promises as fs } from "node:fs"
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest"
import * as storageModule from "./storage"
import type { AccountStorageV4, AccountMetadataV3 } from "./storage"

vi.mock("proper-lockfile", () => ({
  default: {
    lock: vi.fn().mockResolvedValue(vi.fn().mockResolvedValue(undefined)),
  },
}))

vi.mock("node:fs", async () => {
  const actual = await vi.importActual<typeof import("node:fs")>("node:fs")
  return {
    ...actual,
    promises: {
      readFile: vi.fn(),
      writeFile: vi.fn(),
      mkdir: vi.fn().mockResolvedValue(undefined),
      access: vi.fn().mockResolvedValue(undefined),
      unlink: vi.fn(),
      rename: vi.fn().mockResolvedValue(undefined),
    },
  }
})

/**
 * Creates a standard mock account for storage tests.
 */
function createMockAccount(overrides: Partial<AccountMetadataV3> = {}): AccountMetadataV3 {
  return {
    email: "test@example.com",
    refreshToken: "test-refresh-token",
    projectId: "test-project-id",
    managedProjectId: "test-managed-project-id",
    addedAt: Date.now() - 10000,
    lastUsed: Date.now(),
    ...overrides,
  }
}

/**
 * Creates a version 4 account storage object with the given accounts.
 */
function createMockStorage(accounts: AccountMetadataV3[], activeIndex = 0): AccountStorageV4 {
  return {
    version: 4,
    accounts,
    activeIndex,
  }
}

describe("loadAccounts", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe("file not found (ENOENT)", () => {
    it("returns null when file does not exist", async () => {
      const error = new Error("ENOENT") as NodeJS.ErrnoException
      error.code = "ENOENT"
      vi.mocked(fs.readFile).mockRejectedValue(error)

      const result = await storageModule.loadAccounts()

      expect(result).toBeNull()
    })
  })

  describe("file exists with valid data", () => {
    it("returns storage for valid V3 file", async () => {
      const mockStorage = createMockStorage([createMockAccount()])
      vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify(mockStorage))

      const result = await storageModule.loadAccounts()

      expect(result).not.toBeNull()
      expect(result?.version).toBe(4)
      expect(result?.accounts).toHaveLength(1)
    })

    it("returns storage with multiple accounts", async () => {
      const mockStorage = createMockStorage([
        createMockAccount({ email: "user1@example.com", refreshToken: "token1" }),
        createMockAccount({ email: "user2@example.com", refreshToken: "token2" }),
      ])
      vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify(mockStorage))

      const result = await storageModule.loadAccounts()

      expect(result?.accounts).toHaveLength(2)
      expect(result?.accounts[0]?.email).toBe("user1@example.com")
      expect(result?.accounts[1]?.email).toBe("user2@example.com")
    })

    it("preserves activeIndex from storage", async () => {
      const mockStorage = createMockStorage(
        [createMockAccount({ email: "user1@example.com" }), createMockAccount({ email: "user2@example.com" })],
        1,
      )
      vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify(mockStorage))

      const result = await storageModule.loadAccounts()

      expect(result?.activeIndex).toBe(1)
    })
  })

  describe("error handling - THE BUG (Issue #89)", () => {
    it("returns null on permission denied (EACCES)", async () => {
      const error = new Error("EACCES") as NodeJS.ErrnoException
      error.code = "EACCES"
      vi.mocked(fs.readFile).mockRejectedValue(error)

      const result = await storageModule.loadAccounts()

      expect(result).toBeNull()
    })

    it("returns null on JSON parse error", async () => {
      vi.mocked(fs.readFile).mockResolvedValue("{ invalid json }}}")

      const result = await storageModule.loadAccounts()

      expect(result).toBeNull()
    })

    it("returns null on invalid storage format", async () => {
      vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify({ version: 4, notAccounts: [] }))

      const result = await storageModule.loadAccounts()

      expect(result).toBeNull()
    })

    it("returns null on unknown version", async () => {
      vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify({ version: 999, accounts: [] }))

      const result = await storageModule.loadAccounts()

      expect(result).toBeNull()
    })
  })

  describe("migration", () => {
    it("migrates V2 to V3 successfully", async () => {
      const v2Storage = {
        version: 2,
        accounts: [
          {
            refreshToken: "token1",
            addedAt: Date.now() - 10000,
            lastUsed: Date.now(),
          },
        ],
        activeIndex: 0,
      }
      vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify(v2Storage))
      vi.mocked(fs.writeFile).mockResolvedValue(undefined)

      const result = await storageModule.loadAccounts()

      expect(result?.version).toBe(4)
      expect(result?.accounts).toHaveLength(1)
    })
  })
})

describe("saveAccounts", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("saves valid storage to disk", async () => {
    vi.mocked(fs.readFile).mockImplementation((path) => {
      if ((path as string).endsWith(".gitignore"))
        return Promise.resolve(
          ".gitignore\nantigravity-accounts.json\nantigravity-accounts.json.*.tmp\nantigravity-signature-cache.json\nantigravity-logs/",
        )
      const enoent = new Error("ENOENT") as NodeJS.ErrnoException
      enoent.code = "ENOENT"
      return Promise.reject(enoent)
    })
    vi.mocked(fs.writeFile).mockResolvedValue(undefined)
    vi.mocked(fs.mkdir).mockResolvedValue(undefined)

    const storage = createMockStorage([createMockAccount()])
    await storageModule.saveAccounts(storage)

    expect(fs.writeFile).toHaveBeenCalledTimes(1)
    const writtenContent = vi.mocked(fs.writeFile).mock.calls[0]?.[1]
    expect(writtenContent).toBeDefined()
    const parsed = JSON.parse(writtenContent as string)
    expect(parsed.version).toBe(4)
    expect(parsed.accounts).toHaveLength(1)
  })
})

describe("regression tests", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe("first-time user experience", () => {
    it("should work correctly when no accounts file exists (ENOENT)", async () => {
      const error = new Error("ENOENT") as NodeJS.ErrnoException
      error.code = "ENOENT"
      vi.mocked(fs.readFile).mockRejectedValue(error)

      const result = await storageModule.loadAccounts()
      expect(result).toBeNull()

      vi.mocked(fs.writeFile).mockResolvedValue(undefined)
      vi.mocked(fs.mkdir).mockResolvedValue(undefined)

      const newStorage = createMockStorage([createMockAccount()])
      await expect(storageModule.saveAccounts(newStorage)).resolves.not.toThrow()
    })
  })

  describe("normal multi-account workflow", () => {
    it("should load existing accounts correctly", async () => {
      const existingStorage = createMockStorage([createMockAccount({ email: "existing@example.com" })])
      vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify(existingStorage))

      const result = await storageModule.loadAccounts()

      expect(result).not.toBeNull()
      expect(result?.accounts).toHaveLength(1)
      expect(result?.accounts[0]?.email).toBe("existing@example.com")
    })

    it("should preserve all accounts when saving", async () => {
      const enoent = new Error("ENOENT") as NodeJS.ErrnoException
      enoent.code = "ENOENT"
      vi.mocked(fs.readFile).mockRejectedValue(enoent)
      vi.mocked(fs.writeFile).mockResolvedValue(undefined)
      vi.mocked(fs.mkdir).mockResolvedValue(undefined)

      const storage = createMockStorage([
        createMockAccount({ email: "user1@example.com", refreshToken: "token1" }),
        createMockAccount({ email: "user2@example.com", refreshToken: "token2" }),
        createMockAccount({ email: "user3@example.com", refreshToken: "token3" }),
      ])

      await storageModule.saveAccounts(storage)

      expect(fs.writeFile).toHaveBeenCalledTimes(2)

      const tmpWriteCall = vi.mocked(fs.writeFile).mock.calls.find((call) => (call[0] as string).includes(".tmp"))
      expect(tmpWriteCall).toBeDefined()
      const parsed = JSON.parse(tmpWriteCall![1] as string)
      expect(parsed.accounts).toHaveLength(3)

      const gitignoreWriteCall = vi
        .mocked(fs.writeFile)
        .mock.calls.find((call) => (call[0] as string).includes(".gitignore"))
      expect(gitignoreWriteCall).toBeDefined()
    })
  })
})
