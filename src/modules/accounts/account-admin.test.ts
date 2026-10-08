import { beforeEach, describe, expect, it, vi } from "vitest"

const { loadAccounts, updateAccounts, checkAccountsQuota, verifyAccountAccess, quotaCacheWarn, written } = vi.hoisted(
  () => ({
    loadAccounts: vi.fn(),
    updateAccounts: vi.fn(),
    checkAccountsQuota: vi.fn(),
    quotaCacheWarn: vi.fn(),
    verifyAccountAccess: vi.fn(
      async (): Promise<{ status: "ok" | "blocked" | "error"; message: string; verifyUrl?: string }> => ({
        status: "ok",
        message: "Account verification check passed.",
      }),
    ),
    written: [] as unknown[],
  }),
)

vi.mock("../../adapters/filesystem/account-store.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../adapters/filesystem/account-store.js")>()
  // Tombstone helpers and the token fingerprint stay real: only the
  // file-backed load/update paths are faked.
  return { ...actual, loadAccounts, updateAccounts }
})
vi.mock("../../adapters/opencode/quota.js", () => ({ checkAccountsQuota }))
vi.mock("../../adapters/opencode/verification.js", () => ({ verifyAccountAccess }))

import { manageAccounts } from "../../v2-plugin.js"
import { createAccountAdmin, MAX_SAVED_ACCOUNTS, resolveAccountTarget } from "./index.js"
import { fingerprintRefreshToken, saveAccounts, saveAccountsReplace } from "../../adapters/filesystem/account-store.js"
import type { AccountStorageV4, AccountTarget, QuotaPresentationOptions } from "./index.js"

let nextAccountId = 0
let clockNow = 1_000_000

const accountAdmin = createAccountAdmin({
  persistence: {
    load: loadAccounts,
    save: saveAccounts,
    saveReplace: saveAccountsReplace,
    update: updateAccounts,
  },
  fingerprintRefreshToken,
  generateId: () => `test-account-${++nextAccountId}`,
  now: () => clockNow,
  checkQuota: checkAccountsQuota,
  verifyAccount: verifyAccountAccess,
  warn: quotaCacheWarn,
})

/** Reads the service list through the account-admin test fixture. */
const listAccounts = () => accountAdmin.list()
/** Runs the fixture service's quota check without host arguments. */
const checkQuota = (_client?: unknown, _providerId?: string) => accountAdmin.checkQuota()
/** Builds quota presentation through the account-admin test fixture. */
const getQuotaPresentation = (_client?: unknown, options?: QuotaPresentationOptions) => accountAdmin.quota(options)
/** Verifies a target through the account-admin test fixture. */
const verifyAccount = (target: AccountTarget, _client?: unknown, _providerId?: string) => accountAdmin.verify(target)
/** Applies a mutation through the account-admin test fixture. */
const mutateAccount = (...args: Parameters<typeof accountAdmin.mutate>) => accountAdmin.mutate(...args)
/** Deletes all accounts through the account-admin test fixture. */
const deleteAllAccounts = () => accountAdmin.deleteAll()
/** Persists an OAuth account through the account-admin test fixture. */
const persistOAuthAccount = (...args: Parameters<typeof accountAdmin.persistOAuthAccount>) =>
  accountAdmin.persistOAuthAccount(...args)
/** Persists a refresh rotation through the account-admin test fixture. */
const persistRefreshRotation = (...args: Parameters<typeof accountAdmin.persistRefreshRotation>) =>
  accountAdmin.persistRefreshRotation(...args)

// Transactional storage mock: runs the updater against a clone of the latest
// loadAccounts value and records the replacement store. Updaters that return
// their input unchanged signal "no change" and record nothing, mirroring
// updateAccounts in adapters/filesystem/account-store.ts.
updateAccounts.mockImplementation(
  async (updater: (current: AccountStorageV4) => Promise<{ storage: AccountStorageV4; result: unknown }>) => {
    const current = (await loadAccounts()) ?? { version: 4, accounts: [], activeIndex: 0 }
    const input = structuredClone(current)
    const { storage, result } = await updater(input)
    if (storage !== input) written.push(storage)
    return result
  },
)

beforeEach(() => {
  vi.clearAllMocks()
  written.length = 0
  nextAccountId = 0
  clockNow = 1_000_000
})

/**
 * Creates an AccountMetadata fixture for testing.
 */
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

/**
 * Creates an AccountStorageV4 fixture for testing.
 */
