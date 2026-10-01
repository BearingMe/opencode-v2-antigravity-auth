import { describe, expect, it } from "vitest"
import type { HeaderStyle, ModelFamily } from "./accounts"
import { DEFAULT_CONFIG } from "./config/schema"
import { getHeaderStyleFromUrl, resolveHeaderRoutingDecision, resolveQuotaFallbackHeaderStyle } from "./engine"

function decisionConfig(overrides: Record<string, unknown> = {}) {
  return { ...DEFAULT_CONFIG, ...overrides }
}

describe("quota fallback direction", () => {
  it("falls back from gemini-cli to antigravity when alternate quota is available", () => {
    const result = resolveQuotaFallbackHeaderStyle({
      family: "gemini",
      headerStyle: "gemini-cli",
      alternateStyle: "antigravity",
    })

    expect(result).toBe("antigravity")
  })

  it("falls back from antigravity to gemini-cli when alternate quota is available", () => {
    const result = resolveQuotaFallbackHeaderStyle({
      family: "gemini",
      headerStyle: "antigravity",
      alternateStyle: "gemini-cli",
    })

    expect(result).toBe("gemini-cli")
  })

  it("returns null when no alternate quota is available", () => {
    const result = resolveQuotaFallbackHeaderStyle({
      family: "gemini",
      headerStyle: "antigravity",
      alternateStyle: null,
    })

    expect(result).toBeNull()
  })
})

describe("header style resolution", () => {
  it("uses gemini-cli for unsuffixed Gemini models when cli_first is enabled", () => {
    const headerStyle = getHeaderStyleFromUrl(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash:streamGenerateContent",
      "gemini",
      true,
    )

    expect(headerStyle).toBe("gemini-cli")
  })

  it("keeps antigravity for unsuffixed Gemini models when cli_first is disabled", () => {
    const headerStyle = getHeaderStyleFromUrl(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash:streamGenerateContent",
      "gemini",
      false,
    )

    expect(headerStyle).toBe("antigravity")
  })

  it("keeps antigravity for explicit antigravity prefix when cli_first is enabled", () => {
    const headerStyle = getHeaderStyleFromUrl(
      "https://generativelanguage.googleapis.com/v1beta/models/antigravity-gemini-3-flash:streamGenerateContent",
      "gemini",
      true,
    )

    expect(headerStyle).toBe("antigravity")
  })

  it("keeps antigravity for Claude when cli_first is enabled", () => {
    const headerStyle = getHeaderStyleFromUrl(
      "https://generativelanguage.googleapis.com/v1beta/models/claude-opus-4-6-thinking:streamGenerateContent",
      "claude",
      true,
    )

    expect(headerStyle).toBe("antigravity")
  })
})

describe("header routing decision", () => {
  it("defaults to antigravity-first for unsuffixed Gemini when cli_first is disabled", () => {
    const decision = resolveHeaderRoutingDecision(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash:streamGenerateContent",
      "gemini",
      decisionConfig({
        cli_first: false,
      }),
    )

    expect(decision).toMatchObject({
      cliFirst: false,
      preferredHeaderStyle: "antigravity",
      explicitQuota: false,
      allowQuotaFallback: true,
    })
  })

  it("uses gemini-cli-first for unsuffixed Gemini when cli_first is enabled", () => {
    const decision = resolveHeaderRoutingDecision(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash:streamGenerateContent",
      "gemini",
      decisionConfig({
        cli_first: true,
      }),
    )

    expect(decision).toMatchObject({
      cliFirst: true,
      preferredHeaderStyle: "gemini-cli",
      explicitQuota: false,
      allowQuotaFallback: true,
    })
  })

  it("keeps explicit antigravity prefix as primary route while fallback remains available", () => {
    const decision = resolveHeaderRoutingDecision(
      "https://generativelanguage.googleapis.com/v1beta/models/antigravity-gemini-3-flash:streamGenerateContent",
      "gemini",
      decisionConfig({
        cli_first: true,
      }),
    )

    expect(decision).toMatchObject({
      cliFirst: true,
      preferredHeaderStyle: "antigravity",
      explicitQuota: true,
      allowQuotaFallback: true,
    })
  })

  it("ignores legacy quota_fallback when deciding Gemini fallback availability", () => {
    const decision = resolveHeaderRoutingDecision(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash:streamGenerateContent",
      "gemini",
      decisionConfig({
        cli_first: false,
        quota_fallback: false,
      }),
    )

    expect(decision).toMatchObject({
      cliFirst: false,
      preferredHeaderStyle: "antigravity",
      explicitQuota: false,
      allowQuotaFallback: true,
    })
  })
})
