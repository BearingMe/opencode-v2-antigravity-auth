import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { AccountPoolManager, initHealthTracker, initTokenTracker } from "./index.js"
import type { AccountPoolDependencies } from "./account-pool.js"
import type { AccountStorageV4 } from "./persistence/policy.js"

/** Creates module dependencies backed by an isolated in-memory v4 store and controlled clock. */
function createPoolFixture(
  initial: AccountStorageV4,
  time = 10_000,
): {
  manager: AccountPoolManager
  setTime: (next: number) => void
} {
  let stored = initial
  let now = time
  const dependencies: AccountPoolDependencies = {
    clock: { now: () => now },
    update: async (updater) => {
      const updated = await updater(stored)
      stored = updated.storage
      return updated.result
    },
    fingerprintToken: (token) => `fingerprint:${token}`,
    generateId: () => "synthetic-account-id",
    generateFingerprint: () => ({
      deviceId: "device",
      sessionToken: "session",
      userAgent: "agent",
      apiClient: "client",
      clientMetadata: { ideType: "test", platform: "test", pluginType: "test" },
      createdAt: now,
    }),
    updateFingerprintVersion: () => false,
    processId: 1,
    formatAccountLabel: (_email, index) => `Account ${index + 1}`,
    logSoftQuotaSkipped: () => undefined,
    logSelection: () => undefined,
    random: () => 0.5,
  }

  return {
    manager: new AccountPoolManager(undefined, initial, dependencies),
    setTime: (next) => {
      now = next
    },
  }
}

/** Builds distinct synthetic accounts with stable identities and independent expectations. */
function poolStorage(count: number, activeIndex = 0): AccountStorageV4 {
  return {
    version: 4,
    activeIndex,
    accounts: Array.from({ length: count }, (_, index) => ({
      id: `account-${index}`,
      refreshToken: `refresh-${index}`,
      addedAt: index + 1,
      lastUsed: index + 1,
      enabled: true,
    })),
  }
}

describe("accounts module pool selection", () => {
  beforeEach(() => {
    initHealthTracker({})
    initTokenTracker({})
  })

  afterEach(() => {
    initHealthTracker({})
    initTokenTracker({})
  })

  it("keeps sticky selection and rotates round-robin across eligible members", () => {
    const { manager } = createPoolFixture(poolStorage(3, 1))

    expect(manager.getCurrentOrNextForFamily("gemini", undefined, "sticky")?.index).toBe(1)
    expect(manager.getCurrentOrNextForFamily("gemini", undefined, "sticky")?.index).toBe(1)
    expect(manager.getCurrentOrNextForFamily("claude", undefined, "round-robin")?.index).toBe(1)
    expect(manager.getCurrentOrNextForFamily("claude", undefined, "round-robin")?.index).toBe(2)
    expect(manager.getCurrentOrNextForFamily("claude", undefined, "round-robin")?.index).toBe(0)
  })

  it("returns no account while all candidates are rate limited, then resumes at reset time", () => {
    const { manager, setTime } = createPoolFixture(poolStorage(1))
    const account = manager.getAccounts()[0]
    expect(account).toBeDefined()
    manager.markRateLimited(account!, 2_000, "gemini", "gemini-3-pro")

    expect(manager.getCurrentOrNextForFamily("gemini", "gemini-3-pro", "round-robin")).toBeNull()
    setTime(12_000)
    expect(manager.getCurrentOrNextForFamily("gemini", "gemini-3-pro", "round-robin")?.index).toBe(0)
  })

  it("preserves hybrid stickiness when another eligible account has a marginally higher score", () => {
    const { manager } = createPoolFixture(poolStorage(2, 1))

    expect(manager.getCurrentOrNextForFamily("claude", undefined, "hybrid")?.index).toBe(1)
  })
})
