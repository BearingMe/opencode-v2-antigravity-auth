import { beforeEach, describe, expect, it, vi } from "vitest"

const { loadAccounts, updateAccounts, checkAccountsQuota, verifyAccountAccess, written } = vi.hoisted(() => ({
  loadAccounts: vi.fn(),
  updateAccounts: vi.fn(),
  checkAccountsQuota: vi.fn(),
  verifyAccountAccess: vi.fn(async (): Promise<{ status: "ok" | "blocked" | "error"; message: string; verifyUrl?: string }> => ({
    status: "ok",
    message: "Account verification check passed.",
  })),
  written: [] as unknown[],
}))

vi.mock("./storage.js", () => ({ loadAccounts, updateAccounts }))
vi.mock("./quota.js", () => ({ checkAccountsQuota }))
vi.mock("./verify.js", () => ({ verifyAccountAccess }))

import {
  MAX_SAVED_ACCOUNTS,
  checkQuota,
  deleteAllAccounts,
  fingerprintRefreshToken,
  getQuotaPresentation,
  listAccounts,
  mutateAccount,
  persistOAuthAccount,
  persistRefreshRotation,
  resolveAccountTarget,
  verifyAccount,
} from "./account-service.js"
import { manageAccounts } from "../v2-plugin.js"

// Transactional storage mock: runs the updater against a clone of the latest
// loadAccounts value and records the replacement store. Updaters that return
// their input unchanged signal "no change" and record nothing, mirroring
// updateAccounts in src/plugin/storage.ts.
updateAccounts.mockImplementation(async (updater: (current: unknown) => Promise<{ storage: unknown; result: unknown }>) => {
  const current = (await loadAccounts()) ?? { version: 4, accounts: [], activeIndex: 0 }
  const input = structuredClone(current)
  const { storage, result } = await updater(input)
  if (storage !== input) written.push(storage)
  return result
})

beforeEach(() => {
  written.length = 0
})

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
    expect(updateAccounts).not.toHaveBeenCalled()
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
    expect(updateAccounts).toHaveBeenCalledOnce()
    const writtenQuota = written[0] as { accounts: Array<{ refreshToken: string; email: string }> }
    expect(writtenQuota.accounts[1]).toMatchObject({ refreshToken: "token-two-rotated", email: "two@example.com" })
    expect(writtenQuota.accounts[0]).toMatchObject({ refreshToken: "token-one" })
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
    // The rotation matched nothing inside the transaction, so no replacement
    // store was recorded.
    expect(written).toHaveLength(0)
  })
})

