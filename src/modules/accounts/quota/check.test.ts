import { describe, expect, it, vi } from "vitest"
import { checkAccountQuotas } from "./check.js"
import type { AccountMetadataV3 } from "../persistence/policy.js"

/** Creates a minimal persisted account for quota policy tests. */
function account(email: string): AccountMetadataV3 {
  return { email, refreshToken: `synthetic-${email}`, addedAt: 1, lastUsed: 1 }
}

describe("checkAccountQuotas", () => {
  it("isolates account probe failures and retains partial endpoint results", async () => {
    const logger = { fetch: vi.fn(), status: vi.fn() }
    const results = await checkAccountQuotas([account("failed@example.invalid"), account("ok@example.invalid")], {
      probe: vi
        .fn()
        .mockRejectedValueOnce(new Error("temporary setup failure"))
        .mockResolvedValueOnce({
          models: { "gemini-3.1-pro": { remainingFraction: 0 } },
          modelProbeFailed: false,
          summaryProbeFailed: true,
        }),
      isGeminiFlash: () => false,
      logger,
    })

    expect(results[0]).toMatchObject({ status: "error", error: "temporary setup failure" })
    expect(results[1]).toMatchObject({
      status: "ok",
      quota: {
        groups: { "gemini-pro": { remainingFraction: 0 } },
        quotaSummaryStatus: "error",
      },
    })
  })

  it("keeps primary quota failures distinct from an empty grouped response", async () => {
    const [result] = await checkAccountQuotas([account("quota@example.invalid")], {
      probe: async () => ({
        models: undefined,
        modelProbeFailed: true,
        quotaSummaryGroups: [],
        summaryProbeFailed: false,
      }),
      isGeminiFlash: () => false,
      logger: { fetch: () => undefined, status: () => undefined },
    })

    expect(result).toMatchObject({
      status: "ok",
      quota: {
        modelCount: 0,
        error: "Failed to fetch Antigravity quota",
        quotaSummaryGroups: [],
        quotaSummaryStatus: "unknown",
      },
    })
  })
})
