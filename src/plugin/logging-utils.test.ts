import { describe, expect, it } from "vitest"
import { formatAccountContextLabel, formatAccountLabel } from "./logging-utils"

describe("format helpers", () => {
  it("formats account labels consistently", () => {
    expect(formatAccountLabel("person@example.com", 4)).toBe("person@example.com")
    expect(formatAccountLabel(undefined, 1)).toBe("Account 2")
    expect(formatAccountContextLabel(undefined, -1)).toBe("All accounts")
    expect(formatAccountContextLabel(undefined, 0)).toBe("Account 1")
  })
})
