import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const { refreshAccessToken, ensureProjectContext } = vi.hoisted(() => ({
  refreshAccessToken: vi.fn(),
  ensureProjectContext: vi.fn(),
}))

vi.mock("./token.js", () => ({ refreshAccessToken }))
vi.mock("../adapters/opencode/project.js", () => ({ ensureProjectContext }))

import { checkAccountsQuota } from "./quota.js"

const summaryResponse = {
  groups: [
    {
      displayName: "Gemini Models",
      description: "Models within this group: Gemini Flash, Gemini Pro",
      buckets: [
        {
          window: "weekly",
          remainingFraction: 0.6558833,
          resetTime: "2026-10-09T18:11:34Z",
          displayName: "Weekly Limit Remaining",
        },
        {
          window: "5h",
          remainingFraction: 1,
          resetTime: "2026-10-02T23:11:34Z",
          displayName: "Five Hour Limit Remaining",
        },
      ],
    },
  ],
}

const availableModelsResponse = {
  models: {
    "gemini-3.1-pro": {
      displayName: "Gemini 3.1 Pro",
      quotaInfo: { remainingFraction: 0.9, resetTime: "2026-10-02T23:11:34Z" },
    },
  },
}

beforeEach(() => {
  refreshAccessToken.mockResolvedValue({
    type: "oauth",
    refresh: "refresh-token|project",
    access: "access-token",
    expires: Date.now() + 60 * 60 * 1000,
  })
  ensureProjectContext.mockImplementation(async (auth) => ({ auth, effectiveProjectId: "project" }))
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

describe("checkAccountsQuota grouped summary", () => {
  it("fetches the grouped summary alongside per-model quota", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      return new Response(
        JSON.stringify(url.includes("retrieveUserQuotaSummary") ? summaryResponse : availableModelsResponse),
      )
    })
    vi.stubGlobal("fetch", fetchMock)

    const [result] = await checkAccountsQuota(
      [{ refreshToken: "refresh-token", projectId: "project", addedAt: 1, lastUsed: 1 }],
      {} as never,
    )

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(result?.quota?.groups["gemini-pro"]?.remainingFraction).toBe(0.9)
    expect(result?.quota?.quotaSummaryStatus).toBe("ok")
    expect(result?.quota?.quotaSummaryGroups?.[0]?.buckets.weekly?.remainingFraction).toBe(0.6558833)
  })

  it("keeps the existing quota result if the supplementary endpoint fails", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).includes("retrieveUserQuotaSummary")) return new Response("unavailable", { status: 503 })
      return new Response(JSON.stringify(availableModelsResponse))
    })
    vi.stubGlobal("fetch", fetchMock)

    const [result] = await checkAccountsQuota(
      [{ refreshToken: "refresh-token", projectId: "project", addedAt: 1, lastUsed: 1 }],
      {} as never,
    )

    expect(result?.status).toBe("ok")
    expect(result?.quota?.groups["gemini-pro"]?.remainingFraction).toBe(0.9)
    expect(result?.quota?.quotaSummaryStatus).toBe("error")
    expect(result?.quota).not.toHaveProperty("quotaSummaryGroups")
  })

  it("passes caller cancellation through to both quota probes", async () => {
    const signals: AbortSignal[] = []
    let bodyReads = 0
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const signal = init?.signal
      if (!(signal instanceof AbortSignal)) throw new Error("request missing cancellation signal")
      signals.push(signal)
      return {
        ok: true,
        status: 200,
        json: () => {
          bodyReads++
          return new Promise((_resolve, reject) => {
            signal.addEventListener("abort", () => reject(new Error("body aborted")), { once: true })
          })
        },
      } as Response
    })
    vi.stubGlobal("fetch", fetchMock)
    const controller = new AbortController()

    const pending = checkAccountsQuota(
      [{ refreshToken: "refresh-token", projectId: "project", addedAt: 1, lastUsed: 1 }],
      {} as never,
      undefined,
      controller.signal,
    )
    await vi.waitFor(() => expect(bodyReads).toBe(2))
    controller.abort()
    const [result] = await pending

    expect(signals).toHaveLength(2)
    expect(signals.every((signal) => signal.aborted)).toBe(true)
    expect(result?.quota?.error).toBe("Failed to fetch Antigravity quota")
    expect(result?.quota?.quotaSummaryStatus).toBe("error")
  })

  it("returns completed per-model quota when the supplementary probe stalls", async () => {
    vi.useFakeTimers()
    let requestsStarted = 0
    let resolveRequestsStarted!: () => void
    const bothRequestsStarted = new Promise<void>((resolve) => {
      resolveRequestsStarted = resolve
    })
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      requestsStarted++
      if (requestsStarted === 2) resolveRequestsStarted()
      if (String(input).includes("retrieveUserQuotaSummary")) {
        const signal = init?.signal
        if (!(signal instanceof AbortSignal)) throw new Error("summary request missing timeout signal")
        return new Promise<Response>((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(new Error("summary timed out")), { once: true })
        })
      }
      return Promise.resolve(new Response(JSON.stringify(availableModelsResponse)))
    })
    vi.stubGlobal("fetch", fetchMock)

    try {
      const pending = checkAccountsQuota(
        [{ refreshToken: "refresh-token", projectId: "project", addedAt: 1, lastUsed: 1 }],
        {} as never,
      )
      await bothRequestsStarted
      await vi.advanceTimersByTimeAsync(5_000)
      const [result] = await pending

      expect(result?.status).toBe("ok")
      expect(result?.quota?.groups["gemini-pro"]?.remainingFraction).toBe(0.9)
      expect(result?.quota?.quotaSummaryStatus).toBe("error")
    } finally {
      vi.useRealTimers()
    }
  })
})
