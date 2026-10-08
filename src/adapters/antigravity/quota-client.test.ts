import { afterEach, describe, expect, it, vi } from "vitest"
import { fetchAvailableModels, parseAvailableModelsResponse, parseQuotaSummaryResponse } from "./quota-client.js"

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("Antigravity quota adapter", () => {
  it("parses weekly and five-hour grouped quota buckets", () => {
    expect(
      parseQuotaSummaryResponse({
        groups: [
          {
            displayName: "Gemini Models",
            description: "Models within this group: Gemini Flash, Gemini Pro",
            buckets: [
              { window: "weekly", remainingFraction: 0.6558833, resetTime: "2026-10-09T18:11:34Z" },
              { window: "5h", remainingFraction: 1, resetTime: "2026-10-02T23:11:34Z" },
            ],
          },
        ],
      }),
    ).toEqual([
      {
        displayName: "Gemini Models",
        description: "Models within this group: Gemini Flash, Gemini Pro",
        buckets: {
          weekly: { remainingFraction: 0.6558833, resetTime: "2026-10-09T18:11:34Z" },
          "5h": { remainingFraction: 1, resetTime: "2026-10-02T23:11:34Z" },
        },
      },
    ])
  })

  it("ignores unsupported, disabled, and invalid buckets", () => {
    expect(
      parseQuotaSummaryResponse({
        groups: [
          {
            displayName: "Gemini Models",
            buckets: [
              { window: "monthly", remainingFraction: 0.5 },
              { window: "weekly", remainingFraction: 1.1 },
              { window: "5h", remainingFraction: 0.5, disabled: true },
            ],
          },
        ],
      }),
    ).toEqual([])
    expect(parseQuotaSummaryResponse({ unexpected: true })).toBeUndefined()
  })

  it("keeps a valid fraction when the reset timestamp is malformed", () => {
    expect(
      parseQuotaSummaryResponse({
        groups: [
          {
            displayName: "Gemini Models",
            buckets: [{ window: "weekly", remainingFraction: 0.4, resetTime: "not-a-date" }],
          },
        ],
      }),
    ).toEqual([{ displayName: "Gemini Models", buckets: { weekly: { remainingFraction: 0.4 } } }])
  })

  it("bounds upstream text and strips terminal control characters", () => {
    const groups = parseQuotaSummaryResponse({
      groups: [
        {
          displayName: "\u001b[31mGemini Models\u001b[0m",
          description: "Safe\u001b[2J details",
          buckets: [{ window: "weekly", remainingFraction: 0.5 }],
        },
      ],
    })
    expect(groups?.[0]?.displayName).toBe("[31mGemini Models[0m")
    expect(groups?.[0]?.description).toBe("Safe[2J details")
  })

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
