import { beforeEach, describe, expect, it, vi } from "vitest"

const { loadAccounts, updateAccounts, verifyAccountAccess, written, memory } = vi.hoisted(() => ({
  loadAccounts: vi.fn(),
  updateAccounts: vi.fn(),
  verifyAccountAccess: vi.fn(
    async (): Promise<{ status: "ok" | "blocked" | "error"; message: string; verifyUrl?: string }> => ({
      status: "blocked",
      message: "verification required",
      verifyUrl: "https://google.test/verify",
    }),
  ),
  written: [] as unknown[],
  memory: { store: null as unknown },
}))

vi.mock("../../plugin/storage.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../plugin/storage.js")>()
  return { ...actual, loadAccounts, updateAccounts }
})
vi.mock("../../plugin/verify.js", () => ({
  verifyAccountAccess,
}))

import { manageAccounts } from "./plugin.js"

// Stateful in-memory storage: reads clone the committed store and the
// updater commits its replacement, so a mutation is visible to subsequent
// reads exactly like the file store. Unchanged inputs record nothing.
loadAccounts.mockImplementation(async () => structuredClone(memory.store))
updateAccounts.mockImplementation(
  async (updater: (current: unknown) => Promise<{ storage: unknown; result: unknown }>) => {
    const input = structuredClone(memory.store)
    const { storage, result } = await updater(input)
    if (storage !== input) {
      memory.store = storage
      written.push(storage)
    }
    return result
  },
)

describe("manageAccounts", () => {
  const accounts = [
    { email: "one@example.com", refreshToken: "one", addedAt: 1, lastUsed: 1, enabled: true },
    { email: "two@example.com", refreshToken: "two", addedAt: 2, lastUsed: 2, enabled: true },
  ]
  const invalidateFetch = vi.fn()
  const setAuth = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    written.length = 0
    verifyAccountAccess.mockResolvedValue({
      status: "blocked",
      message: "verification required",
      verifyUrl: "https://google.test/verify",
    })
    memory.store = { version: 4, accounts: structuredClone(accounts), activeIndex: 1 }
  })

  it("deletes the active account and selects the next valid pool entry", async () => {
    const result = await manageAccounts({ action: "delete", index: 1 }, {} as never, invalidateFetch, setAuth)

    expect(result.content).toContain("one@example.com")
    const deleted = written[0] as { accounts: Array<Record<string, unknown>>; activeIndex: number }
    expect(deleted).toMatchObject({
      accounts: [{ refreshToken: "one" }],
      activeIndex: 0,
    })
    expect(setAuth).toHaveBeenCalledWith(expect.objectContaining({ refresh: "one|" }))
    expect(invalidateFetch).toHaveBeenCalledOnce()
  })

  it("does not write storage for an out-of-range index", async () => {
    const result = await manageAccounts({ action: "disable", index: 8 }, {} as never, invalidateFetch, setAuth)

    expect(result.content).toContain("Invalid account index")
    expect(written).toHaveLength(0)
  })

  it("leaves pool state untouched when listing accounts", async () => {
    const result = await manageAccounts({ action: "list" }, {} as never, invalidateFetch, setAuth)
    const parsed = JSON.parse(result.content) as {
      activeIndex: number
      accounts: Array<{ email: string; active: boolean; verificationStatus: string }>
    }

    expect(parsed.activeIndex).toBe(1)
    expect(parsed.accounts[1]?.email).toBe("two@example.com")
    expect(parsed.accounts[1]?.active).toBe(true)
    expect(parsed.accounts[1]?.verificationStatus).toBe("not_checked")
    expect(updateAccounts).not.toHaveBeenCalled()
  })

  it("marks blocked accounts disabled and records the verification link", async () => {
    const result = await manageAccounts({ action: "verify", index: 0 }, {} as never, invalidateFetch, setAuth)
    const verified = written[0] as { accounts: Array<Record<string, unknown>> }

    expect(result.content).toContain("verification required")
    expect(verified?.accounts[0]).toEqual(
      expect.objectContaining({
        enabled: false,
        verificationRequired: true,
        verificationUrl: "https://google.test/verify",
        lastVerificationStatus: "blocked",
        lastVerificationAt: expect.any(Number),
      }),
    )
  })

  it("persists successful verification and reports it as a last check", async () => {
    verifyAccountAccess.mockResolvedValue({ status: "ok", message: "Account verification check passed." })
    const result = await manageAccounts({ action: "verify", index: 1 }, {} as never, invalidateFetch, setAuth)
    const verified = JSON.parse(result.content) as { status: string; checkedAt: number }
    const listResult = await manageAccounts({ action: "list" }, {} as never, invalidateFetch, setAuth)
    const list = JSON.parse(listResult.content) as {
      accounts: Array<{ verificationStatus: string; lastVerificationAt?: number }>
    }

    expect(verified.status).toBe("ok")
    expect(verified.checkedAt).toEqual(expect.any(Number))
    expect(list.accounts[1]).toMatchObject({ verificationStatus: "ok", lastVerificationAt: verified.checkedAt })
  })

  it("persists verification errors without disabling the account", async () => {
    verifyAccountAccess.mockResolvedValue({ status: "error", message: "network unavailable" })

    await manageAccounts({ action: "verify", index: 0 }, {} as never, invalidateFetch, setAuth)
    const verifiedError = written[0] as { accounts: Array<Record<string, unknown>> }

    expect(verifiedError.accounts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          enabled: true,
          lastVerificationStatus: "error",
          lastVerificationAt: expect.any(Number),
        }),
      ]),
    )
  })
})
