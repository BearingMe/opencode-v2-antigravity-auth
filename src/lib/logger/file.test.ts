import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { createTimestampedFileWriter } from "./file"

const { createWriteStreamMock } = vi.hoisted(() => ({
  createWriteStreamMock: vi.fn(),
}))

vi.mock("node:fs", () => ({
  createWriteStream: createWriteStreamMock,
}))

describe("createTimestampedFileWriter", () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2025-01-02T03:04:05.000Z"))
    createWriteStreamMock.mockReset()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it("appends log lines with an ISO timestamp", () => {
    let errorHandler: ((error: Error) => void) | undefined
    const stream = {
      on: vi.fn((_event: string, listener: (error: Error) => void) => {
        errorHandler = listener
      }),
      write: vi.fn(),
    }
    createWriteStreamMock.mockReturnValue(stream)

    const writer = createTimestampedFileWriter("debug.log")
    writer("startup complete")

    expect(createWriteStreamMock).toHaveBeenCalledWith("debug.log", { flags: "a" })
    expect(stream.on).toHaveBeenCalledWith("error", expect.any(Function))
    expect(stream.write).toHaveBeenCalledWith("[2025-01-02T03:04:05.000Z] startup complete\n")
    expect(errorHandler).toBeDefined()
    expect(() => errorHandler?.(new Error("disk full"))).not.toThrow()
  })

  it("does nothing without a path or when the file stream cannot be created", () => {
    const noPathWriter = createTimestampedFileWriter()
    expect(() => noPathWriter("ignored")).not.toThrow()
    expect(createWriteStreamMock).not.toHaveBeenCalled()

    createWriteStreamMock.mockImplementation(() => {
      throw new Error("file unavailable")
    })

    const failedWriter = createTimestampedFileWriter("debug.log")
    expect(() => failedWriter("ignored")).not.toThrow()
  })
})
