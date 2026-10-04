import { afterEach, describe, expect, it, vi } from "vitest"
import { createLegacyAccountPool } from "./accounts"
import { legacyInference } from "./inference"
import { AccountManager } from "../../plugin/accounts"

describe("legacy account boundary", () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it("uses the inference quota classification supplied at the boundary", () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"))

    const manager = new AccountManager(undefined, {
      version: 4,
      accounts: [{ refreshToken: "refresh", projectId: "project", addedAt: 1, lastUsed: 0 }],
      activeIndex: 0,
    })
    manager.updateQuotaCache(0, {
      "gemini-pro": { remainingFraction: 0.01, modelCount: 1 },
      "gemini-flash": { remainingFraction: 0.8, modelCount: 1 },
    })

    const classification = legacyInference.classifyModel("gemini-1.5-flash")
    const selected = createLegacyAccountPool(manager).selectForRequest({
      classification: { ...classification, quotaGroup: "gemini-pro" },
      strategy: "sticky",
      pidOffsetEnabled: false,
      softQuotaThresholdPercent: 90,
      softQuotaCacheTtlMs: 10 * 60 * 1000,
    })

    expect(selected).toBeNull()
  })
})
