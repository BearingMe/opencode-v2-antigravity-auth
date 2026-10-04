import { afterEach, describe, expect, it, vi } from "vitest"
import { createVerificationProbeRequest, sendVerificationProbe } from "./verification-client.js"

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe("sendVerificationProbe", () => {
  it("builds the known minimal model probe before request transformation", () => {
    const request = createVerificationProbeRequest(new AbortController().signal)

    expect(String(request.request)).toBe(
      "https://generativelanguage.googleapis.com/v1beta/models/antigravity-gemini-3.1-pro:generateContent",
    )
    expect(request.init.method).toBe("POST")
    expect(JSON.parse(String(request.init.body))).toEqual({
      contents: [{ role: "user", parts: [{ text: "Reply OK" }] }],
      generationConfig: { maxOutputTokens: 16, temperature: 0 },
    })
  })

  it("returns status and body from the Antigravity verification request", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      expect(init?.signal).toBeInstanceOf(AbortSignal)
      return new Response("validation_required", { status: 403, statusText: "Forbidden" })
    })
    vi.stubGlobal("fetch", fetchMock)

    await expect(sendVerificationProbe("https://example.test/probe", { method: "POST" })).resolves.toEqual({
      ok: false,
      status: 403,
      statusText: "Forbidden",
      body: "validation_required",
    })
  })

  it("aborts a stalled probe at its configured timeout", async () => {
    vi.useFakeTimers()
    let started!: () => void
    const requestStarted = new Promise<void>((resolve) => {
      started = resolve
    })
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      started()
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true })
      })
    })
    vi.stubGlobal("fetch", fetchMock)

    const callerSignal = new AbortController().signal
    const pending = sendVerificationProbe("https://example.test/probe", { method: "POST", signal: callerSignal }, 25)
    const rejected = expect(pending).rejects.toThrow("aborted")
    await requestStarted
    await vi.advanceTimersByTimeAsync(25)

    await rejected
  })

  it("keeps caller cancellation active while reading the response body", async () => {
    const caller = new AbortController()
    let requestSignal: AbortSignal | undefined
    let bodyReadStarted!: () => void
    const bodyReadStartedPromise = new Promise<void>((resolve) => {
      bodyReadStarted = resolve
    })
    const response = new Response(null, { status: 403 })
    const bodyRead = vi.spyOn(response, "text").mockImplementation(
      () =>
        new Promise<string>((_resolve, reject) => {
          bodyReadStarted()
          requestSignal?.addEventListener("abort", () => reject(new DOMException("body aborted", "AbortError")), {
            once: true,
          })
        }),
    )
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        requestSignal = init?.signal ?? undefined
        return response
      }),
    )

    const pending = sendVerificationProbe("https://example.test/probe", { signal: caller.signal }, 10_000)
    await bodyReadStartedPromise
    expect(bodyRead).toHaveBeenCalledOnce()
    caller.abort()

    await expect(pending).rejects.toMatchObject({ name: "AbortError" })
    expect(requestSignal?.aborted).toBe(true)
  })
})
