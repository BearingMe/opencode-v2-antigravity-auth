import { beforeEach, describe, expect, it, vi } from "vitest"

import { AccountManager } from "./account-pool.js"
import type { AccountStorageV4 } from "../../modules/accounts/index.js"

/**
 * Creates a two-account AccountStorageV4 test fixture with optional overrides.
 */
function twoAccountStorage(overrides: Partial<AccountStorageV4> = {}): AccountStorageV4 {
  return {
    version: 4,
    accounts: [
      { refreshToken: "r1", projectId: "p1", addedAt: 1, lastUsed: 0 },
      { refreshToken: "r2", projectId: "p2", addedAt: 1, lastUsed: 0 },
    ],
    activeIndex: 0,
    ...overrides,
  }
}

describe("Antigravity account rotation", () => {
  beforeEach(() => {
    vi.useRealTimers()
  })

  describe("hasOtherAccountAvailable", () => {
    it("returns true when another account has antigravity available", () => {
      const manager = new AccountManager(undefined, twoAccountStorage())
      const accounts = manager.getAccounts()

      // Mark account 0's antigravity as rate-limited
      manager.markRateLimited(accounts[0]!, 60000, "gemini")

      // Account 1 should have antigravity available
      const hasOther = manager.hasOtherAccountAvailable(accounts[0]!.index, "gemini", null)

      expect(hasOther).toBe(true)
    })

    it("returns false when all other accounts are also rate-limited for antigravity", () => {
      const manager = new AccountManager(undefined, twoAccountStorage())
      const accounts = manager.getAccounts()

      // Mark both accounts' antigravity as rate-limited
      manager.markRateLimited(accounts[0]!, 60000, "gemini")
      manager.markRateLimited(accounts[1]!, 60000, "gemini")

      const hasOther = manager.hasOtherAccountAvailable(accounts[0]!.index, "gemini", null)

      expect(hasOther).toBe(false)
    })

    it("skips disabled accounts", () => {
      const stored = twoAccountStorage({
        accounts: [
          { refreshToken: "r1", projectId: "p1", addedAt: 1, lastUsed: 0 },
          { refreshToken: "r2", projectId: "p2", addedAt: 1, lastUsed: 0, enabled: false },
        ],
      })

      const manager = new AccountManager(undefined, stored)
      const accounts = manager.getAccounts()

      // Mark account 0's antigravity as rate-limited
      manager.markRateLimited(accounts[0]!, 60000, "gemini")

      // Account 1 is disabled, so should return false
      const hasOther = manager.hasOtherAccountAvailable(accounts[0]!.index, "gemini", null)

      expect(hasOther).toBe(false)
    })

    it("skips cooling down accounts", () => {
      const manager = new AccountManager(undefined, twoAccountStorage())
      const accounts = manager.getAccounts()

      // Mark account 0's antigravity as rate-limited
      manager.markRateLimited(accounts[0]!, 60000, "gemini")
      // Mark account 1 as cooling down
      manager.markAccountCoolingDown(accounts[1]!, 60000, "auth-failure")

      const hasOther = manager.hasOtherAccountAvailable(accounts[0]!.index, "gemini", null)

      expect(hasOther).toBe(false)
    })

    it("works with model-specific rate limits", () => {
      const manager = new AccountManager(undefined, twoAccountStorage())
      const accounts = manager.getAccounts()

      // Mark account 0's antigravity as rate-limited for gemini-3-pro
      manager.markRateLimited(accounts[0]!, 60000, "gemini", "gemini-3-pro")

      // Account 1 should have antigravity available for gemini-3-pro
      const hasOther = manager.hasOtherAccountAvailable(accounts[0]!.index, "gemini", "gemini-3-pro")

      expect(hasOther).toBe(true)
    })

    it("recognizes other usable Claude accounts too", () => {
      const manager = new AccountManager(undefined, twoAccountStorage())

      const hasOther = manager.hasOtherAccountAvailable(0, "claude", null)

      expect(hasOther).toBe(true)
    })
  })

  describe("Gemini quota exhaustion", () => {
    it("rotates to another account with Antigravity quota", () => {
      const stored = twoAccountStorage({
        activeIndexByFamily: { claude: 0, gemini: 0 },
      })

      const manager = new AccountManager(undefined, stored)
      const accounts = manager.getAccounts()

      manager.markRateLimited(accounts[0]!, 60000, "gemini")
      const nextAccount = manager.getCurrentOrNextForFamily("gemini", null, "sticky")

      expect(nextAccount?.index).toBe(1)
      expect(manager.isRateLimitedForFamily(nextAccount!, "gemini")).toBe(false)
    })

    it("waits when every account is exhausted and ignores old CLI cooldowns", () => {
      const stored = twoAccountStorage({
        activeIndexByFamily: { claude: 0, gemini: 0 },
      })

      const manager = new AccountManager(undefined, stored)
      const accounts = manager.getAccounts()

      manager.markRateLimited(accounts[0]!, 60000, "gemini")
      manager.markRateLimited(accounts[1]!, 60000, "gemini")
      accounts[0]!.rateLimitResetTimes["gemini-cli"] = Date.now() + 120_000

      expect(manager.getCurrentOrNextForFamily("gemini")).toBeNull()
      expect(manager.hasOtherAccountAvailable(0, "gemini", null)).toBe(false)
      expect(manager.getMinWaitTimeForFamily("gemini")).toBeGreaterThan(0)
    })
  })
})
