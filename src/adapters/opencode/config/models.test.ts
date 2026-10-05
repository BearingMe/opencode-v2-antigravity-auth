import { describe, expect, it } from "vitest"

import { OPENCODE_MODEL_DEFINITIONS } from "./models.js"

/** Returns a configured model or fails with the missing model id. */
const getModel = (name: string) => {
  const model = OPENCODE_MODEL_DEFINITIONS[name]
  if (!model) {
    throw new Error(`Missing model definition for ${name}`)
  }
  return model
}

describe("OPENCODE_MODEL_DEFINITIONS", () => {
  it("includes the full set of configured models", () => {
    const modelNames = Object.keys(OPENCODE_MODEL_DEFINITIONS).sort()

    expect(modelNames).toEqual([
      "antigravity-claude-opus-4-6-thinking",
      "antigravity-claude-sonnet-4-6-thinking",
      "antigravity-gemini-3.1-pro",
      "antigravity-gemini-3.6-flash",
      "antigravity-gemini-3.7-flash",
      "antigravity-gemini-3.8-flash",
      "antigravity-gpt-oss-120b-medium",
    ])
  })

  it("defines only the requested thinking variants", () => {
    expect(getModel("antigravity-gemini-3.1-pro").variants).toEqual({
      low: { thinkingLevel: "low" },
      high: { thinkingLevel: "high" },
    })

    for (const modelID of [
      "antigravity-gemini-3.6-flash",
      "antigravity-gemini-3.7-flash",
      "antigravity-gemini-3.8-flash",
    ]) {
      expect(getModel(modelID).variants).toEqual({
        low: { thinkingLevel: "low" },
        medium: { thinkingLevel: "medium" },
        high: { thinkingLevel: "high" },
      })
    }
  })

  it("leaves Claude and GPT-OSS without selectable variants", () => {
    expect(getModel("antigravity-claude-sonnet-4-6-thinking").variants).toBeUndefined()
    expect(getModel("antigravity-claude-opus-4-6-thinking").variants).toBeUndefined()
    expect(getModel("antigravity-gpt-oss-120b-medium").variants).toBeUndefined()

    expect(getModel("antigravity-gpt-oss-120b-medium").modalities).toEqual({
      input: ["text"],
      output: ["text"],
    })
  })

  it("uses the picker labels from the requested model list", () => {
    expect(
      Object.fromEntries(Object.entries(OPENCODE_MODEL_DEFINITIONS).map(([id, model]) => [id, model.name])),
    ).toEqual({
      "antigravity-gemini-3.8-flash": "Gemini 3.8 Flash",
      "antigravity-gemini-3.7-flash": "Gemini 3.7 Flash",
      "antigravity-gemini-3.6-flash": "Gemini 3.6 Flash",
      "antigravity-gemini-3.1-pro": "Gemini 3.1 Pro",
      "antigravity-claude-sonnet-4-6-thinking": "Claude Sonnet 4.6 (Thinking)",
      "antigravity-claude-opus-4-6-thinking": "Claude Opus 4.6 (Thinking)",
      "antigravity-gpt-oss-120b-medium": "GPT-OSS 120B (Medium)",
    })
  })
})
