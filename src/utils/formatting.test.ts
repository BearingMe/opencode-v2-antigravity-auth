import { describe, expect, it } from "vitest"

import { formatDuration, formatPercentage, formatProgressBarParts, splitDuration } from "./formatting.ts"

describe("formatPercentage", () => {
  it("formats whole percentages by default", () => {
    expect(formatPercentage(0)).toBe("0%")
    expect(formatPercentage(0.6558833)).toBe("66%")
    expect(formatPercentage(1)).toBe("100%")
  })

  it("supports fixed decimal places", () => {
    expect(formatPercentage(0.6558833, 2)).toBe("65.59%")
    expect(formatPercentage(1, 2)).toBe("100.00%")
  })

  it("returns undefined for invalid fractions or precision", () => {
    for (const fraction of [null, undefined, -0.1, 1.1, NaN, Number.POSITIVE_INFINITY]) {
      expect(formatPercentage(fraction)).toBeUndefined()
    }
    expect(formatPercentage(0.5, -1)).toBeUndefined()
    expect(formatPercentage(0.5, 1.5)).toBeUndefined()
    expect(formatPercentage(0.5, 101)).toBeUndefined()
  })
})

describe("formatProgressBarParts", () => {
  it("renders valid fractions using the requested width", () => {
    expect(formatProgressBarParts(0.5, 10)).toEqual({ bar: "█████░░░░░", percentage: "50%" })
  })

  it("uses the default width for invalid widths", () => {
    expect(formatProgressBarParts(0, 0).bar).toBe("░".repeat(12))
    expect(formatProgressBarParts(1, 1.5).bar).toBe("█".repeat(12))
  })

  it("renders invalid fractions as unknown without filling the bar", () => {
    expect(formatProgressBarParts(null, 3)).toEqual({ bar: "░░░", percentage: "unknown" })
    expect(formatProgressBarParts(1.5)).toEqual({ bar: "░".repeat(12), percentage: "unknown" })
  })
})

describe("splitDuration", () => {
  it("returns whole days, hours, and minutes from elapsed milliseconds", () => {
    expect(splitDuration(25 * 3_600_000 + 2 * 60_000 + 59_000)).toEqual({ days: 1, hours: 1, minutes: 2 })
  })
})

describe("formatDuration", () => {
  it("formats retry waits with the existing compact units", () => {
    expect(formatDuration(500)).toBe("500ms")
    expect(formatDuration(1000)).toBe("1s")
    expect(formatDuration(1501)).toBe("2s")
    expect(formatDuration(5000)).toBe("5s")
    expect(formatDuration(60_000)).toBe("1m")
    expect(formatDuration(90_000)).toBe("1m 30s")
    expect(formatDuration(3_600_000)).toBe("1h")
    expect(formatDuration(25 * 3_600_000)).toBe("25h")
  })
})
