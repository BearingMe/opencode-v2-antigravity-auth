import { describe, expect, it } from "vitest"
import { aggregateAccountQuota } from "./aggregate.js"

describe("aggregateAccountQuota", () => {
  it("preserves exhaustion while choosing the lowest fraction and earliest reset per group", () => {
    const summary = aggregateAccountQuota(
      {
        "gemini-3.1-pro": {
          displayName: "Gemini 3.1 Pro",
          remainingFraction: 0.8,
          resetTime: "2026-10-05T12:00:00Z",
        },
        "gemini-3.1-pro-preview": {
          remainingFraction: 0,
          resetTime: "2026-10-04T12:00:00Z",
        },
        "gemini-3.1-flash": { remainingFraction: 0.4 },
        "claude-sonnet": { remainingFraction: 1 },
        "gemini-2.5-pro": { remainingFraction: 0.2 },
      },
      (modelName) => modelName.includes("flash"),
    )

    expect(summary).toEqual({
      groups: {
        "gemini-pro": { remainingFraction: 0, resetTime: "2026-10-04T12:00:00Z", modelCount: 2 },
        "gemini-flash": { remainingFraction: 0.4, resetTime: undefined, modelCount: 1 },
        claude: { remainingFraction: 1, resetTime: undefined, modelCount: 1 },
      },
      modelCount: 4,
    })
  })

  it("keeps classifiable models with unknown fractions distinct from zero", () => {
    const summary = aggregateAccountQuota({ "gemini-3.1-pro": {} }, () => false)

    expect(summary.modelCount).toBe(1)
    expect(summary.groups["gemini-pro"]?.remainingFraction).toBeUndefined()
  })
})
