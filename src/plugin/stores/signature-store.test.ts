import { describe, expect, it } from "vitest"
import { createThoughtBuffer } from "./signature-store"

describe("streamed thought buffer compatibility", () => {
  it("retains thought fragments by provider part index", () => {
    const buffer = createThoughtBuffer()
    buffer.set(3, "first fragment")
    buffer.set(4, "second fragment")

    expect(buffer.get(3)).toBe("first fragment")
    expect(buffer.get(4)).toBe("second fragment")
  })

  it("clears buffered fragments without affecting another buffer", () => {
    const buffer = createThoughtBuffer()
    const other = createThoughtBuffer()
    buffer.set(0, "partial thought")
    other.set(0, "independent thought")

    buffer.clear()

    expect(buffer.get(0)).toBeUndefined()
    expect(other.get(0)).toBe("independent thought")
  })
})
