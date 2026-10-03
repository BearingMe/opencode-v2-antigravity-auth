import { describe, expect, it } from "vitest"
import { resolveAntigravityModel, resolveModelWithTier, resolveModelWithVariant } from "./model-resolver"

describe("resolveModelWithTier", () => {
  it("resolves Gemini 3 Pro to Antigravity's default low tier", () => {
    expect(resolveModelWithTier("antigravity-gemini-3-pro")).toMatchObject({
      actualModel: "gemini-3-pro-low",
      thinkingLevel: "low",
      isThinkingModel: true,
    })
  })

  it("resolves Gemini 3 Flash tier suffixes to thinking levels", () => {
    expect(resolveModelWithTier("antigravity-gemini-3-flash-medium")).toMatchObject({
      actualModel: "gemini-3-flash",
      thinkingLevel: "medium",
      tier: "medium",
    })
  })

  it("keeps Gemini 3 aliases on Antigravity model names", () => {
    expect(resolveModelWithTier("gemini-3-pro-high").actualModel).toBe("gemini-3-pro")
    expect(resolveModelWithTier("gemini-3-flash-preview").actualModel).toBe("gemini-3-flash-preview")
  })

  it("resolves Claude thinking tiers to token budgets", () => {
    expect(resolveModelWithTier("claude-opus-4-6-thinking-medium")).toMatchObject({
      actualModel: "claude-opus-4-6-thinking",
      thinkingBudget: 16384,
      tier: "medium",
      isThinkingModel: true,
    })
  })

  it("keeps verified Gemini-prefixed Claude aliases", () => {
    expect(resolveModelWithTier("gemini-claude-sonnet-4-6").actualModel).toBe("claude-sonnet-4-6")
  })

  it("marks image generation models without adding thinking settings", () => {
    expect(resolveModelWithTier("gemini-3-pro-image")).toMatchObject({
      actualModel: "gemini-3-pro-image",
      isImageModel: true,
      isThinkingModel: false,
    })
  })

  it("keeps ordinary model names unchanged", () => {
    expect(resolveModelWithTier("gemini-2.5-pro").actualModel).toBe("gemini-2.5-pro")
  })
})

describe("resolveModelWithVariant", () => {
  it("lets variant budgets override Claude tier suffixes", () => {
    expect(
      resolveModelWithVariant("claude-opus-4-6-thinking-low", {
        thinkingBudget: 24000,
      }),
    ).toMatchObject({
      actualModel: "claude-opus-4-6-thinking",
      thinkingBudget: 24000,
      configSource: "variant",
    })
  })

  it("maps Gemini 3 variant budgets to thinking levels", () => {
    expect(
      resolveModelWithVariant("antigravity-gemini-3-pro", {
        thinkingBudget: 12000,
      }),
    ).toMatchObject({
      actualModel: "gemini-3-pro-medium",
      thinkingLevel: "medium",
      configSource: "variant",
    })
  })

  it("keeps Gemini 2.5 variant budgets numeric", () => {
    expect(
      resolveModelWithVariant("gemini-2.5-pro", {
        thinkingBudget: 20000,
      }),
    ).toMatchObject({
      actualModel: "gemini-2.5-pro",
      thinkingBudget: 20000,
      configSource: "variant",
    })
  })
})

describe("resolveAntigravityModel", () => {
  it.each([
    ["gemini-3-flash-preview", "gemini-3-flash"],
    ["gemini-3-pro-preview", "gemini-3-pro-low"],
    ["gemini-3.1-pro-preview", "gemini-3.1-pro-low"],
    ["gemini-3.1-pro-preview-customtools", "gemini-3.1-pro-low"],
  ])("routes legacy alias %s through Antigravity as %s", (requestedModel, actualModel) => {
    expect(resolveAntigravityModel(requestedModel).actualModel).toBe(actualModel)
  })

  it("preserves supported Gemini and Claude model names", () => {
    expect(resolveAntigravityModel("gemini-3-flash").actualModel).toBe("gemini-3-flash")
    expect(resolveAntigravityModel("claude-opus-4-6-thinking").actualModel).toBe("claude-opus-4-6-thinking")
  })

  it("routes the hardcoded Gemini Flash models to their Antigravity IDs", () => {
    expect(resolveAntigravityModel("antigravity-gemini-3.6-flash")).toMatchObject({
      actualModel: "gemini-3.6-flash",
      thinkingLevel: "low",
    })
    expect(resolveAntigravityModel("antigravity-gemini-3.7-flash")).toMatchObject({
      actualModel: "gemini-3.7-flash",
      thinkingLevel: "low",
    })
    expect(resolveAntigravityModel("antigravity-gemini-3.8-flash")).toMatchObject({
      actualModel: "gemini-3.8-flash-tiered",
      thinkingLevel: "low",
    })
  })

  it("routes the hardcoded Claude and GPT-OSS models without adding variants", () => {
    expect(resolveAntigravityModel("antigravity-claude-sonnet-4-6-thinking")).toMatchObject({
      actualModel: "claude-sonnet-4-6-thinking",
      thinkingBudget: 32768,
    })
    expect(resolveAntigravityModel("antigravity-gpt-oss-120b-medium")).toEqual({
      actualModel: "gpt-oss-120b-medium",
      isThinkingModel: false,
    })
  })
})
