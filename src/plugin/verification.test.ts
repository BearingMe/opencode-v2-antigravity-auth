import { describe, expect, it } from "vitest"
import {
  decodeEscapedText,
  extractVerificationErrorDetails,
  normalizeGoogleVerificationUrl,
  selectBestVerificationUrl,
} from "./verification.ts"

describe("verification helpers", () => {
  it("decodes escaped entities in verification text", () => {
    expect(decodeEscapedText("a &amp; b")).toBe("a & b")
    expect(decodeEscapedText("validation\\u005frequired")).toBe("validation_required")
  })

  it("accepts only Google account verification urls", () => {
    expect(normalizeGoogleVerificationUrl("https://accounts.google.com/signin/continue?plt=1")).toContain(
      "accounts.google.com",
    )
    expect(normalizeGoogleVerificationUrl("https://evil.example.com/signin")).toBeUndefined()
    expect(normalizeGoogleVerificationUrl("not a url")).toBeUndefined()
    expect(normalizeGoogleVerificationUrl("  ")).toBeUndefined()
  })

  it("prefers the richest verification url", () => {
    const plain = "https://accounts.google.com/verify"
    const rich = "https://accounts.google.com/signin/continue?plt=1&continue=x&service=cloudcode"
    expect(selectBestVerificationUrl([plain, rich])).toBe(rich)
    expect(selectBestVerificationUrl([])).toBeUndefined()
  })

  it("detects validation_required errors with verify links", () => {
    const extracted = extractVerificationErrorDetails(
      JSON.stringify({
        error: {
          message: "validation_required: verify at https://accounts.google.com/signin/continue?plt=1",
        },
      }),
    )
    expect(extracted.validationRequired).toBe(true)
    expect(extracted.verifyUrl).toContain("accounts.google.com")
  })

  it("detects human-readable verification messages", () => {
    const extracted = extractVerificationErrorDetails("Error 403: please verify your account to continue")
    expect(extracted.validationRequired).toBe(true)
  })

  it("leaves ordinary errors unflagged", () => {
    const extracted = extractVerificationErrorDetails(JSON.stringify({ error: { message: "quota exhausted" } }))
    expect(extracted.validationRequired).toBe(false)
  })
})
