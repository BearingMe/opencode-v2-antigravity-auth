import { afterEach, describe, expect, it, vi } from "vitest"

import { addJitter, randomDelay, sleep } from "./timing.ts"

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe("sleep", () => {
  it("resolves after the requested delay", async () => {
    vi.useFakeTimers()
    const pending = sleep(100)

    await vi.advanceTimersByTimeAsync(99)
    expect(vi.getTimerCount()).toBe(1)

    await vi.advanceTimersByTimeAsync(1)
    await expect(pending).resolves.toBeUndefined()
    expect(vi.getTimerCount()).toBe(0)
  })

  it("rejects immediately when the signal is already aborted", async () => {
    const controller = new AbortController()
    const reason = new Error("cancelled")
    controller.abort(reason)

    await expect(sleep(100, controller.signal)).rejects.toBe(reason)
  })

  it("clears the timer when aborted", async () => {
    vi.useFakeTimers()
    const controller = new AbortController()
    const pending = sleep(100, controller.signal)
    const reason = new Error("cancelled")

    controller.abort(reason)

    await expect(pending).rejects.toBe(reason)
    expect(vi.getTimerCount()).toBe(0)
  })
})

describe("addJitter", () => {
  it("defaults to a 30 percent range and rounds the result", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.5)
    expect(addJitter(1001)).toBe(1001)

    vi.mocked(Math.random).mockReturnValue(0)
    expect(addJitter(1000)).toBe(700)

    vi.mocked(Math.random).mockReturnValue(0.9999)
    expect(addJitter(1000)).toBe(1300)
  })

  it("does not return a negative delay", () => {
    vi.spyOn(Math, "random").mockReturnValue(0)
    expect(addJitter(10, 2)).toBe(0)
  })
})

describe("randomDelay", () => {
  it("includes both range endpoints", () => {
    vi.spyOn(Math, "random").mockReturnValue(0)
    expect(randomDelay(100, 500)).toBe(100)

    vi.mocked(Math.random).mockReturnValue(0.9999)
    expect(randomDelay(100, 500)).toBe(500)
  })

  it("returns the same value when both bounds match", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.5)
    expect(randomDelay(100, 100)).toBe(100)
  })
})
