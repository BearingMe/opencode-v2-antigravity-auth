import { describe, expect, it, vi } from "vitest"
import { createAntigravityInferenceClient } from "./inference-client.js"

describe("Antigravity inference transport", () => {
  it("forwards request and init unchanged to the supplied fetch implementation", async () => {
    const response = new Response("ok")
    const fetchImpl = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => response)
    const client = createAntigravityInferenceClient(fetchImpl)
    const request = new Request("https://antigravity.example/v1internal:generateContent", {
      method: "POST",
    })
    const init: RequestInit = { method: "POST", body: "{}", signal: new AbortController().signal }

    await expect(client.send(request, init)).resolves.toBe(response)
    expect(fetchImpl).toHaveBeenCalledOnce()
    expect(fetchImpl.mock.calls[0]?.[0]).toBe(request)
    expect(fetchImpl.mock.calls[0]?.[1]).toBe(init)
  })

  it("propagates fetch rejection instead of converting transport failure", async () => {
    const failure = new Error("network unavailable")
    const client = createAntigravityInferenceClient(vi.fn(async () => Promise.reject(failure)))

    await expect(client.send("https://antigravity.example/v1internal:generateContent")).rejects.toBe(failure)
  })
})
