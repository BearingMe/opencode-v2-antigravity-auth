import { describe, expect, it, vi } from "vitest"
import { createLogger, writeConsoleLog, type LogSink } from "./index"

describe("createLogger", () => {
  it("sends structured events from every level to its sinks", () => {
    const sink = vi.fn<LogSink>()
    const logger = createLogger("antigravity.request", [sink])
    const extra = { status: 429 }

    logger.debug("debug")
    logger.info("info", extra)
    logger.warn("warning")
    logger.error("error")

    expect(sink).toHaveBeenNthCalledWith(1, {
      service: "antigravity.request",
      level: "debug",
      message: "debug",
      extra: undefined,
    })
    expect(sink).toHaveBeenNthCalledWith(2, {
      service: "antigravity.request",
      level: "info",
      message: "info",
      extra,
    })
    expect(sink).toHaveBeenNthCalledWith(3, {
      service: "antigravity.request",
      level: "warn",
      message: "warning",
      extra: undefined,
    })
    expect(sink).toHaveBeenNthCalledWith(4, {
      service: "antigravity.request",
      level: "error",
      message: "error",
      extra: undefined,
    })
  })
})

describe("writeConsoleLog", () => {
  it("routes each level to its matching console method", () => {
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

    debugSpy.mockRestore()
    infoSpy.mockRestore()
    warnSpy.mockRestore()
    errorSpy.mockRestore()
  })
})
