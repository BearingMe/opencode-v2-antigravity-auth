import { afterEach, describe, expect, it, vi } from "vitest"
import { antigravityManagedProjectPort, discoverOAuthProjectId, loadManagedProject } from "./project-client.js"

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe("Antigravity project adapter", () => {
  it("falls through a failed discovery endpoint and parses the next project response", async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = []
    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      requests.push({ url, init })
      if (url.includes("daily-cloudcode")) return Response.json({ cloudaicompanionProject: { id: "managed-project" } })
      return new Response("not found", { status: 503 })
    })

    const discovered = await discoverOAuthProjectId("synthetic-access")

    expect(discovered.projectId).toBe("managed-project")
    expect(requests).toHaveLength(2)
    expect(requests[0]?.url).toBe("https://cloudcode-pa.googleapis.com/v1internal:loadCodeAssist")
    expect(requests[1]?.url).toBe("https://daily-cloudcode-pa.sandbox.googleapis.com/v1internal:loadCodeAssist")
    expect(new Headers(requests[0]?.init?.headers).get("authorization")).toBe("Bearer synthetic-access")
  })

  it("degrades to an empty OAuth project id after all discovery endpoints fail", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("unavailable", { status: 503 })),
    )

    const result = await discoverOAuthProjectId("synthetic-access")

    expect(result.projectId).toBe("")
    expect(result.errors).toHaveLength(2)
  })

  it("keeps managed-project request timeouts active while parsing responses", async () => {
    vi.useFakeTimers()
    let timedOutSignal: AbortSignal | undefined
    let bodyReadStarted!: () => void
    const bodyReadStartedPromise = new Promise<void>((resolve) => {
      bodyReadStarted = resolve
    })
    const stalledResponse = new Response(null)
    vi.spyOn(stalledResponse, "json").mockImplementation(
      () =>
        new Promise((_resolve, reject) => {
          bodyReadStarted()
          timedOutSignal?.addEventListener("abort", () => reject(new DOMException("timed out", "AbortError")), {
            once: true,
          })
        }),
    )
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).startsWith("https://cloudcode-pa.googleapis.com/")) {
        timedOutSignal = init?.signal ?? undefined
        return stalledResponse
      }
      return Response.json({ cloudaicompanionProject: "fallback-project" })
    })
    vi.stubGlobal("fetch", fetchMock)

    const pending = loadManagedProject("synthetic-access")
    await bodyReadStartedPromise
    await vi.advanceTimersByTimeAsync(10_000)

    await expect(pending).resolves.toMatchObject({ managedProjectId: "fallback-project" })
    expect(timedOutSignal?.aborted).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it("bounds one onboarding attempt through response-body parsing", async () => {
    vi.useFakeTimers()
    let signal: AbortSignal | undefined
    let bodyReadStarted!: () => void
    const bodyReadStartedPromise = new Promise<void>((resolve) => {
      bodyReadStarted = resolve
    })
    const stalledResponse = new Response(null)
    vi.spyOn(stalledResponse, "json").mockImplementation(
      () =>
        new Promise((_resolve, reject) => {
          bodyReadStarted()
          signal?.addEventListener("abort", () => reject(new DOMException("timed out", "AbortError")), {
            once: true,
          })
        }),
    )
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        signal = init?.signal ?? undefined
        return stalledResponse
      }),
    )
    const session = antigravityManagedProjectPort.startOnboarding({
      accessToken: "synthetic-access",
      tierId: "FREE",
    })

    const pending = session.attempt()
    await bodyReadStartedPromise
    await vi.advanceTimersByTimeAsync(10_000)

    await expect(pending).resolves.toEqual({ kind: "endpoint-unavailable" })
    expect(signal?.aborted).toBe(true)
  })

  it("keeps polling a pending onboarding operation at the same endpoint", async () => {
    const urls: string[] = []
    let attempts = 0
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        urls.push(String(input))
        attempts += 1
        return attempts === 1
          ? Response.json({ done: false })
          : Response.json({ done: true, response: { cloudaicompanionProject: { id: "managed-project" } } })
      }),
    )
    const session = antigravityManagedProjectPort.startOnboarding({
      accessToken: "synthetic-access",
      tierId: "FREE",
    })

    await expect(session.attempt()).resolves.toEqual({ kind: "pending" })
    await expect(session.attempt()).resolves.toEqual({ kind: "complete", projectId: "managed-project" })

    expect(urls[0]).toBe("https://daily-cloudcode-pa.sandbox.googleapis.com/v1internal:onboardUser")
    expect(urls[1]).toBe(urls[0])
  })

  it("advances endpoint after a non-OK response", async () => {
    const urls: string[] = []
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        urls.push(String(input))
        return urls.length === 1
          ? new Response("unavailable", { status: 503 })
          : Response.json({ done: true, response: { cloudaicompanionProject: { id: "managed-project" } } })
      }),
    )
    const session = antigravityManagedProjectPort.startOnboarding({
      accessToken: "synthetic-access",
      tierId: "FREE",
    })

    await expect(session.attempt()).resolves.toEqual({ kind: "endpoint-unavailable" })
    expect(session.nextEndpoint()).toBe(true)
    await expect(session.attempt()).resolves.toEqual({ kind: "complete", projectId: "managed-project" })

    expect(urls).toEqual([
      "https://daily-cloudcode-pa.sandbox.googleapis.com/v1internal:onboardUser",
      "https://cloudcode-pa.googleapis.com/v1internal:onboardUser",
    ])
  })

  it("treats transport and malformed-response failures as unavailable endpoints", async () => {
    const malformedResponse = new Response(null)
    vi.spyOn(malformedResponse, "json").mockRejectedValue(new Error("invalid JSON"))
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new Error("network unavailable"))
      .mockResolvedValueOnce(malformedResponse)
    vi.stubGlobal("fetch", fetchMock)
    const session = antigravityManagedProjectPort.startOnboarding({
      accessToken: "synthetic-access",
      tierId: "FREE",
    })

    await expect(session.attempt()).resolves.toEqual({ kind: "endpoint-unavailable" })
    expect(session.nextEndpoint()).toBe(true)
    await expect(session.attempt()).resolves.toEqual({ kind: "endpoint-unavailable" })
    expect(session.nextEndpoint()).toBe(false)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it("returns managed project metadata or the onboarded project without policy changes", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        if (String(input).includes("loadCodeAssist")) {
          return Response.json({
            cloudaicompanionProject: { id: "existing-project" },
            currentTier: { id: "FREE" },
            allowedTiers: [{ id: "FREE", isDefault: true, userDefinedCloudaicompanionProject: true }],
            providerExtension: "preserved",
          })
        }
        return Response.json({ done: true, response: { cloudaicompanionProject: { id: "onboarded-project" } } })
      }),
    )

    const loaded = await loadManagedProject("synthetic-access", "project-hint")
    const onboarding = antigravityManagedProjectPort.startOnboarding({
      accessToken: "synthetic-access",
      tierId: "FREE",
      projectId: "project-hint",
    })
    const onboarded = await onboarding.attempt()

    expect(loaded?.payload).toMatchObject({
      currentTier: { id: "FREE" },
      allowedTiers: [{ userDefinedCloudaicompanionProject: true }],
      providerExtension: "preserved",
    })
    expect(loaded?.managedProjectId).toBe("existing-project")
    expect(loaded?.payload.allowedTiers?.[0]?.id).toBe("FREE")
    expect(loaded?.allowedTiers?.[0]?.id).toBe("FREE")
    expect(onboarded).toEqual({ kind: "complete", projectId: "onboarded-project" })
  })
})
