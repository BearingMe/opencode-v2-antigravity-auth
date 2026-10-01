import { beforeEach, describe, expect, it, vi } from "vitest"
import { AccountManager } from "./accounts.ts"
import { formatRefreshParts } from "./auth.ts"
import { DEFAULT_CONFIG } from "./config/schema.ts"
import { AntigravityTokenRefreshError } from "./token.ts"
import type { PluginClient } from "./types.ts"

const { mockPrepare, mockTransform, mockEnsureProjectContext, mockRefreshAccessToken } = vi.hoisted(() => ({
  mockPrepare: vi.fn(),
  mockTransform: vi.fn(),
  mockEnsureProjectContext: vi.fn(),
  mockRefreshAccessToken: vi.fn(),
}))

vi.mock("./request.ts", async (importOriginal) => {
  const orig = await importOriginal<typeof import("./request.ts")>()
  return {
    ...orig,
    prepareAntigravityRequest: mockPrepare,
    transformAntigravityResponse: mockTransform,
  }
})

vi.mock("./project.ts", async (importOriginal) => {
  const orig = await importOriginal<typeof import("./project.ts")>()
  return { ...orig, ensureProjectContext: mockEnsureProjectContext }
})

vi.mock("./token.ts", async (importOriginal) => {
  const orig = await importOriginal<typeof import("./token.ts")>()
  return { ...orig, refreshAccessToken: mockRefreshAccessToken }
})

import {
  executeAntigravityRequest,
  extractModelFromUrl,
  formatWaitTime,
  getHeaderStyleFromUrl,
  getModelFamilyFromUrl,
  isNativeEngineEnabled,
  refreshOAuthCredentialUnified,
  resolveHeaderRoutingDecision,
  resolveQuotaFallbackHeaderStyle,
  resetEngineStateForTests,
  __testEngineExports,
} from "./engine.ts"

function makeClient(): PluginClient {
  return {
    tui: { showToast: vi.fn(async () => ({ data: undefined })) },
    auth: { set: vi.fn(async () => ({ data: undefined })) },
  } as unknown as PluginClient
}

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

describe("engine routing helpers (V1 parity)", () => {
  it("forces antigravity headers for claude and honors cli_first for gemini", () => {
    expect(
      getHeaderStyleFromUrl(
        "https://generativelanguage.googleapis.com/v1beta/models/antigravity-claude-opus-4-6:generateContent",
        "claude",
        true,
      ),
    ).toBe("antigravity")
    expect(getHeaderStyleFromUrl(GEMINI_URL, "gemini", false)).toBe("antigravity")
    expect(getHeaderStyleFromUrl(GEMINI_URL, "gemini", true)).toBe("gemini-cli")
  })

  it("allows quota fallback for gemini only", () => {
    const config = { ...DEFAULT_CONFIG, cli_first: false }
    expect(resolveHeaderRoutingDecision(GEMINI_URL, "gemini", config).allowQuotaFallback).toBe(true)
    expect(resolveHeaderRoutingDecision(GEMINI_URL, "claude", config).allowQuotaFallback).toBe(false)
    expect(
      resolveQuotaFallbackHeaderStyle({ family: "claude", headerStyle: "antigravity", alternateStyle: "gemini-cli" }),
    ).toBeNull()
    expect(
      resolveQuotaFallbackHeaderStyle({ family: "gemini", headerStyle: "antigravity", alternateStyle: "antigravity" }),
    ).toBeNull()
    expect(
      resolveQuotaFallbackHeaderStyle({ family: "gemini", headerStyle: "antigravity", alternateStyle: "gemini-cli" }),
    ).toBe("gemini-cli")
  })

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

  it("reads Retry-After headers with V1 precedence", () => {
    const { retryAfterMsFromResponse } = __testEngineExports
    expect(retryAfterMsFromResponse(new Response(null, { headers: { "retry-after-ms": "2500" } }), 60000)).toBe(2500)
    expect(retryAfterMsFromResponse(new Response(null, { headers: { "retry-after": "7" } }), 60000)).toBe(7000)
    expect(retryAfterMsFromResponse(new Response(null), 60000)).toBe(60000)
  })

  it("parses RetryInfo and ErrorInfo from rate-limit bodies", () => {
    const { extractRateLimitBodyInfo } = __testEngineExports
    const retryInfo = extractRateLimitBodyInfo({
      error: {
        message: "slow down",
        details: [
          { "@type": "type.googleapis.com/google.rpc.ErrorInfo", reason: "RATE_LIMIT_EXCEEDED" },
          { "@type": "type.googleapis.com/google.rpc.RetryInfo", retryDelay: "3s" },
        ],
      },
    })
    expect(retryInfo).toMatchObject({ retryDelayMs: 3000, reason: "RATE_LIMIT_EXCEEDED" })

    const quotaDelay = extractRateLimitBodyInfo({
      error: {
        message: "quota hit",
        details: [{ "@type": "type.googleapis.com/google.rpc.ErrorInfo", reason: "QUOTA_EXHAUSTED" }],
      },
    })
    expect(quotaDelay.reason).toBe("QUOTA_EXHAUSTED")

    expect(__testEngineExports.parseDurationToMs("1h16m0.667s")).toBe(3600000 + 960000 + 667)
  })

  it("gates the native engine behind an opt-out flag", () => {
    const previous = process.env.OPENCODE_ANTIGRAVITY_V2_NATIVE
    process.env.OPENCODE_ANTIGRAVITY_V2_NATIVE = "0"
    expect(isNativeEngineEnabled()).toBe(false)
    delete process.env.OPENCODE_ANTIGRAVITY_V2_NATIVE
    expect(isNativeEngineEnabled()).toBe(true)
    if (previous !== undefined) process.env.OPENCODE_ANTIGRAVITY_V2_NATIVE = previous
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
      methodID: "google-oauth",
    }
    const refreshed = await refreshOAuthCredentialUnified(credential, client, "google")
    expect(mockRefreshAccessToken).toHaveBeenCalledOnce()
    expect(refreshed).toMatchObject({
      access: "new-access",
      refresh: "rotated|proj",
      expires: 4242,
      methodID: "google-oauth",
    })
  })
})