describe("getQuotaPresentation", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    loadAccounts.mockResolvedValue(storage(baseAccounts(), 0, { claude: 0, gemini: 1 }))
    checkAccountsQuota.mockResolvedValue([])
  })

  it("keeps missing quota unknown while preserving a real zero fraction", async () => {
    checkAccountsQuota.mockImplementation(async (accounts: Array<Record<string, unknown>>) => {
      const email = accounts[0]?.email
      return email === "one@example.com"
        ? [{ index: 0, status: "ok", quota: { groups: { claude: { remainingFraction: 0, resetTime: "2030-01-02T03:04:05Z" } }, modelCount: 1 }, geminiCliQuota: { models: [] } }]
        : [{ index: 0, status: "ok", quota: { groups: {}, modelCount: 0 }, geminiCliQuota: { models: [] } }]
    })

    const dto = await getQuotaPresentation({} as never)

    expect(dto.accounts[0]?.status).toBe("ok")
    expect(dto.accounts[0]?.groups.claude).toEqual({
      remainingFraction: 0,
      consumedPercent: 100,
      resetTime: Date.parse("2030-01-02T03:04:05Z"),
    })
    expect(dto.accounts[0]?.groups["gemini-pro"]).toEqual({ remainingFraction: null, consumedPercent: null, resetTime: null })
    expect(dto.accounts[1]?.status).toBe("unknown")
    expect(dto.accounts[1]?.groups.claude?.remainingFraction).toBeNull()
    expect(dto.accounts[1]?.groups.claude?.consumedPercent).toBeNull()
    // Empty Gemini CLI buckets do not imply exhausted Antigravity quota.
    expect(dto.accounts[1]?.groups["gemini-pro"]?.consumedPercent).toBeNull()
  })

  it("marks failed refreshes as errors and cached values stale without leaking tokens", async () => {
    const staleAt = Date.now() - 60_000
    loadAccounts.mockResolvedValue(storage([
      account({
        id: "cached", email: "cached@example.com", refreshToken: "secret-refresh-token",
        cachedQuota: { claude: { remainingFraction: 0.25, resetTime: "not-a-date", modelCount: 1 } },
        cachedQuotaUpdatedAt: staleAt,
        verificationRequired: true,
        coolingDownUntil: Date.now() + 60_000,
      }),
      account({ id: "failed", email: "failed@example.com", refreshToken: "another-secret" }),
    ], 0, { claude: 0, gemini: 1 }))
    checkAccountsQuota.mockImplementation(async (accounts: Array<Record<string, unknown>>) => {
      if (accounts[0]?.email === "cached@example.com") throw new Error("quota network error")
      return [{ index: 0, status: "error", error: "refresh failed", updatedAccount: account({ refreshToken: "rotated-secret" }) }]
    })

    const dto = await getQuotaPresentation({} as never, { staleAfterMs: 1_000 })

    expect(dto.accounts[0]).toMatchObject({ status: "error", freshness: "stale", checkedAt: staleAt, verificationRequired: true, coolingDown: true })
    expect(dto.accounts[0]?.cooldownUntil).toBeGreaterThan(Date.now())
    expect(dto.accounts[0]?.groups.claude).toEqual({ remainingFraction: 0.25, consumedPercent: 75, resetTime: null })
    expect(dto.accounts[1]).toMatchObject({ status: "error", freshness: "unchecked", checkedAt: expect.any(Number) })
    expect(JSON.stringify(dto)).not.toContain("secret-refresh-token")
    expect(JSON.stringify(dto)).not.toContain("another-secret")
    expect(JSON.stringify(dto)).not.toContain("rotated-secret")
    expect(JSON.stringify(dto)).not.toContain("updatedAccount")
  })

  it("labels a successful empty response unknown, selects per family, and supports cache-only reads", async () => {
    const cachedAt = Date.now()
    loadAccounts.mockResolvedValue(storage([
      account({ id: "first", cachedQuota: {}, cachedQuotaUpdatedAt: cachedAt }),
      account({ id: "second", cachedQuota: {}, cachedQuotaUpdatedAt: cachedAt }),
    ], 0, { claude: 1, gemini: 0 }))

    const dto = await getQuotaPresentation({} as never, { refresh: false })

    expect(checkAccountsQuota).not.toHaveBeenCalled()
    expect(dto.accounts.map((entry) => entry.status)).toEqual(["unknown", "unknown"])
    expect(dto.accounts[0]?.selectedByFamily).toEqual({ claude: false, gemini: true })
    expect(dto.accounts[1]?.selectedByFamily).toEqual({ claude: true, gemini: false })
    expect(dto.accounts[0]?.freshness).toBe("fresh")
  })

  it("returns completed accounts when another account check reaches its timeout", async () => {
    vi.useFakeTimers()
    loadAccounts.mockResolvedValue(storage(baseAccounts(), 0))
    checkAccountsQuota.mockImplementation(async (accounts: Array<Record<string, unknown>>) => {
      if (accounts[0]?.email === "one@example.com") {
        return [{ index: 0, status: "ok", quota: { groups: { claude: { remainingFraction: 0.5 }, "gemini-pro": { remainingFraction: 0.75 } }, modelCount: 2 } }]
      }
      return new Promise(() => undefined)
    })

    try {
      const pending = getQuotaPresentation({} as never, { timeoutMs: 1_000 })
      await vi.advanceTimersByTimeAsync(1_000)
      const dto = await pending

      expect(dto.accounts[0]?.status).toBe("ok")
      expect(dto.accounts[0]?.groups.claude?.remainingFraction).toBe(0.5)
      expect(dto.accounts[1]?.status).toBe("error")
    } finally {
      vi.useRealTimers()
    }
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
    const writtenBlocked = written[0] as { accounts: Array<Record<string, unknown>> }
    expect(writtenBlocked.accounts[0]).toEqual(expect.objectContaining({
      enabled: false,
      verificationRequired: true,
      verificationUrl: "https://google.test/verify",
      lastVerificationStatus: "blocked",
      lastVerificationAt: expect.any(Number),
    }))
    // Unrelated account metadata is preserved.
    expect(writtenBlocked.accounts[1]).toMatchObject({ email: "two@example.com", refreshToken: "token-two" })
  })

  it("clears verification flags on success and re-enables the account", async () => {
    loadAccounts.mockResolvedValue(storage(
      [account({ email: "one@example.com", refreshToken: "token-one", enabled: false, verificationRequired: true })],
      0,
    ))
    verifyAccountAccess.mockResolvedValue({ status: "ok", message: "Account verification check passed." })

    const outcome = await verifyAccount({ index: 0 }, {} as never, "google")

    expect(outcome).toMatchObject({ status: "ok", checkedAt: expect.any(Number) })
    const writtenCleared = written[0] as { accounts: Array<Record<string, unknown>> }
    expect(writtenCleared.accounts[0]).toMatchObject({ enabled: true, lastVerificationStatus: "ok" })
    expect(writtenCleared.accounts[0]).not.toHaveProperty("verificationRequired")
  })

  it("records errors without disabling and resolves by durable id", async () => {
    verifyAccountAccess.mockResolvedValue({ status: "error", message: "network unavailable" })

    const outcome = await verifyAccount({ id: "acc-two" }, {} as never, "google")

    expect(outcome).toMatchObject({ index: 1, status: "error" })
    const writtenVerifyError = written[0] as { accounts: Array<Record<string, unknown>> }
    expect(writtenVerifyError.accounts[1]).toMatchObject({ enabled: true, lastVerificationStatus: "error" })
  })

  it("does not write for unresolvable targets", async () => {
    const outcome = await verifyAccount({ index: 8 }, {} as never, "google")

    expect(outcome).toMatchObject({ ok: false })
    expect(updateAccounts).not.toHaveBeenCalled()
  })

  it("fails closed when the target vanishes between verification and write", async () => {
    loadAccounts.mockReset()
    loadAccounts.mockResolvedValueOnce(storage(baseAccounts(), 0))
    loadAccounts.mockResolvedValue(storage(
      [account({ id: "acc-two", email: "two@example.com", refreshToken: "token-two" })],
      0,
    ))
    verifyAccountAccess.mockResolvedValue({ status: "ok", message: "Account verification check passed." })

    const outcome = await verifyAccount({ id: "acc-one" }, {} as never, "google")

    expect(outcome).toMatchObject({ ok: false, kind: "not-found" })
    expect(written).toHaveLength(0)
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
    const writtenDisable = written[0] as {
      accounts: Array<{ enabled: boolean }>
      activeIndexByFamily: { claude: number; gemini: number }
    }

    expect(disabled).toMatchObject({ remaining: 2 })
    expect(writtenDisable.accounts[1]?.enabled).toBe(false)
    expect(writtenDisable.activeIndexByFamily).toEqual({ claude: 0, gemini: 1 })

    const enabled = await mutateAccount({ id: "acc-two" }, "enable")
    expect(enabled).toMatchObject({ remaining: 2 })
  })

  it("remaps family cursors around a deleted account", async () => {
    loadAccounts.mockResolvedValue(storage(baseAccounts(), 1, { claude: 1, gemini: 0 }))

    const outcome = await mutateAccount({ index: 0 }, "delete")
    const writtenDelete = written[0] as {
      accounts: Array<{ refreshToken: string }>
      activeIndex: number
      activeIndexByFamily: { claude: number; gemini: number }
    }

    expect(outcome).toMatchObject({ remaining: 1, nextActiveIndex: 0 })
    expect(writtenDelete.accounts).toHaveLength(1)
    expect(writtenDelete.activeIndexByFamily).toEqual({ claude: 0, gemini: 0 })
  })

  it("returns a null selection when the last account is deleted", async () => {
    loadAccounts.mockResolvedValue(storage([account({ email: "solo@example.com", refreshToken: "solo" })], 0))

    const outcome = await mutateAccount({ index: 0 }, "delete")

    expect(outcome).toMatchObject({ remaining: 0, nextActiveIndex: 0 })
    if ("selected" in outcome) expect(outcome.selected).toBeNull()
    const writtenLastDelete = written[0] as { accounts: unknown[]; activeIndex: number }
    expect(writtenLastDelete.accounts).toHaveLength(0)
    expect(writtenLastDelete.activeIndex).toBe(0)
  })

  it("does not write for unknown ops or out-of-range targets", async () => {
    const unknown = await mutateAccount({ index: 0 }, "explode" as never)

    expect(unknown).toMatchObject({ ok: false, kind: "unknown-op" })
    expect(updateAccounts).not.toHaveBeenCalled()

    const missing = await mutateAccount({ index: 8 }, "disable")

    expect(missing).toMatchObject({ ok: false })
    // The out-of-range resolution fails inside the transaction, so the
    // updater returns its input unchanged and records no replacement store.
    expect(written).toHaveLength(0)
  })
})

