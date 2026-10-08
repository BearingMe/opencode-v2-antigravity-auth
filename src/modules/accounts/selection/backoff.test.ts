import { describe, expect, it } from "vitest"
import { calculateBackoffMs, parseRateLimitReason } from "./backoff.js"

describe("account failure classification", () => {
  it.each([
    { reason: "QUOTA_EXHAUSTED", message: undefined, status: undefined, expected: "QUOTA_EXHAUSTED" },
    { reason: "quota_exhausted", message: undefined, status: undefined, expected: "QUOTA_EXHAUSTED" },
    { reason: "RATE_LIMIT_EXCEEDED", message: undefined, status: undefined, expected: "RATE_LIMIT_EXCEEDED" },
    { reason: "MODEL_CAPACITY_EXHAUSTED", message: undefined, status: undefined, expected: "MODEL_CAPACITY_EXHAUSTED" },
    {
      reason: undefined,
      message: "service overloaded: quota exhausted",
      status: 429,
      expected: "MODEL_CAPACITY_EXHAUSTED",
    },
    {
      reason: undefined,
      message: "Rate limit exceeded per minute",
      status: undefined,
      expected: "RATE_LIMIT_EXCEEDED",
    },
    { reason: undefined, message: "Quota exhausted for today", status: undefined, expected: "QUOTA_EXHAUSTED" },
    { reason: undefined, message: undefined, status: 503, expected: "MODEL_CAPACITY_EXHAUSTED" },
    { reason: undefined, message: undefined, status: 500, expected: "SERVER_ERROR" },
    { reason: undefined, message: "unclassified", status: 429, expected: "UNKNOWN" },
  ])("classifies $reason / $status with existing precedence", ({ reason, message, status, expected }) => {
    expect(parseRateLimitReason(reason, message, status)).toBe(expected)
  })
})

describe("account retry backoff", () => {
  it("uses server retry hints with the existing two-second floor", () => {
    expect(calculateBackoffMs("QUOTA_EXHAUSTED", 0, 120_000)).toBe(120_000)
    expect(calculateBackoffMs("RATE_LIMIT_EXCEEDED", 0, 500)).toBe(2_000)
  })

  it("escalates quota waits and caps at the final tier", () => {
    expect(calculateBackoffMs("QUOTA_EXHAUSTED", 0)).toBe(60_000)
    expect(calculateBackoffMs("QUOTA_EXHAUSTED", 1)).toBe(300_000)
    expect(calculateBackoffMs("QUOTA_EXHAUSTED", 2)).toBe(1_800_000)
    expect(calculateBackoffMs("QUOTA_EXHAUSTED", 10)).toBe(7_200_000)
  })

  it("keeps capacity jitter at the documented endpoints", () => {
    expect(calculateBackoffMs("MODEL_CAPACITY_EXHAUSTED", 0, undefined, () => 0)).toBe(30_000)
    expect(calculateBackoffMs("MODEL_CAPACITY_EXHAUSTED", 0, undefined, () => 1)).toBe(60_000)
  })

  it.each([
    { reason: "RATE_LIMIT_EXCEEDED" as const, expected: 30_000 },
    { reason: "SERVER_ERROR" as const, expected: 20_000 },
    { reason: "UNKNOWN" as const, expected: 60_000 },
  ])("uses the fixed $reason delay", ({ reason, expected }) => {
    expect(calculateBackoffMs(reason, 0)).toBe(expected)
  })
})
