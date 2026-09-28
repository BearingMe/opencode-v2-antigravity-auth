import { beforeEach, describe, expect, it, vi } from "vitest"

const { loadAccounts, saveAccountsReplace, verifyAccountAccess } = vi.hoisted(() => ({
  loadAccounts: vi.fn(),
  saveAccountsReplace: vi.fn(async (_storage: unknown) => undefined),
  verifyAccountAccess: vi.fn(async (): Promise<{ status: "ok" | "blocked" | "error"; message: string; verifyUrl?: string }> => ({
    status: "blocked",
    message: "verification required",
    verifyUrl: "https://google.test/verify",
  })),
}))

vi.mock("./plugin/storage.js", () => ({ loadAccounts, saveAccountsReplace }))
vi.mock("./plugin/verify.js", () => ({
  verifyAccountAccess,
}))

import { manageAccounts } from "./v2-plugin.js"

describe("manageAccounts", () => {
  const accounts = [
    { email: "one@example.com", refreshToken: "one", addedAt: 1, lastUsed: 1, enabled: true },
    { email: "two@example.com", refreshToken: "two", addedAt: 2, lastUsed: 2, enabled: true },
  ]
  const invalidateFetch = vi.fn()
  const setAuth = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    verifyAccountAccess.mockResolvedValue({ status: "blocked", message: "verification required", verifyUrl: "https://google.test/verify" })
    loadAccounts.mockResolvedValue({ version: 4, accounts: structuredClone(accounts), activeIndex: 1 })
  })

  it("deletes the active account and selects the next valid pool entry", async () => {
    const result = await manageAccounts({ action: "delete", index: 1 }, {} as never, invalidateFetch, setAuth)

    expect(result.content).toContain("one@example.com")
    expect(saveAccountsReplace).toHaveBeenCalledWith(expect.objectContaining({
      accounts: [expect.objectContaining({ refreshToken: "one" })],
      activeIndex: 0,
    }))
    expect(setAuth).toHaveBeenCalledWith(expect.objectContaining({ refresh: "one|" }))
    expect(invalidateFetch).toHaveBeenCalledOnce()
  })

  it("does not write storage for an out-of-range index", async () => {
    const result = await manageAccounts({ action: "disable", index: 8 }, {} as never, invalidateFetch, setAuth)

    expect(result.content).toContain("Invalid account index")
    expect(saveAccountsReplace).not.toHaveBeenCalled()
  })

  it("leaves pool state untouched when listing accounts", async () => {
    const result = await manageAccounts({ action: "list" }, {} as never, invalidateFetch, setAuth)
    const parsed = JSON.parse(result.content) as { activeIndex: number; accounts: Array<{ email: string; active: boolean; verificationStatus: string }> }

    expect(parsed.activeIndex).toBe(1)
    expect(parsed.accounts[1]?.email).toBe("two@example.com")
    expect(parsed.accounts[1]?.active).toBe(true)
    expect(parsed.accounts[1]?.verificationStatus).toBe("not_checked")
    expect(saveAccountsReplace).not.toHaveBeenCalled()
  })

  it("marks blocked accounts disabled and records the verification link", async () => {
    const result = await manageAccounts({ action: "verify", index: 0 }, {} as never, invalidateFetch, setAuth)
    const calls = saveAccountsReplace.mock.calls as unknown as Array<[{ accounts: Array<Record<string, unknown>> }]>
    const written = calls[0]?.[0]

    expect(result.content).toContain("verification required")
    expect(written?.accounts[0]).toEqual(expect.objectContaining({
      enabled: false,
      verificationRequired: true,
      verificationUrl: "https://google.test/verify",
      lastVerificationStatus: "blocked",
      lastVerificationAt: expect.any(Number),
    }))
  })

  it("persists successful verification and reports it as a last check", async () => {
    verifyAccountAccess.mockResolvedValue({ status: "ok", message: "Account verification check passed." })
    const result = await manageAccounts({ action: "verify", index: 1 }, {} as never, invalidateFetch, setAuth)
    const verified = JSON.parse(result.content) as { status: string; checkedAt: number }
    const listResult = await manageAccounts({ action: "list" }, {} as never, invalidateFetch, setAuth)
    const list = JSON.parse(listResult.content) as { accounts: Array<{ verificationStatus: string; lastVerificationAt?: number }> }

    expect(verified.status).toBe("ok")
    expect(verified.checkedAt).toEqual(expect.any(Number))
    expect(list.accounts[1]).toMatchObject({ verificationStatus: "ok", lastVerificationAt: verified.checkedAt })
  })

  it("persists verification errors without disabling the account", async () => {
    verifyAccountAccess.mockResolvedValue({ status: "error", message: "network unavailable" })

    await manageAccounts({ action: "verify", index: 0 }, {} as never, invalidateFetch, setAuth)

    expect(saveAccountsReplace).toHaveBeenCalledWith(expect.objectContaining({
      accounts: expect.arrayContaining([expect.objectContaining({
        enabled: true,
        lastVerificationStatus: "error",
        lastVerificationAt: expect.any(Number),
      })]),
    }))
  })
})