describe("deleteAllAccounts", () => {
  it("replaces storage with an empty pool", async () => {
    vi.clearAllMocks()

    const outcome = await deleteAllAccounts()

    expect(outcome).toEqual({ remaining: 0 })
    expect(written[0]).toEqual({
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
    const writtenAppend = written[0] as {
      accounts: Array<{ email: string; id?: string }>
      activeIndex: number
    }
    expect(writtenAppend.accounts).toHaveLength(3)
    expect(writtenAppend.activeIndex).toBe(2)
    expect(writtenAppend.accounts[2]?.id).toBe(outcome.selectedId)
  })

  it("reconnects duplicate emails without creating duplicates", async () => {
    const outcome = await persistOAuthAccount(
      { refresh: "token-two-rotated", email: "TWO@example.com", projectId: "p2" },
      "add",
    )

    expect(outcome).toMatchObject({ selectedIndex: 1, accountCount: 2, isNew: false })
    expect(outcome.selectedId).toBe("acc-two")
    const writtenReconnect = written[0] as {
      accounts: Array<{ refreshToken: string; addedAt: number; id?: string }>
    }
    expect(writtenReconnect.accounts).toHaveLength(2)
    expect(writtenReconnect.accounts[1]?.refreshToken).toBe("token-two-rotated")
    // Reconnect preserves the durable id instead of minting a new one.
    expect(writtenReconnect.accounts[1]?.id).toBe("acc-two")
  })

  it("backfills durable ids for pre-existing accounts on persist", async () => {
    loadAccounts.mockResolvedValue(storage(
      [account({ email: "legacy@example.com", refreshToken: "legacy-token" })],
      0,
    ))

    await persistOAuthAccount({ refresh: "fresh-token", email: "fresh@example.com", projectId: "p" }, "add")

    const writtenBackfill = written[0] as {
      accounts: Array<{ id?: string; refreshToken: string }>
    }
    expect(writtenBackfill.accounts[0]?.id).toEqual(expect.any(String))
    expect(writtenBackfill.accounts[1]?.id).toEqual(expect.any(String))
    expect(writtenBackfill.accounts[0]?.id).not.toBe(writtenBackfill.accounts[1]?.id)
  })

  it("enforces the account cap at persistence time", async () => {
    const full = Array.from({ length: MAX_SAVED_ACCOUNTS }, (_, i) =>
      account({ email: `u${i}@example.com`, refreshToken: `token-${i}` }))
    loadAccounts.mockResolvedValue(storage(full, 0))

    await expect(persistOAuthAccount({ refresh: "extra", email: "extra@example.com", projectId: "p" }, "add"))
      .rejects.toThrow("Maximum of 10 Antigravity accounts reached")
    // The throwing updater aborts the transaction without recording a store.
    expect(written).toHaveLength(0)
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
    const writtenRotate = written[0] as { accounts: Array<{ refreshToken: string; email: string }> }
    expect(writtenRotate.accounts[0]).toMatchObject({ refreshToken: "token-one-rotated", email: "one@example.com" })
    expect(writtenRotate.accounts[1]).toMatchObject({ refreshToken: "token-two" })
  })

  it("keeps the durable account id unchanged after refresh-token rotation", async () => {
    const rotated = await persistRefreshRotation("token-one", "token-one-rotated")

    expect(rotated).toBe(true)
    const writtenRotateId = written[0] as {
      accounts: Array<{ id?: string; refreshToken: string; addedAt: number; lastUsed: number }>
    }
    // Identity survives rotation: same id, new token.
    expect(writtenRotateId.accounts[0]).toMatchObject({ id: "acc-one", refreshToken: "token-one-rotated" })
    expect(writtenRotateId.accounts[1]).toMatchObject({ id: "acc-two", refreshToken: "token-two" })
    // The rotated account still resolves by its durable id.
    expect(resolveAccountTarget(writtenRotateId.accounts, { id: "acc-one" })).toEqual({ ok: true, index: 0 })
  })

  it("skips the write when nothing rotated or nothing matches", async () => {
    expect(await persistRefreshRotation("token-one", "token-one")).toBe(false)
    expect(await persistRefreshRotation("token-one", "")).toBe(false)
    expect(await persistRefreshRotation("ghost", "ghost-rotated")).toBe(false)
    loadAccounts.mockResolvedValue(null)
    expect(await persistRefreshRotation("token-one", "token-one-rotated")).toBe(false)
    expect(updateAccounts).not.toHaveBeenCalled()
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
    // Unknown actions never reach the service; the out-of-range disable fails
    // inside the transaction without recording a replacement store.
    expect(updateAccounts).toHaveBeenCalledOnce()
    expect(written).toHaveLength(0)
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
    const writtenAdapterVerify = written[0] as { accounts: Array<Record<string, unknown>> }
    expect(writtenAdapterVerify.accounts[0]).toMatchObject({ enabled: false, lastVerificationStatus: "blocked" })
    expect(writtenAdapterVerify.accounts[1]).toMatchObject({ email: "two@example.com", refreshToken: "token-two" })
    expect(invalidateFetch).toHaveBeenCalledOnce()
    // Pre-extraction parity: verify never repoints auth.
    expect(setAuth).not.toHaveBeenCalled()
  })

  it("delete_all clears the pool, resets auth, and invalidates", async () => {
    const setAuth = vi.fn()
    const invalidateFetch = vi.fn()

    const result = await manageAccounts({ action: "delete_all" }, {} as never, invalidateFetch, setAuth)

    expect(result.content).toBe("All Antigravity accounts deleted.")
    expect(written[0]).toEqual({
      version: 4,
      accounts: [],
      activeIndex: 0,
      activeIndexByFamily: { claude: 0, gemini: 0 },
    })
    expect(setAuth).toHaveBeenCalledWith({ type: "oauth", refresh: "", access: "", expires: 0 })
    expect(invalidateFetch).toHaveBeenCalledOnce()
  })
})
