import { beforeEach, describe, expect, it, vi } from "vitest"

const { loadAccounts, saveAccountsReplace, checkAccountsQuota, verifyAccountAccess } = vi.hoisted(() => ({
  loadAccounts: vi.fn(),
  saveAccountsReplace: vi.fn(async (_storage: unknown) => undefined),
  checkAccountsQuota: vi.fn(),
  verifyAccountAccess: vi.fn(async (): Promise<{ status: "ok" | "blocked" | "error"; message: string; verifyUrl?: string }> => ({
    status: "ok",
    message: "Account verification check passed.",
  })),
}))

vi.mock("./storage.js", () => ({ loadAccounts, saveAccountsReplace }))
vi.mock("./quota.js", () => ({ checkAccountsQuota }))
vi.mock("./verify.js", () => ({ verifyAccountAccess }))

import {
  MAX_SAVED_ACCOUNTS,
  checkQuota,
  deleteAllAccounts,
  fingerprintRefreshToken,
  listAccounts,
  mutateAccount,
  persistOAuthAccount,
  persistRefreshRotation,
  resolveAccountTarget,
  verifyAccount,
} from "./account-service.js"
import { manageAccounts } from "../v2-plugin.js"

function account(overrides: Record<string, unknown> = {}) {
  return {
    email: "user@example.com",
    refreshToken: "refresh-token",
    projectId: "project",
    addedAt: 1,
    lastUsed: 2,
    enabled: true,
    ...overrides,
  }
}

function storage(accounts: Array<ReturnType<typeof account>>, activeIndex = 0, family?: { claude: number; gemini: number }) {
  return {
    version: 4 as const,
    accounts: structuredClone(accounts),
    activeIndex,
    activeIndexByFamily: family,
  }
}

const baseAccounts = () => [
  account({ id: "acc-one", email: "one@example.com", refreshToken: "token-one" }),
  account({ id: "acc-two", email: "two@example.com", refreshToken: "token-two" }),
]

describe("listAccounts", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    loadAccounts.mockResolvedValue(storage(baseAccounts(), 1))
  })

  it("returns credential-free summaries with stable opaque ids", async () => {
    const dto = await listAccounts()

    expect(dto.activeIndex).toBe(1)
    expect(dto.accounts).toHaveLength(2)
    expect(dto.accounts[0]).toMatchObject({ index: 0, email: "one@example.com", enabled: true, active: false })
    expect(dto.accounts[1]).toMatchObject({ index: 1, active: true, verificationStatus: "not_checked" })
    expect(dto.accounts[0]?.id).toBe("acc-one")
    expect(dto.accounts[1]?.id).toBe("acc-two")
    expect(JSON.stringify(dto)).not.toContain("token-one")
    expect(JSON.stringify(dto)).not.toContain("token-two")
  })

  it("falls back to a deterministic fingerprint for accounts predating ids without writing", async () => {
    loadAccounts.mockResolvedValue(storage(
      [account({ email: "legacy@example.com", refreshToken: "legacy-token" })],
      0,
    ))

    const dto = await listAccounts()

    expect(dto.accounts[0]?.id).toBe(fingerprintRefreshToken("legacy-token"))
    // Read path never persists backfill.
    expect(saveAccountsReplace).not.toHaveBeenCalled()
  })

  it("clamps out-of-range family cursors instead of trusting them", async () => {
    loadAccounts.mockResolvedValue(storage(baseAccounts(), 0, { claude: 9, gemini: -3 }))

    const dto = await listAccounts()

    expect(dto.activeIndexByFamily).toEqual({ claude: 1, gemini: 0 })
  })
})

