import { describe, expect, it } from "vitest"
import { deriveDebugPolicy } from "./policy"

describe("debug destination policy", () => {
  it("keeps the TUI destination enabled while file debugging remains disabled", () => {
    const policy = deriveDebugPolicy({
      configDebug: false,
      configDebugTui: true,
      envDebugFlag: "",
      envDebugTuiFlag: "1",
    })

    expect(policy).toEqual({
      debugLevel: 0,
      debugEnabled: false,
      debugTuiEnabled: true,
      verboseEnabled: false,
    })
  })

  it("applies verbose file mode without enabling the TUI destination", () => {
    const policy = deriveDebugPolicy({
      configDebug: true,
      configDebugTui: false,
      envDebugFlag: "verbose",
      envDebugTuiFlag: "",
    })

    expect(policy).toEqual({
      debugLevel: 2,
      debugEnabled: true,
      debugTuiEnabled: false,
      verboseEnabled: true,
    })
  })
})
