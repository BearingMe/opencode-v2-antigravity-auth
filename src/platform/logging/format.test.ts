import { describe, expect, it } from "vitest"
import { formatBodyPreviewForLog, formatErrorForLog, truncateTextForLog } from "./format"

describe("logging format helpers", () => {
  it("formats failures defensively and truncates with omitted-length context", () => {
    expect(formatErrorForLog(new Error("request failed"))).toContain("request failed")
    expect(formatErrorForLog({ code: 401 })).toBe('{"code":401}')

    const circular: { self?: unknown } = {}
    circular.self = circular
    expect(formatErrorForLog(circular)).toContain("[object Object]")
    expect(truncateTextForLog("abcdefgh", 5)).toBe("abcde... (truncated 3 chars)")
    expect(truncateTextForLog("short", 10)).toBe("short")
  })

  it("keeps request previews bounded and omits binary and form payloads", () => {
    expect(formatBodyPreviewForLog("abcdef", 3)).toBe("abc... (truncated 3 chars)")
    expect(formatBodyPreviewForLog(new URLSearchParams({ q: "value" }), 100)).toBe("q=value")
    expect(formatBodyPreviewForLog(new Uint8Array([1, 2]), 100)).toBe("[Uint8Array payload omitted]")
  })
})