describe("resolveAccountTarget", () => {
  const accounts = baseAccounts()

  it("resolves legacy indices with range checks", () => {
    expect(resolveAccountTarget(accounts, { index: 1 })).toEqual({ ok: true, index: 1 })
    expect(resolveAccountTarget(accounts, { index: 8 })).toMatchObject({ ok: false, kind: "invalid-index" })
    expect(resolveAccountTarget(accounts, { index: -1 })).toMatchObject({ ok: false, kind: "invalid-index" })
  })

  it("resolves durable ids and fails closed when missing", () => {
    expect(resolveAccountTarget(accounts, { id: "acc-two" })).toEqual({ ok: true, index: 1 })
    expect(resolveAccountTarget(accounts, { id: "acc-missing" }))
      .toMatchObject({ ok: false, kind: "not-found" })
  })

  it("fails closed on duplicate ids", () => {
    const dupes = [account({ id: "acc-dupe" }), account({ id: "acc-dupe" })]

    expect(resolveAccountTarget(dupes, { id: "acc-dupe" }))
      .toMatchObject({ ok: false, kind: "ambiguous" })
  })

  it("never resolves token-derived fingerprints as ids", () => {
    expect(resolveAccountTarget(accounts, { id: fingerprintRefreshToken("token-two") }))
      .toMatchObject({ ok: false, kind: "not-found" })
  })
})

describe("checkQuota", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    loadAccounts.mockResolvedValue(storage(baseAccounts(), 0))
    checkAccountsQuota.mockResolvedValue([
      { index: 0, email: "one@example.com", status: "ok", quota: { groups: {}, modelCount: 0 } },
      {
        index: 1,
        email: "two@example.com",
        status: "ok",
        quota: { groups: {}, modelCount: 0 },
        updatedAccount: account({ email: "two@example.com", refreshToken: "token-two-rotated" }),
      },
    ])
  })

  it("strips updatedAccount credential material from results", async () => {
    const outcome = await checkQuota({} as never, "google")

    expect(outcome.results).toHaveLength(2)
    expect(outcome.results[1]).not.toHaveProperty("updatedAccount")
    expect(JSON.stringify(outcome.results)).not.toContain("token-two-rotated")
    expect(checkAccountsQuota).toHaveBeenCalledOnce()
  })

  it("persists rotated token metadata without touching other fields", async () => {
    const outcome = await checkQuota({} as never, "google")

    expect(outcome.persistedUpdates).toBe(1)
    expect(saveAccountsReplace).toHaveBeenCalledOnce()
    const written = saveAccountsReplace.mock.calls[0]?.[0] as { accounts: Array<{ refreshToken: string; email: string }> }
    expect(written.accounts[1]).toMatchObject({ refreshToken: "token-two-rotated", email: "two@example.com" })
    expect(written.accounts[0]).toMatchObject({ refreshToken: "token-one" })
  })

  it("skips persistence for unmatched rotations", async () => {
    loadAccounts.mockReset()
    loadAccounts.mockResolvedValueOnce(storage([account({ email: "stale@example.com", refreshToken: "stale-token" })], 0))
    loadAccounts.mockResolvedValueOnce(storage(baseAccounts(), 0))
    checkAccountsQuota.mockResolvedValue([
      {
        index: 0,
        status: "ok",
        updatedAccount: account({ email: "stale@example.com", refreshToken: "stale-token-rotated" }),
      },
    ])

    const outcome = await checkQuota({} as never, "google")

    expect(outcome.persistedUpdates).toBe(0)
    expect(saveAccountsReplace).not.toHaveBeenCalled()
  })
})

