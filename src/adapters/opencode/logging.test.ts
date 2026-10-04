import { afterEach, describe, expect, it, vi } from "vitest"
import { configureOpenCodeLogging, writeConsoleLog, writeOpenCodeLog } from "./logging"
import type { PluginClient } from "../../plugin/types"

/** Supplies the minimum complete host client accepted by the legacy plugin boundary. */
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

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
  configureOpenCodeLogging(
    createPluginClient(async () => undefined),
    () => false,
  )
})

describe("OpenCode log destination", () => {
  it("sends structured events to the TUI only when its independent flag is enabled", () => {
    const appLog = vi.fn().mockResolvedValue(undefined)
    configureOpenCodeLogging(createPluginClient(appLog), () => true)

    writeOpenCodeLog({
      service: "antigravity.request",
      level: "warn",
      message: "rate limited",
      extra: { status: 429 },
    })

    expect(appLog).toHaveBeenCalledWith({
      body: {
        service: "antigravity.request",
        level: "warn",
        message: "rate limited",
        extra: { status: 429 },
      },
    })

    configureOpenCodeLogging(createPluginClient(appLog), () => false)
    writeOpenCodeLog({ service: "antigravity.request", level: "info", message: "file-only" })
    expect(appLog).toHaveBeenCalledTimes(1)
  })

  it("keeps the console override independent from the host TUI destination", () => {
    const debugSpy = vi.spyOn(console, "debug").mockImplementation(() => {})
    const appLog = vi.fn().mockResolvedValue(undefined)
    vi.stubEnv("OPENCODE_ANTIGRAVITY_CONSOLE_LOG", "true")
    configureOpenCodeLogging(createPluginClient(appLog), () => false)

    writeOpenCodeLog({ service: "antigravity.request", level: "debug", message: "console-only" })

    expect(debugSpy).toHaveBeenCalledWith("[antigravity.request]", "console-only")
    expect(appLog).not.toHaveBeenCalled()
  })

  it("routes console events through the method for their level", () => {
    const debugSpy = vi.spyOn(console, "debug").mockImplementation(() => {})
    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => {})
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {})

    writeConsoleLog("debug", "dbg")
    writeConsoleLog("info", "inf")
    writeConsoleLog("warn", "wrn")
    writeConsoleLog("error", "err")

    expect(debugSpy).toHaveBeenCalledWith("dbg")
    expect(infoSpy).toHaveBeenCalledWith("inf")
    expect(warnSpy).toHaveBeenCalledWith("wrn")
    expect(errorSpy).toHaveBeenCalledWith("err")
  })

  it("does not let a synchronous host failure escape into the logging caller", () => {
    configureOpenCodeLogging(
      createPluginClient(() => {
        throw new Error("host unavailable")
      }),
      () => true,
    )

    expect(() => writeOpenCodeLog({ service: "antigravity", level: "error", message: "best effort" })).not.toThrow()
  })
})
