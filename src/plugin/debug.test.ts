import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { DEFAULT_CONFIG } from "./config"

vi.mock("../adapters/filesystem/debug-log.js", () => ({
  createDebugFileDestination: vi.fn((enabled: boolean, customLogDir?: string) => ({
    filePath: enabled ? `${customLogDir ?? "test-logs"}/antigravity-debug-test.log` : undefined,
    writeLine: vi.fn(),
    close: vi.fn().mockResolvedValue(undefined),
  })),
}))

describe("debug sink policy", () => {
  let originalDebugEnv: string | undefined
  let originalDebugTuiEnv: string | undefined

  beforeEach(() => {
    vi.resetModules()
    originalDebugEnv = process.env.OPENCODE_ANTIGRAVITY_DEBUG
    originalDebugTuiEnv = process.env.OPENCODE_ANTIGRAVITY_DEBUG_TUI
    delete process.env.OPENCODE_ANTIGRAVITY_DEBUG
    delete process.env.OPENCODE_ANTIGRAVITY_DEBUG_TUI
  })

  afterEach(() => {
    const cleanup = import("./debug").then(({ disposeDebugLog }) => disposeDebugLog())
    if (originalDebugEnv === undefined) {
      delete process.env.OPENCODE_ANTIGRAVITY_DEBUG
    } else {
      process.env.OPENCODE_ANTIGRAVITY_DEBUG = originalDebugEnv
    }

    if (originalDebugTuiEnv === undefined) {
      delete process.env.OPENCODE_ANTIGRAVITY_DEBUG_TUI
    } else {
      process.env.OPENCODE_ANTIGRAVITY_DEBUG_TUI = originalDebugTuiEnv
    }
    return cleanup
  })

  it("keeps debug_tui enabled when file debug is disabled in config", async () => {
    const { initializeDebug, isDebugEnabled, isDebugTuiEnabled, getLogFilePath } = await import("./debug")

    initializeDebug({
      ...DEFAULT_CONFIG,
      debug: false,
      debug_tui: true,
    })

    expect(isDebugEnabled()).toBe(false)
    expect(isDebugTuiEnabled()).toBe(true)
    expect(getLogFilePath()).toBeUndefined()
  })

  it("keeps debug_tui enabled when the environment leaves file debug disabled", async () => {
    process.env.OPENCODE_ANTIGRAVITY_DEBUG = "0"
    process.env.OPENCODE_ANTIGRAVITY_DEBUG_TUI = "1"

    const { isDebugEnabled, isDebugTuiEnabled, getLogFilePath } = await import("./debug")

    expect(isDebugEnabled()).toBe(false)
    expect(isDebugTuiEnabled()).toBe(true)
    expect(getLogFilePath()).toBeUndefined()
  })

  it("keeps file debug enabled without TUI when only debug is true", async () => {
    const { initializeDebug, isDebugEnabled, isDebugTuiEnabled, getLogFilePath } = await import("./debug")

    initializeDebug({
      ...DEFAULT_CONFIG,
      debug: true,
      debug_tui: false,
      log_dir: "/tmp/opencode-antigravity-debug-tests",
    })

    expect(isDebugEnabled()).toBe(true)
    expect(isDebugTuiEnabled()).toBe(false)
    expect(getLogFilePath()).toContain("antigravity-debug-")
  })

  it("closes the previous file destination when debug is reinitialized", async () => {
    const { initializeDebug } = await import("./debug")
    const { createDebugFileDestination } = await import("../adapters/filesystem/debug-log.js")
    vi.mocked(createDebugFileDestination).mockClear()

    initializeDebug({ ...DEFAULT_CONFIG, debug: true })
    initializeDebug(DEFAULT_CONFIG)

    expect(createDebugFileDestination).toHaveBeenCalledTimes(2)
    const previousDestination = vi.mocked(createDebugFileDestination).mock.results[0]?.value
    expect(previousDestination?.close).toHaveBeenCalledTimes(1)
  })
})