describe("verifyAccount", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    loadAccounts.mockResolvedValue(storage(baseAccounts(), 1))
    verifyAccountAccess.mockResolvedValue({ status: "blocked", message: "verification required", verifyUrl: "https://google.test/verify" })
  })

  it("marks blocked accounts disabled and records the verification link", async () => {
    const outcome = await verifyAccount({ index: 0 }, {} as never, "google")

    expect(outcome).toMatchObject({ index: 0, email: "one@example.com", status: "blocked", message: "verification required" })
    const written = saveAccountsReplace.mock.calls[0]?.[0] as { accounts: Array<Record<string, unknown>> }
    expect(written.accounts[0]).toEqual(expect.objectContaining({
      enabled: false,
      verificationRequired: true,
      verificationUrl: "https://google.test/verify",
      lastVerificationStatus: "blocked",
      lastVerificationAt: expect.any(Number),
    }))
    // Unrelated account metadata is preserved.
    expect(written.accounts[1]).toMatchObject({ email: "two@example.com", refreshToken: "token-two" })
  })

  it("clears verification flags on success and re-enables the account", async () => {
    loadAccounts.mockResolvedValue(storage(
      [account({ email: "one@example.com", refreshToken: "token-one", enabled: false, verificationRequired: true })],
      0,
    ))
    verifyAccountAccess.mockResolvedValue({ status: "ok", message: "Account verification check passed." })

    const outcome = await verifyAccount({ index: 0 }, {} as never, "google")

    expect(outcome).toMatchObject({ status: "ok", checkedAt: expect.any(Number) })
    const written = saveAccountsReplace.mock.calls[0]?.[0] as { accounts: Array<Record<string, unknown>> }
    expect(written.accounts[0]).toMatchObject({ enabled: true, lastVerificationStatus: "ok" })
    expect(written.accounts[0]).not.toHaveProperty("verificationRequired")
  })

  it("records errors without disabling and resolves by durable id", async () => {
    verifyAccountAccess.mockResolvedValue({ status: "error", message: "network unavailable" })

    const outcome = await verifyAccount({ id: "acc-two" }, {} as never, "google")

    expect(outcome).toMatchObject({ index: 1, status: "error" })
    const written = saveAccountsReplace.mock.calls[0]?.[0] as { accounts: Array<Record<string, unknown>> }
    expect(written.accounts[1]).toMatchObject({ enabled: true, lastVerificationStatus: "error" })
  })

  it("does not write for unresolvable targets", async () => {
    const outcome = await verifyAccount({ index: 8 }, {} as never, "google")

    expect(outcome).toMatchObject({ ok: false })
    expect(saveAccountsReplace).not.toHaveBeenCalled()
  })
})

describe("mutateAccount", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    loadAccounts.mockResolvedValue(storage(baseAccounts(), 1, { claude: 1, gemini: 1 }))
  })

  it("selects by legacy index and moves both family cursors", async () => {
    const outcome = await mutateAccount({ index: 0 }, "select")

    expect(outcome).toMatchObject({
      op: "select",
      nextActiveIndex: 0,
      activeIndexByFamily: { claude: 0, gemini: 0 },
      remaining: 2,
    })
    if ("selected" in outcome && outcome.selected) {
      expect(outcome.selected.refreshParts).toMatchObject({ refreshToken: "token-one", projectId: "project" })
    } else {
      throw new Error("expected a selected account")
    }
    // Selected refresh parts stay server-side (consumed by setAuth only) and
    // are never serialized into tool content; the emailed selection is what
    // the tool reports.
  })

  it("supports family-scoped selection without moving the other family", async () => {
    const outcome = await mutateAccount({ index: 0 }, "select", { family: "gemini" })

    expect(outcome).toMatchObject({
      nextActiveIndex: 0,
      activeIndexByFamily: { claude: 1, gemini: 0 },
    })
  })

  it("preserves family cursors on enable and disable", async () => {
    loadAccounts.mockResolvedValue(storage(baseAccounts(), 0, { claude: 0, gemini: 1 }))

    const disabled = await mutateAccount({ index: 1 }, "disable")
    const written = saveAccountsReplace.mock.calls[0]?.[0] as {
      accounts: Array<{ enabled: boolean }>
      activeIndexByFamily: { claude: number; gemini: number }
    }

    expect(disabled).toMatchObject({ remaining: 2 })
    expect(written.accounts[1]?.enabled).toBe(false)
    expect(written.activeIndexByFamily).toEqual({ claude: 0, gemini: 1 })

    const enabled = await mutateAccount({ id: "acc-two" }, "enable")
    expect(enabled).toMatchObject({ remaining: 2 })
  })

  it("remaps family cursors around a deleted account", async () => {
    loadAccounts.mockResolvedValue(storage(baseAccounts(), 1, { claude: 1, gemini: 0 }))

    const outcome = await mutateAccount({ index: 0 }, "delete")
    const written = saveAccountsReplace.mock.calls[0]?.[0] as {
      accounts: Array<{ refreshToken: string }>
      activeIndex: number
      activeIndexByFamily: { claude: number; gemini: number }
    }

    expect(outcome).toMatchObject({ remaining: 1, nextActiveIndex: 0 })
    expect(written.accounts).toHaveLength(1)
    expect(written.activeIndexByFamily).toEqual({ claude: 0, gemini: 0 })
  })

  it("returns a null selection when the last account is deleted", async () => {
    loadAccounts.mockResolvedValue(storage([account({ email: "solo@example.com", refreshToken: "solo" })], 0))

    const outcome = await mutateAccount({ index: 0 }, "delete")

    expect(outcome).toMatchObject({ remaining: 0, nextActiveIndex: 0 })
    if ("selected" in outcome) expect(outcome.selected).toBeNull()
    const written = saveAccountsReplace.mock.calls[0]?.[0] as { accounts: unknown[]; activeIndex: number }
    expect(written.accounts).toHaveLength(0)
    expect(written.activeIndex).toBe(0)
  })

  it("does not write for unknown ops or out-of-range targets", async () => {
    const unknown = await mutateAccount({ index: 0 }, "explode" as never)
    const missing = await mutateAccount({ index: 8 }, "disable")

    expect(unknown).toMatchObject({ ok: false, kind: "unknown-op" })
    expect(missing).toMatchObject({ ok: false })
    expect(saveAccountsReplace).not.toHaveBeenCalled()
  })
})

