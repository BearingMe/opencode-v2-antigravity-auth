import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { loadConfig } from "./loader"

const ENV_KEYS = [
  "OPENCODE_ANTIGRAVITY_QUIET",
  "OPENCODE_ANTIGRAVITY_TOAST_SCOPE",
  "OPENCODE_ANTIGRAVITY_DEBUG",
  "OPENCODE_ANTIGRAVITY_DEBUG_TUI",
  "OPENCODE_ANTIGRAVITY_LOG_DIR",
  "OPENCODE_ANTIGRAVITY_KEEP_THINKING",
  "OPENCODE_ANTIGRAVITY_ACCOUNT_SELECTION_STRATEGY",
  "OPENCODE_ANTIGRAVITY_PID_OFFSET_ENABLED",
  "OPENCODE_ANTIGRAVITY_SCHEDULING_MODE",
]

function clearTestEnv(): void {
  for (const key of ENV_KEYS) {
    delete process.env[key]
  }
}

describe("loadConfig env overrides", () => {
  const previousConfigDir = process.env.OPENCODE_CONFIG_DIR
  let configDir = ""
  let projectDir = ""

  beforeEach(() => {
    clearTestEnv()
    configDir = mkdtempSync(join(tmpdir(), "antigravity-config-"))
    projectDir = mkdtempSync(join(tmpdir(), "antigravity-project-"))
    process.env.OPENCODE_CONFIG_DIR = configDir
  })

  afterEach(() => {
    clearTestEnv()
    if (previousConfigDir !== undefined) {
      process.env.OPENCODE_CONFIG_DIR = previousConfigDir
    } else {
      delete process.env.OPENCODE_CONFIG_DIR
    }
    rmSync(configDir, { recursive: true, force: true })
    rmSync(projectDir, { recursive: true, force: true })
  })

  it("returns schema defaults with no files or env", () => {
    const config = loadConfig(projectDir)
    expect(config.quiet_mode).toBe(false)
    expect(config.auto_resume).toBe(false)
    expect(config.toast_scope).toBe("root_only")
    expect(config.scheduling_mode).toBe("cache_first")
  })

  it("applies boolean and enum env overrides", () => {
    process.env.OPENCODE_ANTIGRAVITY_QUIET = "1"
    process.env.OPENCODE_ANTIGRAVITY_TOAST_SCOPE = "all"
    process.env.OPENCODE_ANTIGRAVITY_KEEP_THINKING = "true"
    process.env.OPENCODE_ANTIGRAVITY_SCHEDULING_MODE = "balance"
    const config = loadConfig(projectDir)
    expect(config.quiet_mode).toBe(true)
    expect(config.toast_scope).toBe("all")
    expect(config.keep_thinking).toBe(true)
    expect(config.scheduling_mode).toBe("balance")
  })

  it("lets env win over user and project files", () => {
    writeFileSync(join(configDir, "antigravity.json"), JSON.stringify({ quiet_mode: true }))
    mkdirSync(join(projectDir, ".opencode"), { recursive: true })
    writeFileSync(join(projectDir, ".opencode", "antigravity.json"), JSON.stringify({ quiet_mode: true }))
    process.env.OPENCODE_ANTIGRAVITY_QUIET = "0"
    expect(loadConfig(projectDir).quiet_mode).toBe(false)
  })

  it("ignores invalid env values and keeps file config", () => {
    process.env.OPENCODE_ANTIGRAVITY_QUIET = "maybe"
    process.env.OPENCODE_ANTIGRAVITY_TOAST_SCOPE = "everywhere"
    const config = loadConfig(projectDir)
    expect(config.quiet_mode).toBe(false)
    expect(config.toast_scope).toBe("root_only")
  })
})
