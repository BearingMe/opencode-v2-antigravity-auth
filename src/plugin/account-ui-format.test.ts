import { describe, expect, it } from "vitest"
import {
  formatAccountOneLiner,
  formatResetCountdown,
  quotaDetailLines,
  quotaInfoRows,
  quotaViewPlaceholder,
  renderQuotaBar,
} from "./account-ui-format.js"

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

  it("fills widths beyond the former 40-cell cap", () => {
    expect(renderQuotaBar(0.5, 80)).toBe(`${"█".repeat(40)}${"░".repeat(40)} 50%`)
    expect(renderQuotaBar(null, 80)).toBe(`${"░".repeat(80)} unknown`)
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
    expect(
      formatAccountOneLiner({
        email: "one@example.com",
        enabled: false,
        active: true,
        verificationRequired: true,
        coolingDown: true,
        status: "error",
      }),
    ).toBe("one@example.com [selected] [disabled] [verify required] [cooling down] [quota error]")
  })

  it("marks family-selected accounts without a global cursor", () => {
    expect(
      formatAccountOneLiner({
        email: "two@example.com",
        selectedByFamily: { claude: false, gemini: true },
      }),
    ).toBe("two@example.com [selected]")
  })

  it("marks unknown quota explicitly", () => {
    expect(formatAccountOneLiner({ email: "three@example.com", status: "unknown" })).toBe(
      "three@example.com [quota unknown]",
    )
  })
})

describe("quotaInfoRows", () => {
  it("renders one labeled row per quota group", () => {
    const rows = quotaInfoRows({
      claude: { remainingFraction: 0.5, resetTime: null },
      "gemini-pro": { remainingFraction: null, resetTime: null },
      "gemini-flash": { remainingFraction: 1, resetTime: null },
    })
    expect(rows.map((row) => row.title)).toEqual(["Claude", "Gemini Pro", "Gemini Flash"])
    expect(rows.map((row) => row.value)).toEqual(["quota-row-claude", "quota-row-gemini-pro", "quota-row-gemini-flash"])
    expect(rows[0]?.description).toContain("50%")
    expect(rows[1]?.description).toContain("unknown")
    expect(rows[2]?.description).toContain("100%")
  })

  it("renders missing groups as unknown, never zero", () => {
    const rows = quotaInfoRows({})
    expect(rows).toHaveLength(3)
    for (const row of rows) {
      expect(row.description).toContain("unknown")
      expect(row.description).not.toContain("0%")
    }
  })
})

describe("quotaViewPlaceholder", () => {
  it("states cached data is not live-updated in one short line", () => {
    expect(quotaViewPlaceholder()).toBe("Updates when opened. Not live-updated; ctrl+r to refresh.")
  })
})

describe("quotaDetailLines", () => {
  it("renders one labeled row per quota group plus a status line", () => {
    const lines = quotaDetailLines({
      groups: {
        claude: { remainingFraction: 0.5, resetTime: null },
        "gemini-pro": { remainingFraction: null, resetTime: null },
        "gemini-flash": { remainingFraction: 1, resetTime: null },
      },
      checkedAt: 1_700_000_000_000,
      freshness: "stale",
      status: "ok",
    })
    expect(lines).toHaveLength(4)
    expect(lines[0]).toContain("Claude")
    expect(lines[0]).toContain("50%")
    expect(lines[1]).toContain("unknown")
    expect(lines[2]).toContain("100%")
    expect(lines[3]).toMatch(/^status: ok \(stale, checked: .+\)$/)
  })

  it("renders missing groups as unknown and missing checks explicitly", () => {
    const lines = quotaDetailLines({ groups: {}, checkedAt: null, freshness: "unchecked", status: "unknown" })
    expect(lines).toHaveLength(4)
    for (const line of lines.slice(0, 3)) {
      expect(line).toContain("unknown")
    }
    expect(lines[3]).toContain("never checked")
  })
})