describe("deleteAllAccounts", () => {
  it("replaces storage with an empty pool", async () => {
    vi.clearAllMocks()

    const outcome = await deleteAllAccounts()

    expect(outcome).toEqual({ remaining: 0 })
    expect(saveAccountsReplace).toHaveBeenCalledWith({
      version: 4,
      accounts: [],
      activeIndex: 0,
      activeIndexByFamily: { claude: 0, gemini: 0 },
    })
  })
})

describe("persistOAuthAccount", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    loadAccounts.mockResolvedValue(storage(baseAccounts(), 0))
  })

  it("appends new accounts and selects them", async () => {
    const outcome = await persistOAuthAccount(
      { refresh: "token-three", email: "three@example.com", projectId: "p3" },
      "add",
    )

    expect(outcome).toMatchObject({ selectedIndex: 2, accountCount: 3, isNew: true })
    expect(outcome.selectedRefreshParts).toEqual({ refreshToken: "token-three", projectId: "p3" })
    expect(outcome.selectedId).toEqual(expect.any(String))
    expect(outcome.selectedId).not.toBe("")
    const written = saveAccountsReplace.mock.calls[0]?.[0] as {
      accounts: Array<{ email: string; id?: string }>
      activeIndex: number
    }
    expect(written.accounts).toHaveLength(3)
    expect(written.activeIndex).toBe(2)
    expect(written.accounts[2]?.id).toBe(outcome.selectedId)
  })

  it("reconnects duplicate emails without creating duplicates", async () => {
    const outcome = await persistOAuthAccount(
      { refresh: "token-two-rotated", email: "TWO@example.com", projectId: "p2" },
      "add",
    )

    expect(outcome).toMatchObject({ selectedIndex: 1, accountCount: 2, isNew: false })
    expect(outcome.selectedId).toBe("acc-two")
    const written = saveAccountsReplace.mock.calls[0]?.[0] as {
      accounts: Array<{ refreshToken: string; addedAt: number; id?: string }>
    }
    expect(written.accounts).toHaveLength(2)
    expect(written.accounts[1]?.refreshToken).toBe("token-two-rotated")
    // Reconnect preserves the durable id instead of minting a new one.
    expect(written.accounts[1]?.id).toBe("acc-two")
  })

  it("backfills durable ids for pre-existing accounts on persist", async () => {
    loadAccounts.mockResolvedValue(storage(
      [account({ email: "legacy@example.com", refreshToken: "legacy-token" })],
      0,
    ))

    await persistOAuthAccount({ refresh: "fresh-token", email: "fresh@example.com", projectId: "p" }, "add")

    const written = saveAccountsReplace.mock.calls[0]?.[0] as {
      accounts: Array<{ id?: string; refreshToken: string }>
    }
    expect(written.accounts[0]?.id).toEqual(expect.any(String))
    expect(written.accounts[1]?.id).toEqual(expect.any(String))
    expect(written.accounts[0]?.id).not.toBe(written.accounts[1]?.id)
  })

  it("enforces the account cap at persistence time", async () => {
    const full = Array.from({ length: MAX_SAVED_ACCOUNTS }, (_, i) =>
      account({ email: `u${i}@example.com`, refreshToken: `token-${i}` }))
    loadAccounts.mockResolvedValue(storage(full, 0))

    await expect(persistOAuthAccount({ refresh: "extra", email: "extra@example.com", projectId: "p" }, "add"))
      .rejects.toThrow("Maximum of 10 Antigravity accounts reached")
    expect(saveAccountsReplace).not.toHaveBeenCalled()
  })

  it("replace resets the pool to the single incoming account", async () => {
    const outcome = await persistOAuthAccount(
      { refresh: "fresh", email: "fresh@example.com", projectId: "p" },
      "replace",
    )

    expect(outcome).toMatchObject({ selectedIndex: 0, accountCount: 1, isNew: true })
  })
})

