import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

import { AntigravityConfigSchema, DEFAULT_CONFIG } from "./schema"

describe("removed Gemini CLI routing config", () => {
  it("does not expose legacy routing options", () => {
    expect(DEFAULT_CONFIG).not.toHaveProperty("cli_first")
    expect(DEFAULT_CONFIG).not.toHaveProperty("quota_fallback")
    expect(AntigravityConfigSchema.safeParse({ cli_first: true }).success).toBe(true)
    expect(AntigravityConfigSchema.safeParse({ quota_fallback: true }).success).toBe(true)
  })
})

describe("claude_prompt_auto_caching config", () => {
  it("includes claude_prompt_auto_caching default in DEFAULT_CONFIG", () => {
    expect(DEFAULT_CONFIG).toHaveProperty("claude_prompt_auto_caching", false)
  })

  it("documents claude_prompt_auto_caching in the JSON schema", () => {
    const schemaPath = new URL("../../../assets/antigravity.schema.json", import.meta.url)
    const schema = JSON.parse(readFileSync(schemaPath, "utf8")) as {
      properties?: Record<string, { type?: string; default?: unknown; description?: string }>
    }

    const claudePromptAutoCaching = schema.properties?.claude_prompt_auto_caching
    expect(claudePromptAutoCaching).toBeDefined()
    expect(claudePromptAutoCaching).toMatchObject({
      type: "boolean",
      default: false,
    })
    expect(typeof claudePromptAutoCaching?.description).toBe("string")
    expect(claudePromptAutoCaching?.description?.length ?? 0).toBeGreaterThan(0)
  })
})

describe("auto_resume default", () => {
  it("defaults to false in DEFAULT_CONFIG", () => {
    expect(DEFAULT_CONFIG).toHaveProperty("auto_resume", false)
  })

  it("matches the Zod schema default", () => {
    const parsed = AntigravityConfigSchema.parse({})
    expect(parsed.auto_resume).toBe(false)
    expect(DEFAULT_CONFIG.auto_resume).toBe(parsed.auto_resume)
  })
})
