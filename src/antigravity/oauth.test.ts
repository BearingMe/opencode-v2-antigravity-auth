import { afterEach, describe, expect, it, vi } from "vitest"
import { exchangeAntigravity } from "./oauth.js"

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("exchangeAntigravity", () => {
  it("returns malformed state as an OAuth failure without contacting Google", async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)

    await expect(exchangeAntigravity("synthetic-code", "not-state")).resolves.toMatchObject({
      type: "failed",
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