describe("persistRefreshRotation", () => {  beforeEach(() => {
    vi.clearAllMocks()
    loadAccounts.mockResolvedValue(storage(baseAccounts(), 0))
  })

  it("rotates the matching token and preserves sibling accounts", async () => {
    const rotated = await persistRefreshRotation("token-one", "token-one-rotated")

    expect(rotated).toBe(true)
    const written = saveAccountsReplace.mock.calls[0]?.[0] as { accounts: Array<{ refreshToken: string; email: string }> }
    expect(written.accounts[0]).toMatchObject({ refreshToken: "token-one-rotated", email: "one@example.com" })
    expect(written.accounts[1]).toMatchObject({ refreshToken: "token-two" })
  })

  it("keeps the durable account id unchanged after refresh-token rotation", async () => {
    const rotated = await persistRefreshRotation("token-one", "token-one-rotated")

    expect(rotated).toBe(true)
    const written = saveAccountsReplace.mock.calls[0]?.[0] as {
      accounts: Array<{ id?: string; refreshToken: string; addedAt: number; lastUsed: number }>
    }
    // Identity survives rotation: same id, new token.
    expect(written.accounts[0]).toMatchObject({ id: "acc-one", refreshToken: "token-one-rotated" })
    expect(written.accounts[1]).toMatchObject({ id: "acc-two", refreshToken: "token-two" })
    // The rotated account still resolves by its durable id.
    expect(resolveAccountTarget(written.accounts, { id: "acc-one" })).toEqual({ ok: true, index: 0 })
  })

  it("skips the write when nothing rotated or nothing matches", async () => {
    expect(await persistRefreshRotation("token-one", "token-one")).toBe(false)
    expect(await persistRefreshRotation("token-one", "")).toBe(false)
    expect(await persistRefreshRotation("ghost", "ghost-rotated")).toBe(false)
    loadAccounts.mockResolvedValue(null)
    expect(await persistRefreshRotation("token-one", "token-one-rotated")).toBe(false)
    expect(saveAccountsReplace).not.toHaveBeenCalled()
  })
})

