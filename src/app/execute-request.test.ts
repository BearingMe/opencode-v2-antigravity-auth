import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { AccountManager } from "../adapters/opencode/account-pool.ts"
import { formatRefreshParts } from "../modules/accounts/index.ts"
import { DEFAULT_CONFIG } from "../adapters/opencode/config/schema.ts"
import { ANTIGRAVITY_ENDPOINT_FALLBACKS } from "../constants.ts"
import { AntigravityTokenRefreshError } from "../plugin/token.ts"
import type { PluginClient } from "../adapters/opencode/types.ts"

const { mockPrepare, mockTransform, mockEnsureProjectContext, mockRefreshAccessToken } = vi.hoisted(() => ({
  mockPrepare: vi.fn(),
  mockTransform: vi.fn(),
  mockEnsureProjectContext: vi.fn(),
  mockRefreshAccessToken: vi.fn(),
}))

vi.mock("../plugin/request.ts", async (importOriginal) => {
  const orig = await importOriginal<typeof import("../plugin/request.ts")>()
  return {
    ...orig,
    prepareAntigravityRequest: mockPrepare,
    transformAntigravityResponse: mockTransform,
  }
})

vi.mock("../plugin/project.ts", async (importOriginal) => {
  const orig = await importOriginal<typeof import("../plugin/project.ts")>()
  return { ...orig, ensureProjectContext: mockEnsureProjectContext }
})

vi.mock("../plugin/token.ts", async (importOriginal) => {
  const orig = await importOriginal<typeof import("../plugin/token.ts")>()
  return { ...orig, refreshAccessToken: mockRefreshAccessToken }
})

import { executeAntigravityRequest, refreshOAuthCredentialUnified } from "./composition.ts"
import {
  extractModelFromUrl,
  formatWaitTime,
  getModelFamilyFromUrl,
  isNativeEngineEnabled,
  resetEngineStateForTests,
} from "./execute-request.ts"

/** Creates the minimal host client used by request-execution tests. */
function makeClient(): PluginClient {
  return {
    tui: { showToast: vi.fn(async () => ({ data: undefined })) },
    auth: { set: vi.fn(async () => ({ data: undefined })) },
  } as unknown as PluginClient
}

/** Builds an account manager initialized with the supplied OAuth entries. */
function makeManager(entries: Array<{ refreshToken: string; access?: string; expires?: number }>): AccountManager {
  const authFallback = {
    type: "oauth" as const,
    refresh: formatRefreshParts({ refreshToken: entries[0]?.refreshToken ?? "" }),
    access: entries[0]?.access,
    expires: entries[0]?.expires,
  }
  return new AccountManager(authFallback, {
    version: 4,
    accounts: entries.map((entry) => ({
      refreshToken: entry.refreshToken,
      addedAt: 1,
      lastUsed: 1,
      enabled: true as const,
    })),
    activeIndex: 0,
  })
}

const GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/models/gemini-3-pro:generateContent"

describe("engine request helpers", () => {
  it("extracts model family from URL", () => {
    expect(getModelFamilyFromUrl(GEMINI_URL)).toBe("gemini")
    expect(
      getModelFamilyFromUrl(
        "https://generativelanguage.googleapis.com/v1beta/models/antigravity-claude-opus:generateContent",
      ),
    ).toBe("claude")
    expect(extractModelFromUrl(GEMINI_URL)).toBe("gemini-3-pro")
  })

  it("formats wait times like V1", () => {
    expect(formatWaitTime(500)).toBe("500ms")
    expect(formatWaitTime(5000)).toBe("5s")
    expect(formatWaitTime(90000)).toBe("1m 30s")
  })

  it("gates the native engine behind an opt-out flag", () => {
    const previous = process.env.OPENCODE_ANTIGRAVITY_V2_NATIVE
    try {
      process.env.OPENCODE_ANTIGRAVITY_V2_NATIVE = "0"
      expect(isNativeEngineEnabled()).toBe(false)
      delete process.env.OPENCODE_ANTIGRAVITY_V2_NATIVE
      expect(isNativeEngineEnabled()).toBe(true)
    } finally {
      if (previous === undefined) delete process.env.OPENCODE_ANTIGRAVITY_V2_NATIVE
      else process.env.OPENCODE_ANTIGRAVITY_V2_NATIVE = previous
    }
  })
})