function storage(
  accounts: Array<ReturnType<typeof account>>,
  activeIndex = 0,
  family?: { claude: number; gemini: number },
) {
  return {
    version: 4 as const,
    accounts: structuredClone(accounts),
    activeIndex,
    activeIndexByFamily: family,
  }
}

/** Builds two stored accounts with distinct durable identities. */
const baseAccounts = () => [
  account({ id: "acc-one", email: "one@example.com", refreshToken: "token-one" }),
  account({ id: "acc-two", email: "two@example.com", refreshToken: "token-two" }),
]

describe("listAccounts", () => {
  beforeEach(() => {
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
    loadAccounts.mockResolvedValue(storage([account({ email: "legacy@example.com", refreshToken: "legacy-token" })], 0))

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
    expect(resolveAccountTarget(accounts, { id: "acc-missing" })).toMatchObject({ ok: false, kind: "not-found" })
  })

  it("fails closed on duplicate ids", () => {
    const dupes = [account({ id: "acc-dupe" }), account({ id: "acc-dupe" })]

    expect(resolveAccountTarget(dupes, { id: "acc-dupe" })).toMatchObject({ ok: false, kind: "ambiguous" })
  })

  it("never resolves token-derived fingerprints as ids", () => {
    expect(resolveAccountTarget(accounts, { id: fingerprintRefreshToken("token-two") })).toMatchObject({
      ok: false,
      kind: "not-found",
    })
  })
})

describe("checkQuota", () => {
  beforeEach(() => {
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
    const outcome = await checkQuota({} as never, "antigravity")

    expect(outcome.results).toHaveLength(2)
    expect(outcome.results[1]).not.toHaveProperty("updatedAccount")
    expect(JSON.stringify(outcome.results)).not.toContain("token-two-rotated")
    expect(checkAccountsQuota).toHaveBeenCalledOnce()
  })

  it("persists rotated token metadata without touching other fields", async () => {
    const outcome = await checkQuota({} as never, "antigravity")

    expect(outcome.persistedUpdates).toBe(1)
    expect(updateAccounts).toHaveBeenCalledOnce()
    const writtenQuota = written[0] as { accounts: Array<{ refreshToken: string; email: string }> }
    expect(writtenQuota.accounts[1]).toMatchObject({ refreshToken: "token-two-rotated", email: "two@example.com" })
    expect(writtenQuota.accounts[0]).toMatchObject({ refreshToken: "token-one" })
  })

  it("skips persistence for unmatched rotations", async () => {
    loadAccounts.mockReset()
    loadAccounts.mockResolvedValueOnce(
      storage([account({ email: "stale@example.com", refreshToken: "stale-token" })], 0),
    )
    loadAccounts.mockResolvedValueOnce(storage(baseAccounts(), 0))
    checkAccountsQuota.mockResolvedValue([
      {
        index: 0,
        status: "ok",
        updatedAccount: account({ email: "stale@example.com", refreshToken: "stale-token-rotated" }),
      },
    ])

    const outcome = await checkQuota({} as never, "antigravity")

    expect(outcome.persistedUpdates).toBe(0)
    // The rotation matched nothing inside the transaction, so no replacement
    // store was recorded.
    expect(written).toHaveLength(0)
  })
})