describe("legacy tool adapter redaction", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("never serializes refresh tokens into tool content", async () => {
    const setAuth = vi.fn()
    const invalidateFetch = vi.fn()
    for (const action of ["list", "select", "delete", "enable", "disable"] as const) {
      loadAccounts.mockResolvedValue(storage(baseAccounts(), 0))
      const result = await manageAccounts({ action, index: 0 }, {} as never, invalidateFetch, setAuth)

      expect(result.content).not.toContain("token-one")
      expect(result.content).not.toContain("token-two")
    }
  })

  it("keeps unknown-action and out-of-range behavior without writing", async () => {
    const setAuth = vi.fn()
    const invalidateFetch = vi.fn()
    loadAccounts.mockResolvedValue(storage(baseAccounts(), 0))

    const unknown = await manageAccounts({ action: "explode", index: 0 }, {} as never, invalidateFetch, setAuth)
    const outOfRange = await manageAccounts({ action: "disable", index: 8 }, {} as never, invalidateFetch, setAuth)

    expect(unknown.content).toContain("Unknown account action")
    expect(outOfRange.content).toContain("Invalid account index")
    expect(saveAccountsReplace).not.toHaveBeenCalled()
    expect(setAuth).not.toHaveBeenCalled()
  })
})

describe("legacy tool adapter parity (check_quota, verify, delete_all)", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    loadAccounts.mockResolvedValue(storage(baseAccounts(), 0))
  })

  it("check_quota passes quota payloads through with credential material redacted", async () => {
    const quotaPayload = {
      index: 0,
      email: "one@example.com",
      status: "ok" as const,
      quota: { groups: {}, modelCount: 0 },
      geminiCliQuota: { models: [] },
    }
    checkAccountsQuota.mockResolvedValue([
      quotaPayload,
      {
        index: 1,
        email: "two@example.com",
        status: "ok" as const,
        quota: { groups: {}, modelCount: 0 },
        updatedAccount: account({ email: "two@example.com", refreshToken: "token-two-rotated" }),
      },
    ])

    const result = await manageAccounts({ action: "check_quota" }, {} as never, vi.fn(), vi.fn())
    const parsed = JSON.parse(result.content) as Array<Record<string, unknown>>

    // Pre-extraction shape preserved minus the redacted credential field.
    expect(parsed).toHaveLength(2)
    expect(parsed[0]).toMatchObject(quotaPayload)
    expect(parsed[1]).not.toHaveProperty("updatedAccount")
    expect(result.content).not.toContain("token-two-rotated")
    expect(result.content).not.toContain("token-one")
  })

  it("verify reports the probe result and persists metadata without touching auth", async () => {
    const setAuth = vi.fn()
    const invalidateFetch = vi.fn()
    verifyAccountAccess.mockResolvedValue({
      status: "blocked",
      message: "verification required",
      verifyUrl: "https://google.test/verify",
    })

    const result = await manageAccounts({ action: "verify", index: 0 }, {} as never, invalidateFetch, setAuth)
    const parsed = JSON.parse(result.content) as Record<string, unknown>

    expect(parsed).toMatchObject({
      index: 0,
      email: "one@example.com",
      status: "blocked",
      message: "verification required",
      verifyUrl: "https://google.test/verify",
      checkedAt: expect.any(Number),
    })
    expect(result.content).not.toContain("token-one")
    const written = saveAccountsReplace.mock.calls[0]?.[0] as { accounts: Array<Record<string, unknown>> }
    expect(written.accounts[0]).toMatchObject({ enabled: false, lastVerificationStatus: "blocked" })
    expect(written.accounts[1]).toMatchObject({ email: "two@example.com", refreshToken: "token-two" })
    expect(invalidateFetch).toHaveBeenCalledOnce()
    // Pre-extraction parity: verify never repoints auth.
    expect(setAuth).not.toHaveBeenCalled()
  })

  it("delete_all clears the pool, resets auth, and invalidates", async () => {
    const setAuth = vi.fn()
    const invalidateFetch = vi.fn()

    const result = await manageAccounts({ action: "delete_all" }, {} as never, invalidateFetch, setAuth)

    expect(result.content).toBe("All Antigravity accounts deleted.")
    expect(saveAccountsReplace).toHaveBeenCalledWith({
      version: 4,
      accounts: [],
      activeIndex: 0,
      activeIndexByFamily: { claude: 0, gemini: 0 },
    })
    expect(setAuth).toHaveBeenCalledWith({ type: "oauth", refresh: "", access: "", expires: 0 })
    expect(invalidateFetch).toHaveBeenCalledOnce()
  })
})