describe("refreshOAuthCredentialUnified (D-REFRESH-DUAL)", () => {
  it("delegates to token.ts refreshAccessToken and preserves the credential shape", async () => {
    mockRefreshAccessToken.mockResolvedValueOnce({
      type: "oauth",
      refresh: "rotated|proj",
      access: "new-access",
      expires: 4242,
    })
    const client = makeClient()
    const credential = {
      type: "oauth",
      access: "old-access",
      refresh: "old|proj",
      expires: 1,
      methodID: "antigravity-oauth",
    }
    const refreshed = await refreshOAuthCredentialUnified(credential, client, "antigravity")
    expect(mockRefreshAccessToken).toHaveBeenCalledOnce()
    expect(refreshed).toMatchObject({
      access: "new-access",
      refresh: "rotated|proj",
      expires: 4242,
      methodID: "antigravity-oauth",
    })
  })
})

describe("executeAntigravityRequest", () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  beforeEach(() => {
    vi.clearAllMocks()
    resetEngineStateForTests()
    mockEnsureProjectContext.mockImplementation(async (auth: unknown) => ({
      auth,
      effectiveProjectId: "test-project",
    }))
    mockPrepare.mockImplementation(
      (
        input: unknown,
        init: RequestInit | undefined,
        accessToken: string,
        projectId: string,
        endpointOverride?: string,
        forceThinkingRecovery = false,
      ) => ({
        request: `https://mock-endpoint/${forceThinkingRecovery ? "recovery" : "request"}`,
        init: { method: "POST", headers: {}, body: init?.body },
        streaming: false,
        requestedModel: "gemini-3-pro",
        effectiveModel: "gemini-3-pro",
        projectId,
        endpoint: endpointOverride,
        accessToken,
        input,
      }),
    )
    mockTransform.mockImplementation(async (response: Response) => response)
  })

  it("throws when no accounts are available", async () => {
    const manager = makeManager([])
    await expect(
      executeAntigravityRequest(
        GEMINI_URL,
        { method: "POST" },
        {
          client: makeClient(),
          providerId: "antigravity",
          config: { ...DEFAULT_CONFIG },
          accountManager: manager,
        },
      ),
    ).rejects.toThrow("No Antigravity accounts available")
  })

  it.each(["gemini-2.5-pro", "antigravity-gemini-2.5-flash-low"])(
    "rejects unsupported model %s before account or project work",
    async (model) => {
      const manager = makeManager([
        { refreshToken: "rt-1", access: "at-1", expires: Date.now() + 3600_000 },
        { refreshToken: "rt-2", access: "at-2", expires: Date.now() + 3600_000 },
      ])
      const fetchImpl = vi.fn(async () => new Response("unexpected"))
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`

      await expect(
        executeAntigravityRequest(
          url,
          { method: "POST", body: JSON.stringify({ contents: [] }) },
          {
            client: makeClient(),
            providerId: "antigravity",
            config: { ...DEFAULT_CONFIG },
            accountManager: manager,
            fetchImpl,
          },
        ),
      ).rejects.toThrow(/not available through Antigravity OAuth/)

      expect(mockEnsureProjectContext).not.toHaveBeenCalled()
      expect(mockPrepare).not.toHaveBeenCalled()
      expect(fetchImpl).not.toHaveBeenCalled()
    },
  )

  it("routes SDK JSON through the engine and marks the account used", async () => {
    const manager = makeManager([{ refreshToken: "rt-1", access: "at-1", expires: Date.now() + 3600_000 }])
    const fetchImpl = vi.fn(
      async () =>
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    )
    const response = await executeAntigravityRequest(
      GEMINI_URL,
      { method: "POST", body: "{}" },
      {
        client: makeClient(),
        providerId: "antigravity",
        config: { ...DEFAULT_CONFIG },
        accountManager: manager,
        fetchImpl: fetchImpl as unknown as typeof fetch,
      },
    )
    expect(response.status).toBe(200)
    expect(fetchImpl).toHaveBeenCalledOnce()
    expect(mockPrepare).toHaveBeenCalledOnce()
    expect(mockPrepare.mock.calls[0]?.[5]).toBe(false)
    expect(mockTransform).toHaveBeenCalledOnce()
  })

  it("runs Sonnet thinking warmup when the resolved backend ID omits the thinking suffix", async () => {
    const manager = makeManager([{ refreshToken: "rt-1", access: "at-1", expires: Date.now() + 3600_000 }])
    const wrappedRequest = JSON.stringify({
      project: "test-project",
      model: "claude-sonnet-4-6",
      request: { contents: [{ role: "user", parts: [{ text: "hello" }] }] },
    })
    mockPrepare.mockImplementationOnce((_input: unknown, init?: RequestInit) => ({
      request: "https://mock-endpoint/v1internal:generateContent",
      init: { method: "POST", headers: {}, body: init?.body },
      streaming: false,
      requestedModel: "antigravity-claude-sonnet-4-6-thinking",
      effectiveModel: "claude-sonnet-4-6",
      projectId: "test-project",
      sessionId: "sonnet-thinking-session",
      needsSignedThinkingWarmup: true,
    }))
    const fetchImpl = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        new Response("{}", { status: 200, headers: { "content-type": "application/json" } }),
    )

    await executeAntigravityRequest(
      "https://generativelanguage.googleapis.com/v1beta/models/antigravity-claude-sonnet-4-6-thinking:generateContent",
      { method: "POST", body: wrappedRequest },
      {
        client: makeClient(),
        providerId: "antigravity",
        config: { ...DEFAULT_CONFIG },
        accountManager: manager,
        fetchImpl: fetchImpl as unknown as typeof fetch,
      },
    )

    expect(fetchImpl).toHaveBeenCalledTimes(2)
    const warmupCall = fetchImpl.mock.calls[0]
    expect(String(warmupCall?.[0])).toContain(":streamGenerateContent?alt=sse")
    const warmupBody = JSON.parse(warmupCall?.[1]?.body as string)
    expect(warmupBody.request.generationConfig.thinkingConfig).toMatchObject({
      include_thoughts: true,
      thinking_budget: 16000,
    })
  })

  it("evicts invalid_grant accounts and continues with the next account", async () => {
    const manager = makeManager([
      { refreshToken: "rt-revoked" },
      { refreshToken: "rt-healthy", access: "at-healthy", expires: Date.now() + 3600_000 },
    ])
    mockRefreshAccessToken.mockImplementation(async (auth: { refresh: string; access?: string }) => {
      if (auth.refresh.includes("rt-revoked")) {
        throw new AntigravityTokenRefreshError({
          message: "revoked",
          code: "invalid_grant",
          status: 401,
          statusText: "Unauthorized",
        })
      }
      return { ...auth, access: "at-fresh", expires: Date.now() + 3600_000 }
    })
    const fetchImpl = vi.fn(
      async () =>
        new Response("{}", {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    )
    const response = await executeAntigravityRequest(
      GEMINI_URL,
      { method: "POST" },
      {
        client: makeClient(),
        providerId: "antigravity",
        config: { ...DEFAULT_CONFIG },
        accountManager: manager,
        fetchImpl: fetchImpl as unknown as typeof fetch,
      },
    )
    expect(response.status).toBe(200)
    expect(fetchImpl).toHaveBeenCalledOnce()
    expect(manager.getTotalAccountCount()).toBe(1)
  })

  it("records Gemini quota exhaustion for its Antigravity model", async () => {
    const manager = makeManager([{ refreshToken: "rt-1", access: "at-1", expires: Date.now() + 3600_000 }])
    const quotaBody = JSON.stringify({
      error: {
        message: "quota exhausted",
        details: [{ "@type": "type.googleapis.com/google.rpc.ErrorInfo", reason: "QUOTA_EXHAUSTED" }],
      },
    })
    const fetchImpl = vi.fn(
      async () => new Response(quotaBody, { status: 429, headers: { "content-type": "application/json" } }),
    )
    const response = await executeAntigravityRequest(
      GEMINI_URL,
      { method: "POST" },
      {
        client: makeClient(),
        providerId: "antigravity",
        config: { ...DEFAULT_CONFIG },
        accountManager: manager,
        fetchImpl: fetchImpl as unknown as typeof fetch,
      },
    )
    expect(response.status).toBe(429)
    expect(fetchImpl).toHaveBeenCalledOnce()
    expect(mockPrepare).toHaveBeenCalledOnce()
    expect(manager.getAccountsSnapshot()[0]?.rateLimitResetTimes["gemini-antigravity:gemini-3-pro"]).toBeGreaterThan(
      Date.now(),
    )
  })

  it.each([
    {
      name: "retry-after-ms over retry-after",
      headers: { "retry-after-ms": "2500", "retry-after": "7" },
      error: {
        message: "slow down",
        details: [{ "@type": "type.googleapis.com/google.rpc.ErrorInfo", reason: "QUOTA_EXHAUSTED" }],
      },
      delayMs: 2500,
    },
    {
      name: "RetryInfo's compound duration",
      headers: {},
      error: {
        message: "slow down",
        details: [
          { "@type": "type.googleapis.com/google.rpc.ErrorInfo", reason: "QUOTA_EXHAUSTED" },
          { "@type": "type.googleapis.com/google.rpc.RetryInfo", retryDelay: "1h16m0.667s" },
        ],
      },
      delayMs: 4_560_667,
    },
  ])("applies provider retry hints from $name", async ({ headers, error, delayMs }) => {
    vi.useFakeTimers()
    const requestTime = Date.now()
    const manager = makeManager([{ refreshToken: "rt-1", access: "at-1", expires: Date.now() + 3600_000 }])
    const responseHeaders = new Headers({ "content-type": "application/json" })
    for (const [name, value] of Object.entries(headers)) responseHeaders.set(name, value)
    const fetchImpl = vi
      .fn<() => Promise<Response>>()
      .mockResolvedValueOnce(new Response(JSON.stringify({ error }), { status: 429, headers: responseHeaders }))

    const request = executeAntigravityRequest(
      GEMINI_URL,
      { method: "POST" },
      {
        client: makeClient(),
        providerId: "antigravity",
        config: { ...DEFAULT_CONFIG, request_jitter_max_ms: 0, scheduling_mode: "balance" },
        accountManager: manager,
        fetchImpl: fetchImpl as unknown as typeof fetch,
      },
    )

    await vi.advanceTimersByTimeAsync(1000)
    const response = await request

    expect(response.status).toBe(429)
    expect(fetchImpl).toHaveBeenCalledOnce()
    expect(manager.getAccountsSnapshot()[0]?.rateLimitResetTimes["gemini-antigravity:gemini-3-pro"]).toBe(
      requestTime + delayMs,
    )
  })

  it("caps repeated capacity retries, refreshes fingerprint once, then tries endpoint fallback", async () => {
    vi.useFakeTimers()
    vi.spyOn(Math, "random").mockReturnValue(0.5)

    const manager = makeManager([{ refreshToken: "rt-1", access: "at-1", expires: Date.now() + 3600_000 }])
    const regenerateFingerprint = vi.spyOn(manager, "regenerateAccountFingerprint")
    const [primaryEndpoint, fallbackEndpoint] = ANTIGRAVITY_ENDPOINT_FALLBACKS
    expect(primaryEndpoint).toBeDefined()
    expect(fallbackEndpoint).toBeDefined()

    mockPrepare.mockImplementation(
      (
        input: unknown,
        init: RequestInit | undefined,
        accessToken: string,
        projectId: string,
        endpointOverride?: string,
      ) => ({
        request:
          endpointOverride === primaryEndpoint ? "https://mock-endpoint/primary" : "https://mock-endpoint/fallback",
        init: { method: "POST", headers: {}, body: init?.body },
        streaming: false,
        requestedModel: "gemini-3-pro",
        effectiveModel: "gemini-3-pro",
        projectId,
        endpoint: endpointOverride,
        accessToken,
        input,
      }),
    )

    const capacityError = JSON.stringify({
      error: {
        message: "Model capacity exhausted",
        details: [{ "@type": "type.googleapis.com/google.rpc.ErrorInfo", reason: "MODEL_CAPACITY_EXHAUSTED" }],
      },
    })
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input) === "https://mock-endpoint/primary") {
        return new Response(capacityError, { status: 503, headers: { "content-type": "application/json" } })
      }
      return new Response("{}", { status: 200, headers: { "content-type": "application/json" } })
    })
    const controller = new AbortController()
    const safetyAbort = setTimeout(() => controller.abort(new Error("capacity retry loop did not terminate")), 30_000)

    const request = executeAntigravityRequest(
      GEMINI_URL,
      { method: "POST", signal: controller.signal },
      {
        client: makeClient(),
        providerId: "antigravity",
        config: { ...DEFAULT_CONFIG, request_jitter_max_ms: 0 },
        accountManager: manager,
        fetchImpl: fetchImpl as unknown as typeof fetch,
      },
    )

    try {
      await vi.advanceTimersByTimeAsync(30_000)
      const response = await request

      expect(response.status).toBe(200)
      expect(fetchImpl).toHaveBeenCalledTimes(6)
      expect(regenerateFingerprint).toHaveBeenCalledOnce()
      expect(mockPrepare.mock.calls.at(-1)?.[4]).toBe(fallbackEndpoint)
    } finally {
      clearTimeout(safetyAbort)
      vi.restoreAllMocks()
    }
  })

  it("cancels an exhaustion wait without dispatching another request", async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2025-01-01T00:00:00.000Z"))
    const manager = makeManager([{ refreshToken: "rt-1", access: "at-1", expires: Date.now() + 3600_000 }])
    const account = manager.getAccounts()[0]
    expect(account).toBeDefined()
    manager.markRateLimited(account!, 60_000, "gemini", "gemini-3-pro")
    const fetchImpl = vi.fn(async () => new Response("unexpected"))
    const controller = new AbortController()
    const toastMessages: string[] = []
    const onToast = vi.fn((message: string) => {
      toastMessages.push(message)
    })

    const request = executeAntigravityRequest(
      GEMINI_URL,
      { method: "POST", signal: controller.signal },
      {
        client: makeClient(),
        providerId: "antigravity",
        config: { ...DEFAULT_CONFIG },
        accountManager: manager,
        fetchImpl: fetchImpl as unknown as typeof fetch,
        onToast,
      },
    )
    await vi.advanceTimersByTimeAsync(0)
    expect(onToast).toHaveBeenCalledOnce()
    expect(toastMessages[0]).toContain("Waiting")
    expect(vi.getTimerCount()).toBeGreaterThan(0)
    controller.abort(new Error("request cancelled"))

    await expect(request).rejects.toThrow("request cancelled")
    expect(fetchImpl).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })

  it("returns a synthetic prompt-too-long response on 400 instead of locking the session", async () => {
    const manager = makeManager([{ refreshToken: "rt-1", access: "at-1", expires: Date.now() + 3600_000 }])
    const fetchImpl = vi.fn(
      async () =>
        new Response("Prompt is too long", {
          status: 400,
          headers: { "content-type": "application/json" },
        }),
    )
    const toasts: Array<{ message: string; variant: string }> = []
    const response = await executeAntigravityRequest(
      GEMINI_URL,
      { method: "POST" },
      {
        client: makeClient(),
        providerId: "antigravity",
        config: { ...DEFAULT_CONFIG },
        accountManager: manager,
        fetchImpl: fetchImpl as unknown as typeof fetch,
        onToast: (message, variant) => {
          toasts.push({ message, variant })
        },
      },
    )
    expect(response.status).toBe(200)
    expect(await response.text()).toContain("compact")
    expect(toasts.some((toast) => toast.message.includes("compact"))).toBe(true)
  })

  it("shows toasts through the client when quiet_mode is off", async () => {
    const manager = makeManager([{ refreshToken: "rt-1", access: "at-1", expires: Date.now() + 3600_000 }])
    const fetchImpl = vi.fn(
      async () =>
        new Response("Prompt is too long", {
          status: 400,
          headers: { "content-type": "application/json" },
        }),
    )
    const showToast = vi.fn(async (_input: unknown) => ({ data: undefined }))
    const client = {
      app: { log: vi.fn(async () => undefined) },
      auth: { set: vi.fn(async () => undefined) },
      session: {
        prompt: vi.fn(async () => undefined),
        abort: vi.fn(async () => undefined),
        messages: vi.fn(async () => undefined),
      },
      tui: { showToast },
    } as unknown as PluginClient
    await executeAntigravityRequest(
      GEMINI_URL,
      { method: "POST" },
      {
        client,
        providerId: "antigravity",
        config: { ...DEFAULT_CONFIG, quiet_mode: false },
        accountManager: manager,
        fetchImpl: fetchImpl as unknown as typeof fetch,
      },
    )
    expect(showToast).toHaveBeenCalledOnce()
  })

  it("suppresses toasts through the client when quiet_mode is on", async () => {
    const manager = makeManager([{ refreshToken: "rt-1", access: "at-1", expires: Date.now() + 3600_000 }])
    const fetchImpl = vi.fn(
      async () =>
        new Response("Prompt is too long", {
          status: 400,
          headers: { "content-type": "application/json" },
        }),
    )
    const showToast = vi.fn(async (_input: unknown) => ({ data: undefined }))
    const client = {
      app: { log: vi.fn(async () => undefined) },
      auth: { set: vi.fn(async () => undefined) },
      session: {
        prompt: vi.fn(async () => undefined),
        abort: vi.fn(async () => undefined),
        messages: vi.fn(async () => undefined),
      },
      tui: { showToast },
    } as unknown as PluginClient
    await executeAntigravityRequest(
      GEMINI_URL,
      { method: "POST" },
      {
        client,
        providerId: "antigravity",
        config: { ...DEFAULT_CONFIG, quiet_mode: true },
        accountManager: manager,
        fetchImpl: fetchImpl as unknown as typeof fetch,
      },
    )
    expect(showToast).not.toHaveBeenCalled()
  })
})
