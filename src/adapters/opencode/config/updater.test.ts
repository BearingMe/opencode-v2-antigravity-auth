import * as fs from "node:fs"
import * as path from "node:path"
import * as os from "node:os"
import { Schema } from "effect"
import { Info as ConfigInfo } from "@opencode/schema/config"
import { describe, test, expect, beforeEach, afterEach } from "vitest"
import { updateOpencodeConfig } from "./updater.js"
import { OPENCODE_MODEL_DEFINITIONS } from "./models.js"

/**
 * Creates a unique temporary directory with the given prefix.
 */
function createTempDir(prefix = "opencode-test-"): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix))
}

describe("updateOpencodeConfig", () => {
  let tempDir: string
  let configPath: string
  let originalXdgConfigHome: string | undefined

  beforeEach(() => {
    originalXdgConfigHome = process.env.XDG_CONFIG_HOME
    // Create a temporary directory for each test
    tempDir = createTempDir()
    configPath = path.join(tempDir, "opencode.json")
  })

  afterEach(() => {
    if (originalXdgConfigHome === undefined) {
      delete process.env.XDG_CONFIG_HOME
    } else {
      process.env.XDG_CONFIG_HOME = originalXdgConfigHome
    }

    // Clean up temp directory
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true })
    }
  })

  test("creates new config with default structure when file does not exist", async () => {
    const result = await updateOpencodeConfig({ configPath })

    expect(result.success).toBe(true)
    expect(result.configPath).toBe(configPath)
    expect(fs.existsSync(configPath)).toBe(true)

    // Verify written config has correct structure
    const writtenConfig = JSON.parse(fs.readFileSync(configPath, "utf-8"))
    expect(writtenConfig.$schema).toBe("https://opencode.ai/config.json")
    expect(writtenConfig.plugins).toContain("opencode-v2-antigravity-auth@latest")
    expect(writtenConfig.providers?.antigravity?.models).toBeDefined()
  })

  test("replaces Antigravity models and leaves Google provider settings unchanged", async () => {
    const existingConfig = {
      $schema: "https://opencode.ai/config.json",
      plugins: ["opencode-v2-antigravity-auth@latest"],
      providers: {
        google: {
          models: {
            "gemini-2.5-flash": { name: "Google Gemini" },
          },
          apiKey: "google-key",
        },
        antigravity: {
          models: {
            "old-model": { name: "Old Model" },
          },
        },
      },
    }
    fs.writeFileSync(configPath, JSON.stringify(existingConfig))

    const result = await updateOpencodeConfig({ configPath })

    expect(result.success).toBe(true)

    const writtenConfig = JSON.parse(fs.readFileSync(configPath, "utf-8"))
    expect(writtenConfig.providers.google).toEqual(existingConfig.providers.google)
    expect(writtenConfig.providers.antigravity.models["old-model"]).toBeUndefined()
    expect(writtenConfig.providers.antigravity.models["antigravity-gemini-3.8-flash"]).toBeDefined()
    expect(writtenConfig.providers.antigravity.models["antigravity-claude-sonnet-4-6-thinking"]).toBeDefined()
  })

  test("preserves non-google provider sections", async () => {
    const existingConfig = {
      $schema: "https://opencode.ai/config.json",
      plugins: ["opencode-v2-antigravity-auth@latest"],
      providers: {
        google: {
          models: { "old-model": {} },
        },
        anthropic: {
          apiKey: "secret-key",
          models: { "claude-3": {} },
        },
        openai: {
          models: { "gpt-4": {} },
        },
      },
    }
    fs.writeFileSync(configPath, JSON.stringify(existingConfig))

    const result = await updateOpencodeConfig({ configPath })

    expect(result.success).toBe(true)

    const writtenConfig = JSON.parse(fs.readFileSync(configPath, "utf-8"))
    // Non-google providers should be preserved
    expect(writtenConfig.providers.anthropic).toEqual(existingConfig.providers.anthropic)
    expect(writtenConfig.providers.openai).toEqual(existingConfig.providers.openai)
  })

  test("preserves $schema and other top-level config keys", async () => {
    const existingConfig = {
      $schema: "https://opencode.ai/config.json",
      plugins: ["opencode-v2-antigravity-auth@latest", "other-plugin"],
      theme: "dark",
      customSetting: { nested: true },
      providers: {
        google: { models: {} },
      },
    }
    fs.writeFileSync(configPath, JSON.stringify(existingConfig))

    const result = await updateOpencodeConfig({ configPath })

    expect(result.success).toBe(true)

    const writtenConfig = JSON.parse(fs.readFileSync(configPath, "utf-8"))
    expect(writtenConfig.$schema).toBe("https://opencode.ai/config.json")
    expect(writtenConfig.plugins).toContain("other-plugin")
    expect(writtenConfig.theme).toBe("dark")
    expect(writtenConfig.customSetting).toEqual({ nested: true })
  })

  test("adds plugin to existing plugin array if not present", async () => {
    const existingConfig = {
      plugins: ["other-plugin"],
      providers: {},
    }
    fs.writeFileSync(configPath, JSON.stringify(existingConfig))

    const result = await updateOpencodeConfig({ configPath })

    expect(result.success).toBe(true)

    const writtenConfig = JSON.parse(fs.readFileSync(configPath, "utf-8"))
    expect(writtenConfig.plugins).toContain("opencode-v2-antigravity-auth@latest")
    expect(writtenConfig.plugins).toContain("other-plugin")
  })

  test("preserves object-form plugin entries and adds Antigravity", async () => {
    const localPlugin = { package: "./local-plugin", options: { enabled: true } }
    fs.writeFileSync(configPath, JSON.stringify({ plugins: [localPlugin], providers: {} }))

    const result = await updateOpencodeConfig({ configPath })

    expect(result.success).toBe(true)
    const writtenConfig = JSON.parse(fs.readFileSync(configPath, "utf-8"))
    expect(writtenConfig.plugins).toContainEqual(localPlugin)
    expect(writtenConfig.plugins).toContain("opencode-v2-antigravity-auth@latest")
  })

  test("does not duplicate an existing object-form Antigravity plugin entry", async () => {
    const antigravityPlugin = { package: "opencode-v2-antigravity-auth@beta", options: { debug: true } }
    fs.writeFileSync(configPath, JSON.stringify({ plugins: [antigravityPlugin], providers: {} }))

    const result = await updateOpencodeConfig({ configPath })

    expect(result.success).toBe(true)
    const writtenConfig = JSON.parse(fs.readFileSync(configPath, "utf-8"))
    expect(writtenConfig.plugins).toEqual([antigravityPlugin])
  })

  test("does not duplicate plugin if already present", async () => {
    const existingConfig = {
      plugins: ["opencode-v2-antigravity-auth@latest", "other-plugin"],
      providers: {},
    }
    fs.writeFileSync(configPath, JSON.stringify(existingConfig))

    const result = await updateOpencodeConfig({ configPath })

    expect(result.success).toBe(true)

    const writtenConfig = JSON.parse(fs.readFileSync(configPath, "utf-8"))
    const pluginCount = writtenConfig.plugins.filter((p: string) => p.includes("opencode-v2-antigravity-auth")).length
    expect(pluginCount).toBe(1)
  })

  test("does not duplicate plugin if different version present", async () => {
    const existingConfig = {
      plugins: ["opencode-v2-antigravity-auth@beta", "other-plugin"],
      providers: {},
    }
    fs.writeFileSync(configPath, JSON.stringify(existingConfig))

    const result = await updateOpencodeConfig({ configPath })

    expect(result.success).toBe(true)

    const writtenConfig = JSON.parse(fs.readFileSync(configPath, "utf-8"))
    const pluginCount = writtenConfig.plugins.filter((p: string) => p.includes("opencode-v2-antigravity-auth")).length
    // Should not add another version if one exists
    expect(pluginCount).toBe(1)
    // Should preserve the existing version
    expect(writtenConfig.plugins).toContain("opencode-v2-antigravity-auth@beta")
  })

  test("writes config with proper JSON formatting (2-space indent)", async () => {
    const result = await updateOpencodeConfig({ configPath })

    expect(result.success).toBe(true)

    const writtenContent = fs.readFileSync(configPath, "utf-8")
    // Should have newlines and 2-space indentation
    expect(writtenContent).toContain("\n")
    expect(writtenContent).toMatch(/^\{\n {2}/)
  })

  test("returns error result on invalid JSON in existing config", async () => {
    fs.writeFileSync(configPath, "{ invalid json }")

    const result = await updateOpencodeConfig({ configPath })

    expect(result.success).toBe(false)
    expect(result.error).toBeDefined()
  })

  test("includes all model definitions from OPENCODE_MODEL_DEFINITIONS", async () => {
    const result = await updateOpencodeConfig({ configPath })

    expect(result.success).toBe(true)

    const writtenConfig = JSON.parse(fs.readFileSync(configPath, "utf-8"))
    const models = writtenConfig.providers.antigravity.models

    expect(() => Schema.decodeUnknownSync(ConfigInfo)(writtenConfig)).not.toThrow()

    // Verify all models from OPENCODE_MODEL_DEFINITIONS are included
    for (const modelKey of Object.keys(OPENCODE_MODEL_DEFINITIONS)) {
      expect(models[modelKey]).toBeDefined()
    }
    expect(models["antigravity-gemini-3.1-pro"].variants).toEqual([
      { id: "low", settings: { thinkingLevel: "low" } },
      { id: "high", settings: { thinkingLevel: "high" } },
    ])
    expect(models["antigravity-gemini-3.1-pro"].capabilities).toEqual({
      tools: true,
      input: ["text", "image", "pdf"],
      output: ["text"],
    })
    expect(Object.keys(models).sort()).toEqual(Object.keys(OPENCODE_MODEL_DEFINITIONS).sort())
  })

  test("parses existing jsonc config files with comments and trailing commas", async () => {
    const jsoncPath = path.join(tempDir, "opencode.jsonc")
    const existingJsoncConfig = `{
  // Keep existing plugins
  "plugins": [
    "other-plugin",
  ],
  "providers": {
    "antigravity": {
      "region": "us-central1",
    },
  },
}`
    fs.writeFileSync(jsoncPath, existingJsoncConfig)

    const result = await updateOpencodeConfig({ configPath: jsoncPath })

    expect(result.success).toBe(true)
    expect(result.configPath).toBe(jsoncPath)

    const writtenConfig = JSON.parse(fs.readFileSync(jsoncPath, "utf-8"))
    expect(writtenConfig.plugins).toContain("other-plugin")
    expect(writtenConfig.plugins).toContain("opencode-v2-antigravity-auth@latest")
    expect(writtenConfig.providers.antigravity.region).toBe("us-central1")
    expect(writtenConfig.providers.antigravity.models["antigravity-gemini-3.8-flash"]).toBeDefined()
  })

  test("prefers existing opencode.jsonc when using default config path", async () => {
    const opencodeDir = path.join(tempDir, "opencode")
    const jsonPath = path.join(opencodeDir, "opencode.json")
    const jsoncPath = path.join(opencodeDir, "opencode.jsonc")

    fs.mkdirSync(opencodeDir, { recursive: true })
    fs.writeFileSync(jsoncPath, JSON.stringify({ plugins: ["other-plugin"], providers: {} }, null, 2))
    process.env.XDG_CONFIG_HOME = tempDir

    const result = await updateOpencodeConfig()

    expect(result.success).toBe(true)
    expect(result.configPath).toBe(jsoncPath)
    expect(fs.existsSync(jsonPath)).toBe(false)
    expect(fs.existsSync(jsoncPath)).toBe(true)
  })

  test("creates parent directory if it does not exist", async () => {
    const nestedPath = path.join(tempDir, "nested", "dir", "opencode.json")

    const result = await updateOpencodeConfig({ configPath: nestedPath })

    expect(result.success).toBe(true)
    expect(fs.existsSync(nestedPath)).toBe(true)
  })

  test("adds $schema if missing from existing config", async () => {
    const existingConfig = {
      plugins: ["opencode-v2-antigravity-auth@latest"],
      providers: { google: {} },
    }
    fs.writeFileSync(configPath, JSON.stringify(existingConfig))

    const result = await updateOpencodeConfig({ configPath })

    expect(result.success).toBe(true)

    const writtenConfig = JSON.parse(fs.readFileSync(configPath, "utf-8"))
    expect(writtenConfig.$schema).toBe("https://opencode.ai/config.json")
  })

  test("preserves other Antigravity provider settings besides models", async () => {
    const existingConfig = {
      plugins: ["opencode-v2-antigravity-auth@latest"],
      providers: {
        antigravity: {
          apiKey: "test-key",
          models: { "old-model": {} },
          customSetting: true,
        },
      },
    }
    fs.writeFileSync(configPath, JSON.stringify(existingConfig))

    const result = await updateOpencodeConfig({ configPath })

    expect(result.success).toBe(true)

    const writtenConfig = JSON.parse(fs.readFileSync(configPath, "utf-8"))
    // Other google settings should be preserved
    expect(writtenConfig.providers.antigravity.apiKey).toBe("test-key")
    expect(writtenConfig.providers.antigravity.customSetting).toBe(true)
    expect(writtenConfig.providers.antigravity.models["old-model"]).toBeUndefined()
  })
})
