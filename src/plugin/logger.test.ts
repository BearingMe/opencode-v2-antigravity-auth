import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { DEFAULT_CONFIG } from "../adapters/opencode/config/index.js"
import type { PluginClient } from "./types"

vi.mock("../adapters/filesystem/debug-log.js", () => ({
  createDebugFileDestination: vi.fn((enabled: boolean, customLogDir?: string) => ({
    filePath: enabled ? `${customLogDir ?? "test-logs"}/antigravity-debug-test.log` : undefined,
    writeLine: vi.fn(),
    close: vi.fn().mockResolvedValue(undefined),
  })),
}))

/** Builds a complete plugin client with the supplied host log method. */
function createPluginClient(appLog: PluginClient["app"]["log"]): PluginClient {
  return {
    app: { log: appLog },
    auth: { set: async () => undefined },
    session: {
      prompt: async () => undefined,
      abort: async () => undefined,
      messages: async () => undefined,
    },
    tui: { showToast: async () => undefined },
  }
}

describe("logger sink routing", () => {
  beforeEach(() => {
    vi.resetModules()
  })

  afterEach(async () => {
    const { disposeDebugLog } = await import("./debug")
    await disposeDebugLog()
  })

  it("routes logs to TUI when debug_tui is enabled without file debug", async () => {
    const { initializeDebug } = await import("./debug")
    const { createLogger, initLogger } = await import("./logger")

    initializeDebug({
      ...DEFAULT_CONFIG,
      debug: false,
      debug_tui: true,
    })

    const appLog = vi.fn().mockResolvedValue(undefined)
    initLogger(createPluginClient(appLog))

    createLogger("request").debug("thinking-resolution", { status: 429 })

    expect(appLog).toHaveBeenCalledTimes(1)
    expect(appLog).toHaveBeenCalledWith({
      body: {
        service: "antigravity.request",
        level: "debug",
        message: "thinking-resolution",
        extra: { status: 429 },
      },
    })
  })

  it("does not route to TUI when only file debug is enabled", async () => {
    const { initializeDebug } = await import("./debug")
    const { createLogger, initLogger } = await import("./logger")

    initializeDebug({
      ...DEFAULT_CONFIG,
      debug: true,
      debug_tui: false,
      log_dir: "/tmp/opencode-antigravity-logger-tests",
    })

    const appLog = vi.fn().mockResolvedValue(undefined)
    initLogger(createPluginClient(appLog))

    createLogger("request").debug("file-only")

    expect(appLog).not.toHaveBeenCalled()
  })

  it("ignores a rejected host log write without failing the caller", async () => {
    const { initializeDebug } = await import("./debug")
    const { createLogger, initLogger } = await import("./logger")
    initializeDebug({ ...DEFAULT_CONFIG, debug: false, debug_tui: true })
    initLogger(createPluginClient(vi.fn().mockRejectedValue(new Error("host unavailable"))))

    expect(() => createLogger("request").warn("best effort")).not.toThrow()
    await Promise.resolve()
  })
})