describe("getQuotaPresentation", () => {
  beforeEach(() => {
    loadAccounts.mockResolvedValue(storage(baseAccounts(), 0, { claude: 0, gemini: 1 }))
    checkAccountsQuota.mockResolvedValue([])
  })

  it.each(["EACCES", "ENOSPC", "ELOCKED"])("returns fresh quota despite a %s cache-write failure", async (code) => {
    const cachedAt = clockNow - 1000
    const source = account({
      id: "stable",
      cachedQuota: { claude: { remainingFraction: 0.9, modelCount: 1 } },
      cachedQuotaUpdatedAt: cachedAt,
    })
    loadAccounts.mockResolvedValue(storage([source]))
    checkAccountsQuota.mockResolvedValue([
      {
        index: 0,
        status: "ok",
        quota: {
          groups: { claude: { remainingFraction: 0.2, modelCount: 1 } },
          modelCount: 1,
        },
      },
    ])
    updateAccounts.mockRejectedValueOnce(Object.assign(new Error("write denied: secret-refresh-token"), { code }))
    const dto = await getQuotaPresentation({} as never)
    expect(dto.accounts[0]).toMatchObject({
      status: "ok",
      freshness: "fresh",
      groups: { claude: { remainingFraction: 0.2 } },
    })
    expect(dto.accounts[0]?.checkedAt).toBeGreaterThan(cachedAt)
    expect(loadAccounts).toHaveBeenCalledTimes(2)
    expect(written).toHaveLength(0)
    expect(quotaCacheWarn).toHaveBeenCalledWith("Failed to persist quota snapshots; reloading account state")
    expect(JSON.stringify(quotaCacheWarn.mock.calls)).not.toContain("secret-refresh-token")
  })

  it.each(["delete", "reconnect", "newer check", "disable", "unreadable"])(
    "preserves concurrent %s after cache-write failure",
    async (change) => {
      const source = account({
        id: "stable",
        cachedQuota: { claude: { remainingFraction: 0.9, modelCount: 1 } },
        cachedQuotaUpdatedAt: clockNow - 1000,
      })
      loadAccounts.mockResolvedValue(storage([source]))
      checkAccountsQuota.mockImplementationOnce(async () => {
        const current =
          change === "delete"
            ? []
            : [
                {
                  ...source,
                  ...(change === "reconnect" ? { refreshToken: "new-login-token" } : {}),
                  ...(change === "newer check" ? { cachedQuotaUpdatedAt: clockNow + 1000 } : {}),
                  ...(change === "disable" ? { enabled: false } : {}),
                },
              ]
        loadAccounts.mockResolvedValue(change === "unreadable" ? null : storage(current))
        return [
          {
            index: 0,
            status: "ok",
            quota: { groups: { claude: { remainingFraction: 0.2, modelCount: 1 } }, modelCount: 1 },
          },
        ]
      })
      updateAccounts.mockRejectedValueOnce(new Error("write denied"))
      const dto = await getQuotaPresentation({} as never)
      expect(written).toHaveLength(0)
      if (change === "delete" || change === "unreadable") expect(dto.accounts).toHaveLength(0)
      if (change === "reconnect" || change === "newer check")
        expect(dto.accounts[0]?.groups.claude?.remainingFraction).toBe(0.9)
      if (change === "disable")
        expect(dto.accounts[0]).toMatchObject({ enabled: false, groups: { claude: { remainingFraction: 0.2 } } })
      expect(JSON.stringify(dto)).not.toContain("new-login-token")
    },
  )

  it("persists successful quota so a new cache-only read retains the bars", async () => {
    loadAccounts.mockResolvedValue(storage([baseAccounts()[0]!]))
    checkAccountsQuota.mockResolvedValue([
      {
        index: 0,
        status: "ok",
        quota: {
          groups: {
            claude: { remainingFraction: 0, modelCount: 1 },
            "gemini-pro": { remainingFraction: 1, modelCount: 1, resetTime: "2030-01-02T03:04:05Z" },
          },
          modelCount: 2,
        },
      },
    ])
    const fresh = await getQuotaPresentation({} as never)
    const saved = written.at(-1)
    expect(saved).toBeDefined()
    loadAccounts.mockResolvedValue(saved)
    checkAccountsQuota.mockClear()
    const reopened = await getQuotaPresentation({} as never, { refresh: false })
    expect(reopened.accounts[0]?.groups).toEqual(fresh.accounts[0]?.groups)
    expect(reopened.accounts[0]?.checkedAt).toBe(fresh.accounts[0]?.checkedAt)
    expect(checkAccountsQuota).not.toHaveBeenCalled()
  })

  it("persists grouped quota independently when the per-model probe fails", async () => {
    loadAccounts.mockResolvedValue(storage([account({ id: "stable" })]))
    checkAccountsQuota.mockResolvedValue([
      {
        index: 0,
        status: "ok",
        quota: {
          groups: {},
          modelCount: 0,
          error: "Failed to fetch Antigravity quota",
          quotaSummaryStatus: "ok",
          quotaSummaryGroups: [
            {
              displayName: "Gemini Models",
              description: "Models within this group: Gemini Flash, Gemini Pro",
              buckets: {
                weekly: { remainingFraction: 0.6558833, resetTime: "2026-10-09T18:11:34Z" },
                "5h": { remainingFraction: 1, resetTime: "2026-10-02T23:11:34Z" },
              },
            },
          ],
        },
      },
    ])

    const fresh = await getQuotaPresentation({} as never)
    const saved = written.at(-1)

    expect(fresh.accounts[0]).toMatchObject({
      status: "error",
      quotaSummary: {
        status: "ok",
        freshness: "fresh",
        groups: [
          {
            displayName: "Gemini Models",
            buckets: {
              weekly: { remainingFraction: 0.6558833, resetTime: Date.parse("2026-10-09T18:11:34Z") },
              "5h": { remainingFraction: 1, resetTime: Date.parse("2026-10-02T23:11:34Z") },
            },
          },
        ],
      },
    })
    expect(saved).toMatchObject({
      accounts: [
        {
          cachedQuotaSummary: [{ displayName: "Gemini Models", buckets: { weekly: { remainingFraction: 0.6558833 } } }],
          cachedQuotaSummaryUpdatedAt: expect.any(Number),
        },
      ],
    })

    loadAccounts.mockResolvedValue(saved)
    clockNow = (fresh.accounts[0]?.quotaSummary.checkedAt ?? clockNow) + 1
    checkAccountsQuota.mockResolvedValue([{ index: 0, status: "error", error: "summary unavailable" }])
    const stale = await getQuotaPresentation({} as never, { staleAfterMs: 0 })
    expect(stale.accounts[0]?.quotaSummary).toMatchObject({
      status: "error",
      freshness: "stale",
      groups: [{ displayName: "Gemini Models", buckets: { weekly: { remainingFraction: 0.6558833 } } }],
    })
  })

  it("returns a concurrent newer grouped snapshot instead of an older probe result", async () => {
    clockNow = 1_000
    const olderSummary = [{ displayName: "Older check", buckets: { weekly: { remainingFraction: 0.2 } } }]
    const newerSummary = [{ displayName: "Newer check", buckets: { weekly: { remainingFraction: 0.8 } } }]
    const source = account({
      id: "stable",
      cachedQuotaSummary: olderSummary,
      cachedQuotaSummaryUpdatedAt: 500,
    })
    loadAccounts.mockResolvedValue(storage([source]))
    checkAccountsQuota.mockImplementationOnce(async () => {
      clockNow = 2_000
      loadAccounts.mockResolvedValue(
        storage([
          account({
            ...source,
            cachedQuotaSummary: newerSummary,
            cachedQuotaSummaryUpdatedAt: 2_000,
          }),
        ]),
      )
      return [
        {
          index: 0,
          status: "ok",
          quota: {
            groups: {},
            modelCount: 0,
            quotaSummaryStatus: "ok",
            quotaSummaryGroups: olderSummary,
          },
        },
      ]
    })

    const result = await getQuotaPresentation({} as never)
    expect(result.accounts[0]?.quotaSummary).toMatchObject({
      checkedAt: 2_000,
      freshness: "fresh",
      groups: [{ displayName: "Newer check", buckets: { weekly: { remainingFraction: 0.8 } } }],
    })
  })

  it.each(["delete", "reconnect", "newer check", "disable"])("does not overwrite a concurrent %s", async (change) => {
    const source = account({
      id: "stable",
      cachedQuota: { claude: { remainingFraction: 0.9, modelCount: 1 } },
      cachedQuotaUpdatedAt: clockNow - 1000,
    })
    loadAccounts.mockResolvedValue(storage([source]))
    checkAccountsQuota.mockImplementation(async () => {
      const current =
        change === "delete"
          ? []
          : [
              {
                ...source,
                ...(change === "reconnect" ? { refreshToken: "new-login-token" } : {}),
                ...(change === "newer check" ? { cachedQuotaUpdatedAt: clockNow + 1000 } : {}),
                ...(change === "disable" ? { enabled: false } : {}),
              },
            ]
      loadAccounts.mockResolvedValue(storage(current))
      return [
        {
          index: 0,
          status: "ok",
          quota: { groups: { claude: { remainingFraction: 0.2, modelCount: 1 } }, modelCount: 1 },
        },
      ]
    })
    const dto = await getQuotaPresentation({} as never)
    if (change === "disable") {
      expect(written.at(-1)).toMatchObject({
        accounts: [{ enabled: false, cachedQuota: { claude: { remainingFraction: 0.2 } } }],
      })
    } else expect(written).toHaveLength(0)
    if (change === "delete") expect(dto.accounts).toHaveLength(0)
    if (change === "reconnect" || change === "newer check")
      expect(dto.accounts[0]?.groups.claude?.remainingFraction).toBe(0.9)
  })

  it("does not erase usable saved values with failed or empty readings", async () => {
    loadAccounts.mockResolvedValue(
      storage([account({ id: "stable", cachedQuota: { claude: { remainingFraction: 0.9, modelCount: 1 } } })]),
    )
    checkAccountsQuota.mockResolvedValue([{ index: 0, status: "error" }])
    await getQuotaPresentation({} as never)
    checkAccountsQuota.mockResolvedValue([{ index: 0, status: "ok", quota: { groups: {}, modelCount: 0 } }])
    await getQuotaPresentation({} as never)
    expect(written).toHaveLength(0)
  })

  it("keeps missing quota unknown while preserving a real zero fraction", async () => {
    checkAccountsQuota.mockImplementation(async (accounts: Array<Record<string, unknown>>) => {
      const email = accounts[0]?.email
      return email === "one@example.com"
        ? [
            {
              index: 0,
              status: "ok",
              quota: { groups: { claude: { remainingFraction: 0, resetTime: "2030-01-02T03:04:05Z" } }, modelCount: 1 },
            },
          ]
        : [{ index: 0, status: "ok", quota: { groups: {}, modelCount: 0 } }]
    })

    const dto = await getQuotaPresentation({} as never)

    expect(dto.accounts[0]?.status).toBe("ok")
    expect(dto.accounts[0]?.groups.claude).toEqual({
      remainingFraction: 0,
      consumedPercent: 100,
      resetTime: Date.parse("2030-01-02T03:04:05Z"),
    })
    expect(dto.accounts[0]?.groups["gemini-pro"]).toEqual({
      remainingFraction: null,
      consumedPercent: null,
      resetTime: null,
    })
    expect(dto.accounts[1]?.status).toBe("unknown")
    expect(dto.accounts[1]?.groups.claude?.remainingFraction).toBeNull()
    expect(dto.accounts[1]?.groups.claude?.consumedPercent).toBeNull()
    // Missing quota groups remain unknown rather than appearing exhausted.
    expect(dto.accounts[1]?.groups["gemini-pro"]?.consumedPercent).toBeNull()
  })

  it("marks failed refreshes as errors and cached values stale without leaking tokens", async () => {
    const staleAt = clockNow - 60_000
    loadAccounts.mockResolvedValue(
      storage(
        [
          account({
            id: "cached",
            email: "cached@example.com",
            refreshToken: "secret-refresh-token",
            cachedQuota: { claude: { remainingFraction: 0.25, resetTime: "not-a-date", modelCount: 1 } },
            cachedQuotaUpdatedAt: staleAt,
            verificationRequired: true,
            coolingDownUntil: clockNow + 60_000,
          }),
          account({ id: "failed", email: "failed@example.com", refreshToken: "another-secret" }),
        ],
        0,
        { claude: 0, gemini: 1 },
      ),
    )
    checkAccountsQuota.mockImplementation(async (accounts: Array<Record<string, unknown>>) => {
      if (accounts[0]?.email === "cached@example.com") throw new Error("quota network error")
      return [
        {
          index: 0,
          status: "error",
          error: "refresh failed",
          updatedAccount: account({ refreshToken: "rotated-secret" }),
        },
      ]
    })

    const dto = await getQuotaPresentation({} as never, { staleAfterMs: 1_000 })

    expect(dto.accounts[0]).toMatchObject({
      status: "error",
      freshness: "stale",
      checkedAt: staleAt,
      verificationRequired: true,
      coolingDown: true,
    })
    expect(dto.accounts[0]?.cooldownUntil).toBeGreaterThan(clockNow)
    expect(dto.accounts[0]?.groups.claude).toEqual({ remainingFraction: 0.25, consumedPercent: 75, resetTime: null })
    expect(dto.accounts[1]).toMatchObject({ status: "error", freshness: "unchecked", checkedAt: null })
    expect(JSON.stringify(dto)).not.toContain("secret-refresh-token")
    expect(JSON.stringify(dto)).not.toContain("another-secret")
    expect(JSON.stringify(dto)).not.toContain("rotated-secret")
    expect(JSON.stringify(dto)).not.toContain("updatedAccount")
  })

  it("labels a successful empty response unknown, selects per family, and supports cache-only reads", async () => {
    const cachedAt = clockNow
    loadAccounts.mockResolvedValue(
      storage(
        [
          account({ id: "first", cachedQuota: {}, cachedQuotaUpdatedAt: cachedAt }),
          account({ id: "second", cachedQuota: {}, cachedQuotaUpdatedAt: cachedAt }),
        ],
        0,
        { claude: 1, gemini: 0 },
      ),
    )

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
        return [
          {
            index: 0,
            status: "ok",
            quota: {
              groups: { claude: { remainingFraction: 0.5 }, "gemini-pro": { remainingFraction: 0.75 } },
              modelCount: 2,
            },
          },
        ]
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

  it("maps out-of-range fractions to null instead of clamping them", async () => {
    // Each account is checked with a single-account call, so key the fixture
    // off the input email: one@example.com gets impossible values,
    // two@example.com gets Infinity plus the exact 0/1 boundaries.
    checkAccountsQuota.mockImplementation(async (checked: Array<{ email?: string }>) => {
      const outOfRange = checked[0]?.email !== "two@example.com"
      return [
        {
          index: 0,
          status: "ok",
          quota: {
            groups: outOfRange
              ? {
                  claude: { remainingFraction: 1.5 },
                  "gemini-pro": { remainingFraction: -0.2 },
                  "gemini-flash": { remainingFraction: NaN },
                }
              : {
                  claude: { remainingFraction: Number.POSITIVE_INFINITY },
                  "gemini-pro": { remainingFraction: 1 },
                  "gemini-flash": { remainingFraction: 0 },
                },
            modelCount: 3,
          },
        },
      ]
    })

    const dto = await getQuotaPresentation({} as never)

    expect(dto.accounts[0]?.groups.claude).toEqual({ remainingFraction: null, consumedPercent: null, resetTime: null })
    expect(dto.accounts[0]?.groups["gemini-pro"]?.remainingFraction).toBeNull()
    expect(dto.accounts[0]?.groups["gemini-flash"]?.remainingFraction).toBeNull()
    // Invalid values are unknown, never clamped into a false ok reading.
    expect(dto.accounts[0]?.status).toBe("unknown")
    // Infinite is unknown; exact boundaries 0 and 1 are preserved verbatim.
    expect(dto.accounts[1]?.groups.claude?.remainingFraction).toBeNull()
    expect(dto.accounts[1]?.groups["gemini-pro"]).toEqual({ remainingFraction: 1, consumedPercent: 0, resetTime: null })
    expect(dto.accounts[1]?.groups["gemini-flash"]).toEqual({
      remainingFraction: 0,
      consumedPercent: 100,
      resetTime: null,
    })
    expect(dto.accounts[1]?.status).toBe("ok")
  })

  it("keeps checkedAt at the cached timestamp when a refresh fails over cached data", async () => {
    const cachedAt = clockNow - 30_000
    loadAccounts.mockResolvedValue(
      storage(
        [
          account({
            id: "cached-failed",
            email: "cached-failed@example.com",
            refreshToken: "cached-secret",
            cachedQuota: { claude: { remainingFraction: 0.4, resetTime: "2030-05-01T00:00:00Z", modelCount: 1 } },
            cachedQuotaUpdatedAt: cachedAt,
          }),
        ],
        0,
      ),
    )
    checkAccountsQuota.mockResolvedValue([{ index: 0, status: "error", error: "quota network error" }])

    const dto = await getQuotaPresentation({} as never, { staleAfterMs: 60_000 })

    expect(dto.accounts[0]).toMatchObject({ status: "error", freshness: "fresh", checkedAt: cachedAt })
    expect(dto.accounts[0]?.groups.claude?.remainingFraction).toBe(0.4)
    expect(JSON.stringify(dto)).not.toContain("cached-secret")
  })

  it("treats empty and non-string reset windows as unknown, never as a date", async () => {
    checkAccountsQuota.mockResolvedValue([
      {
        index: 0,
        status: "ok",
        quota: {
          groups: {
            claude: { remainingFraction: 0.5, resetTime: "" },
            "gemini-pro": { remainingFraction: 0.5, resetTime: "   " },
            "gemini-flash": { remainingFraction: 0.5, resetTime: 20300102 },
          },
          modelCount: 3,
        },
      },
    ])

    const dto = await getQuotaPresentation({} as never)

    expect(dto.accounts[0]?.groups.claude?.resetTime).toBeNull()
    expect(dto.accounts[0]?.groups["gemini-pro"]?.resetTime).toBeNull()
    expect(dto.accounts[0]?.groups["gemini-flash"]?.resetTime).toBeNull()
    // Fractions stay known: only the reset window is unknown.
    expect(dto.accounts[0]?.status).toBe("ok")

    // Contrast: a non-OK result carrying the same malformed windows still
    // nulls resets while status stays error — status derivation never
    // depends on reset parsing.
    checkAccountsQuota.mockResolvedValue([
      {
        index: 0,
        status: "error",
        error: "quota fetch failed",
        quota: {
          groups: {
            claude: { remainingFraction: 0.5, resetTime: "" },
          },
          modelCount: 1,
        },
      },
    ])

    const failed = await getQuotaPresentation({} as never)

    expect(failed.accounts[0]?.status).toBe("error")
    expect(failed.accounts[0]?.groups.claude?.resetTime).toBeNull()
  })
})

describe("verifyAccount", () => {
  beforeEach(() => {
    loadAccounts.mockResolvedValue(storage(baseAccounts(), 1))
    verifyAccountAccess.mockResolvedValue({
      status: "blocked",
      message: "verification required",
      verifyUrl: "https://google.test/verify",
    })
  })

  it("marks blocked accounts disabled and records the verification link", async () => {
    const outcome = await verifyAccount({ index: 0 }, {} as never, "antigravity")

    expect(outcome).toMatchObject({
      index: 0,
      email: "one@example.com",
      status: "blocked",
      message: "verification required",
    })
    const writtenBlocked = written[0] as { accounts: Array<Record<string, unknown>> }
    expect(writtenBlocked.accounts[0]).toEqual(
      expect.objectContaining({
        enabled: false,
        verificationRequired: true,
        verificationUrl: "https://google.test/verify",
        lastVerificationStatus: "blocked",
        lastVerificationAt: expect.any(Number),
      }),
    )
    // Unrelated account metadata is preserved.
    expect(writtenBlocked.accounts[1]).toMatchObject({ email: "two@example.com", refreshToken: "token-two" })
  })

  it("clears verification flags on success and re-enables the account", async () => {
    loadAccounts.mockResolvedValue(
      storage(
        [account({ email: "one@example.com", refreshToken: "token-one", enabled: false, verificationRequired: true })],
        0,
      ),
    )
    verifyAccountAccess.mockResolvedValue({ status: "ok", message: "Account verification check passed." })

    const outcome = await verifyAccount({ index: 0 }, {} as never, "antigravity")

    expect(outcome).toMatchObject({ status: "ok", checkedAt: expect.any(Number) })
    const writtenCleared = written[0] as { accounts: Array<Record<string, unknown>> }
    expect(writtenCleared.accounts[0]).toMatchObject({ enabled: true, lastVerificationStatus: "ok" })
    expect(writtenCleared.accounts[0]).not.toHaveProperty("verificationRequired")
  })

  it("records errors without disabling and resolves by durable id", async () => {
    verifyAccountAccess.mockResolvedValue({ status: "error", message: "network unavailable" })

    const outcome = await verifyAccount({ id: "acc-two" }, {} as never, "antigravity")

    expect(outcome).toMatchObject({ index: 1, status: "error" })
    const writtenVerifyError = written[0] as { accounts: Array<Record<string, unknown>> }
    expect(writtenVerifyError.accounts[1]).toMatchObject({ enabled: true, lastVerificationStatus: "error" })
  })

  it("does not write for unresolvable targets", async () => {
    const outcome = await verifyAccount({ index: 8 }, {} as never, "antigravity")

    expect(outcome).toMatchObject({ ok: false })
    expect(updateAccounts).not.toHaveBeenCalled()
  })

  it("fails closed when the target vanishes between verification and write", async () => {
    loadAccounts.mockReset()
    loadAccounts.mockResolvedValueOnce(storage(baseAccounts(), 0))
    loadAccounts.mockResolvedValue(
      storage([account({ id: "acc-two", email: "two@example.com", refreshToken: "token-two" })], 0),
    )
    verifyAccountAccess.mockResolvedValue({ status: "ok", message: "Account verification check passed." })

    const outcome = await verifyAccount({ id: "acc-one" }, {} as never, "antigravity")

    expect(outcome).toMatchObject({ ok: false, kind: "not-found" })
    expect(written).toHaveLength(0)
  })

  it("does not apply a durable target's verification to a re-added account with the same token", async () => {
    loadAccounts.mockResolvedValueOnce(storage([account({ id: "old-id", refreshToken: "same-token" })], 0))
    loadAccounts.mockResolvedValue(storage([account({ id: "new-id", refreshToken: "same-token" })], 0))

    const outcome = await verifyAccount({ id: "old-id" }, {} as never, "antigravity")

    expect(outcome).toMatchObject({ ok: false, kind: "not-found" })
    expect(written).toHaveLength(0)
  })
})

describe("mutateAccount", () => {
  beforeEach(() => {
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

  it("fails closed without writing for stale delete targets", async () => {
    const staleDelete = await mutateAccount({ id: "acc-missing" }, "delete")

    expect(staleDelete).toMatchObject({ ok: false, kind: "not-found", accountCount: 2 })
    expect(written).toHaveLength(0)
  })
})

describe("tombstones", () => {
  beforeEach(() => {
    loadAccounts.mockResolvedValue(storage(baseAccounts(), 1, { claude: 1, gemini: 1 }))
  })

  it("tombstones the removed identity on delete", async () => {
    const outcome = await mutateAccount({ index: 0 }, "delete")

    expect(outcome).toMatchObject({ remaining: 1 })
    const writtenDelete = written[0] as { accounts: unknown[]; removedAccounts: Array<Record<string, unknown>> }
    expect(writtenDelete.accounts).toHaveLength(1)
    expect(writtenDelete.removedAccounts).toHaveLength(1)
    expect(writtenDelete.removedAccounts[0]).toMatchObject({ id: "acc-one", email: "one@example.com" })
    expect(writtenDelete.removedAccounts[0]?.tokenFingerprint).toEqual(expect.any(String))
    expect(JSON.stringify(writtenDelete.removedAccounts)).not.toContain("token-one")
  })

  it("preserves existing tombstones on non-delete mutations", async () => {
    const tombstone = { id: "acc-gone", removedAt: 1 }
    loadAccounts.mockResolvedValue({ ...storage(baseAccounts(), 1), removedAccounts: [tombstone] })

    await mutateAccount({ index: 0 }, "disable")

    const writtenDisable = written[0] as { removedAccounts: unknown }
    expect(writtenDisable.removedAccounts).toEqual([tombstone])
  })

  it("clears the tombstone when the same account is re-added via fresh OAuth", async () => {
    loadAccounts.mockResolvedValue({
      ...storage([account({ id: "acc-two", email: "two@example.com", refreshToken: "token-two" })], 0),
      removedAccounts: [{ id: "acc-one", email: "one@example.com", removedAt: 1 }],
    })

    const outcome = await persistOAuthAccount(
      { refresh: "token-one-fresh", email: "one@example.com", projectId: "p1" },
      "add",
    )

    expect(outcome).toMatchObject({ accountCount: 2, isNew: true })
    const writtenReadd = written[0] as { accounts: Array<{ email: string }>; removedAccounts?: unknown }
    expect(writtenReadd.accounts.map((entry) => entry.email)).toEqual(["two@example.com", "one@example.com"])
    expect(writtenReadd.removedAccounts).toBeUndefined()
  })
})

describe("deleteAllAccounts", () => {
  it("replaces storage with an empty pool and tombstones every identity", async () => {
    vi.clearAllMocks()

    const outcome = await deleteAllAccounts()

    expect(outcome).toEqual({ remaining: 0 })
    expect(written[0]).toEqual({
      version: 4,
      accounts: [],
      activeIndex: 0,
      activeIndexByFamily: { claude: 0, gemini: 0 },
      removedAccounts: [expect.objectContaining({ id: "acc-one" }), expect.objectContaining({ id: "acc-two" })],
    })
    expect(JSON.stringify(written[0])).not.toContain("token-one")
  })
})

describe("persistOAuthAccount", () => {
  beforeEach(() => {
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

  it("reconnects by refresh token even when the email changed", async () => {
    const outcome = await persistOAuthAccount(
      { refresh: "token-one", email: "renamed@example.com", projectId: "p1" },
      "add",
    )

    expect(outcome).toMatchObject({ selectedIndex: 0, accountCount: 2, isNew: false })
    expect(outcome.selectedId).toBe("acc-one")
    const writtenTokenMatch = written[0] as {
      accounts: Array<{ email: string; refreshToken: string; id?: string }>
    }
    expect(writtenTokenMatch.accounts).toHaveLength(2)
    expect(writtenTokenMatch.accounts[0]).toMatchObject({
      id: "acc-one",
      email: "renamed@example.com",
      refreshToken: "token-one",
    })
  })

  it("backfills durable ids for pre-existing accounts on persist", async () => {
    loadAccounts.mockResolvedValue(storage([account({ email: "legacy@example.com", refreshToken: "legacy-token" })], 0))

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
      account({ email: `u${i}@example.com`, refreshToken: `token-${i}` }),
    )
    loadAccounts.mockResolvedValue(storage(full, 0))

    await expect(
      persistOAuthAccount({ refresh: "extra", email: "extra@example.com", projectId: "p" }, "add"),
    ).rejects.toThrow("Maximum of 10 Antigravity accounts reached")
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

describe("persistRefreshRotation", () => {
  beforeEach(() => {
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
    loadAccounts.mockResolvedValue(storage(baseAccounts(), 0))
  })

  it("check_quota passes quota payloads through with credential material redacted", async () => {
    const quotaPayload = {
      index: 0,
      email: "one@example.com",
      status: "ok" as const,
      quota: { groups: {}, modelCount: 0 },
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

    // Quota shape is preserved minus the redacted credential field.
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
      removedAccounts: [expect.objectContaining({ id: "acc-one" }), expect.objectContaining({ id: "acc-two" })],
    })
    expect(setAuth).toHaveBeenCalledWith({ type: "oauth", refresh: "", access: "", expires: 0 })
    expect(invalidateFetch).toHaveBeenCalledOnce()
  })
})
