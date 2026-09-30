import { describe, expect, it } from "vitest"
import { formatAccountOneLiner, formatResetCountdown, renderQuotaBar } from "./account-ui-format.js"

describe("renderQuotaBar", () => {
  it("renders null and undefined as unknown", () => {
    expect(renderQuotaBar(null)).toContain("unknown")
    expect(renderQuotaBar(undefined)).toContain("unknown")
  })

  it("preserves exact 0 and 1 boundaries", () => {
    expect(renderQuotaBar(0)).toContain("0%")
    expect(renderQuotaBar(1)).toContain("100%")
  })

  it("renders a mid fraction with percent", () => {
    expect(renderQuotaBar(0.5, 10)).toBe("█████░░░░░ 50%")
  })

  it("treats out-of-range and NaN as unknown, never clamped", () => {
    expect(renderQuotaBar(1.5)).toContain("unknown")
    expect(renderQuotaBar(-0.2)).toContain("unknown")
    expect(renderQuotaBar(NaN)).toContain("unknown")
    expect(renderQuotaBar(Number.POSITIVE_INFINITY)).toContain("unknown")
  })

  it("renders an empty input as an unnamed account", () => {
    expect(formatAccountOneLiner({ email: "" })).toBe("Unnamed account")
  })
})

describe("formatResetCountdown", () => {
  it("returns unknown for null and undefined", () => {
    expect(formatResetCountdown(null)).toBe("reset unknown")
    expect(formatResetCountdown(undefined)).toBe("reset unknown")
  })

  it("formats hours and minutes", () => {
    const now = 1_000_000
    expect(formatResetCountdown(now + 3_700_000, now)).toBe("resets in 1h 1m")
  })

  it("formats minutes-only countdowns", () => {
    const now = 1_000_000
    expect(formatResetCountdown(now + 5 * 60_000, now)).toBe("resets in 5m")
  })

  it("formats sub-minute countdowns without rounding to zero minutes", () => {
    const now = 1_000_000
    expect(formatResetCountdown(now + 30_000, now)).toBe("resets in <1m")
  })

  it("marks past reset times as resetting now", () => {
    const now = 1_000_000
    expect(formatResetCountdown(now - 1, now)).toBe("resetting now")
  })
})

describe("formatAccountOneLiner", () => {
  it("returns the bare email when nothing is flagged", () => {
    expect(formatAccountOneLiner({ email: "one@example.com" })).toBe("one@example.com")
  })

  it("marks selected, disabled, verification, and cooldown states", () => {
    expect(formatAccountOneLiner({
      email: "one@example.com",
      enabled: false,
      active: true,
      verificationRequired: true,
      coolingDown: true,
      status: "error",
    })).toBe("one@example.com [selected] [disabled] [verify required] [cooling down] [quota error]")
  })

  it("marks family-selected accounts without a global cursor", () => {
    expect(formatAccountOneLiner({
      email: "two@example.com",
      selectedByFamily: { claude: false, gemini: true },
    })).toBe("two@example.com [selected]")
  })

  it("marks unknown quota explicitly", () => {
    expect(formatAccountOneLiner({ email: "three@example.com", status: "unknown" }))
      .toBe("three@example.com [quota unknown]")
  })
})
