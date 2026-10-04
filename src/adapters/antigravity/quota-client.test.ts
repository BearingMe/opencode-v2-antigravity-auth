import { afterEach, describe, expect, it, vi } from "vitest"
import { fetchAvailableModels, parseAvailableModelsResponse } from "./quota-client.js"

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("Antigravity quota adapter", () => {
  it("parses only model fields consumed by account quota policy", () => {
    expect(
      parseAvailableModelsResponse({
        models: {
          "gemini-3.1-pro": {
            displayName: "Gemini 3.1 Pro",
            quotaInfo: { remainingFraction: 0, resetTime: "2026-10-04T12:00:00Z", ignored: true },
            ignored: true,
          },
          malformed: null,
          invalidQuota: { quotaInfo: { remainingFraction: 1.5, resetTime: "not-a-timestamp" } },
        },
        ignored: true,
      }),
    ).toEqual({
      models: {
        "gemini-3.1-pro": {
          displayName: "Gemini 3.1 Pro",
          remainingFraction: 0,
          resetTime: "2026-10-04T12:00:00Z",
        },
        invalidQuota: {},
      },
    })
    expect(parseAvailableModelsResponse({ models: "invalid" })).toEqual({})
    expect(parseAvailableModelsResponse({ models: { invalid: { quotaInfo: { remainingFraction: -1 } } } })).toEqual({
      models: { invalid: {} },
    })
  })

  it("sends the provider project and bearer token to the production quota endpoint", async () => {
    let requestUrl = ""
    let requestInit: RequestInit | undefined
    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestInit = init
      return Response.json({ models: {} })
    })

    await fetchAvailableModels("synthetic-access", "synthetic-project")

    expect(requestUrl).toBe("https://cloudcode-pa.googleapis.com/v1internal:fetchAvailableModels")
    expect(requestInit?.method).toBe("POST")
    expect(new Headers(requestInit?.headers).get("authorization")).toBe("Bearer synthetic-access")
    expect(JSON.parse(String(requestInit?.body))).toEqual({ project: "synthetic-project" })
  })
})