describe("executeAntigravityRequest", () => {
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
        headerStyle = "antigravity",
      ) => ({
        request: `https://mock-endpoint/${headerStyle}`,
        init: { method: "POST", headers: {}, body: init?.body },
        streaming: false,
        requestedModel: "gemini-3-pro",
        effectiveModel: "gemini-3-pro",
        projectId,
        endpoint: endpointOverride,
        headerStyle,
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
          providerId: "google",
          config: { ...DEFAULT_CONFIG },
          accountManager: manager,
        },
      ),
    ).rejects.toThrow("No Antigravity accounts available")
  })

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
        providerId: "google",
        config: { ...DEFAULT_CONFIG },
        accountManager: manager,
        fetchImpl: fetchImpl as unknown as typeof fetch,
      },
    )
    expect(response.status).toBe(200)
    expect(fetchImpl).toHaveBeenCalledOnce()
    expect(mockPrepare).toHaveBeenCalledOnce()
    expect(mockPrepare.mock.calls[0]?.[5]).toBe("antigravity")
    expect(mockTransform).toHaveBeenCalledOnce()
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
        providerId: "google",
        config: { ...DEFAULT_CONFIG },
        accountManager: manager,
        fetchImpl: fetchImpl as unknown as typeof fetch,
      },
    )
    expect(response.status).toBe(200)
    expect(fetchImpl).toHaveBeenCalledOnce()
    expect(manager.getTotalAccountCount()).toBe(1)
  })

  it("falls back from antigravity to gemini-cli quota for gemini on QUOTA_EXHAUSTED", async () => {
    const manager = makeManager([{ refreshToken: "rt-1", access: "at-1", expires: Date.now() + 3600_000 }])
    const quotaBody = JSON.stringify({
      error: {
        message: "quota exhausted",
        details: [{ "@type": "type.googleapis.com/google.rpc.ErrorInfo", reason: "QUOTA_EXHAUSTED" }],
      },
    })
    const fetchImpl = vi.fn(async (input: unknown) => {
      const url = String(input)
      if (url.includes("antigravity")) {
        return new Response(quotaBody, { status: 429, headers: { "content-type": "application/json" } })
      }
      return new Response("{}", { status: 200, headers: { "content-type": "application/json" } })
    })
    const response = await executeAntigravityRequest(
      GEMINI_URL,
      { method: "POST" },
      {
        client: makeClient(),
        providerId: "google",
        config: { ...DEFAULT_CONFIG },
        accountManager: manager,
        fetchImpl: fetchImpl as unknown as typeof fetch,
      },
    )
    expect(response.status).toBe(200)
    expect(fetchImpl).toHaveBeenCalledTimes(2)
    expect(mockPrepare.mock.calls[0]?.[5]).toBe("antigravity")
    expect(mockPrepare.mock.calls[1]?.[5]).toBe("gemini-cli")
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
        providerId: "google",
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
        providerId: "google",
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
        providerId: "google",
        config: { ...DEFAULT_CONFIG, quiet_mode: true },
        accountManager: manager,
        fetchImpl: fetchImpl as unknown as typeof fetch,
      },
    )
    expect(showToast).not.toHaveBeenCalled()
  })
})
