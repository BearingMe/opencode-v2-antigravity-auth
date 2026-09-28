import { beforeEach, describe, expect, it, vi } from "vitest"

const { authorizeAntigravity, exchangeAntigravity, loadAccounts, saveAccountsReplace, verifyAccountAccess, mockNativeFetch, mockLoadManager, mockUnifiedRefresh, mockRefreshQueue, mockDisposeResources } = vi.hoisted(() => ({
  authorizeAntigravity: vi.fn(async () => ({
    url: "https://accounts.google.com/auth?state=encoded-state",
    verifier: "verifier",
    projectId: "",
  })),
  exchangeAntigravity: vi.fn(async () => ({
    type: "success" as const,
    refresh: "new-refresh-token",
    access: "new-access-token",
    expires: Date.now() + 3600_000,
    email: "new@example.com",
    projectId: "new-project",
  })),
  loadAccounts: vi.fn(),
  saveAccountsReplace: vi.fn(async () => undefined),
  verifyAccountAccess: vi.fn(async () => ({ status: "ok" as const, message: "verified" })),
  mockNativeFetch: vi.fn(),
  mockLoadManager: vi.fn(),
  mockUnifiedRefresh: vi.fn(async (credential: unknown) => credential),
  mockRefreshQueue: {
    setAccountManager: vi.fn(),
    start: vi.fn(),
    stop: vi.fn(),
  },
  mockDisposeResources: vi.fn(async () => undefined),
}))

vi.mock("./plugin/verify.js", () => ({
  verifyAccountAccess,
}))

vi.mock("./plugin/version.js", () => ({
  initAntigravityVersion: vi.fn(async () => undefined),
}))

vi.mock("./antigravity/oauth.js", () => ({ authorizeAntigravity, exchangeAntigravity }))
vi.mock("./plugin/storage.js", () => ({ loadAccounts, saveAccountsReplace }))
vi.mock("./plugin/engine.js", () => ({
  executeAntigravityRequest: mockNativeFetch,
  disposeAntigravityRuntimeResources: mockDisposeResources,
  refreshOAuthCredentialUnified: mockUnifiedRefresh,
}))
vi.mock("./plugin/accounts.js", () => ({
  AccountManager: { loadFromDisk: mockLoadManager },
}))
vi.mock("./plugin/refresh-queue.js", () => ({
  createProactiveRefreshQueue: vi.fn(() => mockRefreshQueue),
}))

import plugin, { createChildSessionTracker, refreshOAuthCredential } from "./v2-plugin.js"
const sdkPackage = new URL("./google-sdk.js", import.meta.url).href

describe("V2 Antigravity runtime bridge", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    loadAccounts.mockResolvedValue({
      version: 4,
      accounts: [{ email: "old@example.com", refreshToken: "old-refresh-token", projectId: "old-project", addedAt: 1, lastUsed: 2 }],
      activeIndex: 0,
    })
    mockLoadManager.mockResolvedValue({ index: "native-manager", getAccountCount: () => 1 })
    mockNativeFetch.mockImplementation(async () => new Response("native-ok"))
  })

  it("registers Antigravity models on Google and routes SDK JSON through the native engine", async () => {
    let modelDefinitions: Array<Record<string, unknown>> = []
    let integrationMethod: Record<string, unknown> | undefined
    const googleProviderInfo: { activation?: string; package?: string } = { activation: "auto", package: "@opencode/ai/providers/google" }
    let sdkHook: ((event: {
      package: string
      model: { id: string }
      options: Record<string, unknown>
      sdk?: unknown
    }) => Promise<void> | void) | undefined
    let cleanup: (() => void) | void

    const connection = { id: "google-connection" }
    let activeConnection: typeof connection | undefined = connection
    let credential: unknown = {
      type: "oauth",
      access: "access-token",
      refresh: "refresh-token|project-id",
      expires: Date.now() + 60_000,
    }
    const ctx = {
      location: { directory: "C:/test-project" },
      integration: {
        transform: async (callback: (editor: unknown) => void) => callback({
          update: vi.fn(),
          method: { update: (value: Record<string, unknown>) => { integrationMethod = value } },
        }),
        connection: {
          active: vi.fn(async () => activeConnection),
          resolve: vi.fn(async () => credential),
        },
      },
      provider: {
        transform: async (callback: (editor: unknown) => void) => callback({
          get: () => ({ models: new Map([[
            "antigravity-gemini-3.8-flash-tiered",
            {
              id: "antigravity-gemini-3.8-flash-tiered",
              package: "@opencode/ai/providers/google",
              settings: {},
            },
          ]]), info: googleProviderInfo }),
          update: (_id: string, update: (provider: { activation?: string; package?: string }) => void) => update(googleProviderInfo),
          models: { set: (_id: string, models: Array<Record<string, unknown>>) => { modelDefinitions = models } },
          add: vi.fn(),
        }),
      },
      model: {
        transform: async (callback: (editor: unknown) => void) => callback({
          list: () => modelDefinitions,
          update: (_providerID: string, modelID: string, update: (model: Record<string, unknown>) => void) => {
            const model = modelDefinitions.find((item) => item.id === modelID)
            if (model) update(model)
          },
        }),
      },
      aisdk: {
        hook: vi.fn(async (_name: string, callback: typeof sdkHook) => { sdkHook = callback }),
      },
      session: { hook: vi.fn(async () => ({ dispose: vi.fn() })) },
      tool: { transform: async (callback: (editor: unknown) => void) => callback({ add: vi.fn() }) },
      event: { subscribe: async function* () {} },
    }

    cleanup = await plugin.setup(ctx as never)

    expect(modelDefinitions.length).toBeGreaterThan(0)
    expect(googleProviderInfo.activation).toBe("enabled")
    expect(googleProviderInfo.package).toBe(`aisdk:${sdkPackage}`)
    const claudeModel = modelDefinitions.find((model) => model.id === "antigravity-claude-opus-4-6-thinking")
    const customGeminiModel = modelDefinitions.find((model) => model.id === "antigravity-gemini-3.8-flash-tiered")
    expect(claudeModel?.package).toBe(`aisdk:${sdkPackage}`)
    expect(customGeminiModel?.package).toBe(`aisdk:${sdkPackage}`)
    expect((claudeModel?.settings as Record<string, unknown>)?.fetch).toBeUndefined()
    expect(sdkHook).toEqual(expect.any(Function))
    expect(integrationMethod).toBeDefined()
    expect(typeof integrationMethod?.refresh).toBe("function")
    const label = integrationMethod?.label as (credential: { refresh: string; metadata?: Record<string, unknown> }) => string | undefined
    expect(label({ refresh: "old-refresh-token|old-project" })).toBe("old@example.com")
    expect(label({ refresh: "other-token", metadata: { email: "connected@example.com" } })).toBe("connected@example.com")
    expect(JSON.stringify(integrationMethod?.method)).toContain("saved: old@example.com")

    const sdkOptions: Record<string, unknown> = {}
    const unnormalizedSdkEvent: {
      package: string
      model: { id: string }
      options: Record<string, unknown>
      sdk?: unknown
    } = {
      package: "aisdk:@ai-sdk/google",
      model: { id: "antigravity-claude-opus-4-6-thinking" },
      options: {},
    }
    await sdkHook?.(unnormalizedSdkEvent)
    expect(unnormalizedSdkEvent.sdk).toBeUndefined()

    // API-key passthrough is preserved: ordinary Gemini models keep their own route.
    credential = { type: "api", key: "google-api-key" }
    loadAccounts.mockResolvedValue({
      version: 4,
      accounts: [{ email: "saved@example.com", refreshToken: "saved-refresh", addedAt: 1, lastUsed: 2 }],
      activeIndex: 0,
    })
    const ordinaryGeminiOptions = { apiKey: "real-google-api-key" }
    const ordinaryGeminiEvent = {
      package: sdkPackage,
      model: { id: "gemini-2.5-flash" },
      options: ordinaryGeminiOptions,
    }
    await sdkHook?.(ordinaryGeminiEvent)
    expect(ordinaryGeminiEvent.options).toBe(ordinaryGeminiOptions)
    expect(ordinaryGeminiEvent.options.apiKey).toBe("real-google-api-key")
    expect("fetch" in ordinaryGeminiEvent.options).toBe(false)

    activeConnection = undefined
    loadAccounts.mockResolvedValue({ version: 4, accounts: [], activeIndex: 0 })
    await expect(sdkHook?.({
      package: sdkPackage,
      model: { id: "antigravity-gemini-3.8-flash-tiered" },
      options: {},
    })).rejects.toThrow("Antigravity OAuth is not connected")

    activeConnection = connection
    credential = {
      type: "oauth",
      access: "access-token",
      refresh: "refresh-token|project-id",
      expires: Date.now() + 60_000,
    }
    loadAccounts.mockResolvedValue({
      version: 4,
      accounts: [{ email: "old@example.com", refreshToken: "old-refresh-token", projectId: "old-project", addedAt: 1, lastUsed: 2 }],
      activeIndex: 0,
    })

    const authorize = integrationMethod?.authorize as (answer: Record<string, string>) => Promise<{
      mode: string
      callback: (code: string) => Promise<{ refresh: string; access: string }>
    }>
    const authorization = await authorize({ accountAction: "add" })
    const login = await authorization.callback("oauth-code")
    expect(login.refresh).toBe("new-refresh-token|new-project")
    expect(saveAccountsReplace).toHaveBeenCalledWith(expect.objectContaining({
      accounts: expect.arrayContaining([
        expect.objectContaining({ refreshToken: "old-refresh-token" }),
        expect.objectContaining({ refreshToken: "new-refresh-token", email: "new@example.com" }),
      ]),
      activeIndex: 1,
    }))

    const sdkEvent: {
      package: string
      model: { id: string }
      options: Record<string, unknown>
      sdk?: unknown
    } = {
      package: sdkPackage,
      model: { id: "antigravity-claude-opus-4-6-thinking" },
      options: sdkOptions,
    }
    await sdkHook?.(sdkEvent)
    expect(sdkEvent.sdk).toBeDefined()
    expect(sdkOptions.apiKey).toBe("antigravity-oauth")
    const fetchModel = sdkOptions as { fetch: (input: string, init: RequestInit) => Promise<Response> }
    const payload = JSON.stringify({ contents: [{ role: "user", parts: [{ text: "hello" }] }] })
    const requestUrl = "https://generativelanguage.googleapis.com/v1beta/models/antigravity-claude-opus-4-6-thinking:generateContent"
    const requestInit = {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: new TextEncoder().encode(payload),
    }

    // Native engine path: SDK JSON bytes are decoded and dispatched natively
    // with zero V1 harness involvement.
    const nativeResponse = await fetchModel.fetch(requestUrl, requestInit)
    expect(await nativeResponse.text()).toBe("native-ok")
    expect(mockNativeFetch).toHaveBeenCalledOnce()
    expect(mockNativeFetch.mock.calls[0]?.[0]).toBe(requestUrl)
    expect(mockNativeFetch.mock.calls[0]?.[1]?.body).toBe(payload)
    expect(mockNativeFetch.mock.calls[0]?.[2]).toMatchObject({ providerId: "google" })
    expect(mockRefreshQueue.setAccountManager).toHaveBeenCalledOnce()
    expect(mockRefreshQueue.start).toHaveBeenCalledOnce()

    expect(cleanup).toEqual(expect.any(Function))
    cleanup?.()
    expect(mockRefreshQueue.stop).toHaveBeenCalledOnce()
    expect(mockDisposeResources).toHaveBeenCalledOnce()
  })

  it("refreshes OAuth credentials through the unified token path", async () => {
    const credential = {
      type: "oauth" as const,
      access: "old-access",
      refresh: "old-refresh|old-project",
      expires: 1,
      methodID: "google-oauth",
    }
    mockUnifiedRefresh.mockResolvedValueOnce({ ...credential, access: "new-access" })
    const refreshed = await refreshOAuthCredential(credential, {} as never)
    expect(mockUnifiedRefresh).toHaveBeenCalledOnce()
    expect(refreshed.access).toBe("new-access")
  })
})

describe("createChildSessionTracker", () => {
  it("classifies unknown sessions as root so toasts stay on", () => {
    const tracker = createChildSessionTracker()

    expect(tracker.isChildSession()).toBe(false)
    expect(tracker.isChildSession("never-seen")).toBe(false)

    tracker.remember("child-1", true)
    expect(tracker.isChildSession()).toBe(false)
    expect(tracker.isChildSession("never-seen")).toBe(false)
    expect(tracker.isChildSession("child-1")).toBe(true)
  })

  it("classifies each tracked id independently across interleaved root/child events", () => {
    const tracker = createChildSessionTracker()

    tracker.remember("child-1", true)
    tracker.remember("root-1", false)
    tracker.remember("child-2", true)
    tracker.remember("root-2", false)

    expect(tracker.isChildSession("child-1")).toBe(true)
    expect(tracker.isChildSession("child-2")).toBe(true)
    expect(tracker.isChildSession("root-1")).toBe(false)
    expect(tracker.isChildSession("root-2")).toBe(false)
    expect(tracker.isChildSession()).toBe(false)
  })

  it("forgets a child session once it is recorded as root", () => {
    const tracker = createChildSessionTracker()

    tracker.remember("session-1", true)
    expect(tracker.isChildSession("session-1")).toBe(true)

    tracker.remember("session-1", false)
    expect(tracker.isChildSession("session-1")).toBe(false)
    expect(tracker.isChildSession()).toBe(false)
  })

  it("bounds tracked child sessions", () => {
    const tracker = createChildSessionTracker(2)

    tracker.remember("child-1", true)
    tracker.remember("child-2", true)
    tracker.remember("child-3", true)

    expect(tracker.trackedChildCount()).toBe(2)
    expect(tracker.isChildSession("child-1")).toBe(false)
    expect(tracker.isChildSession("child-3")).toBe(true)
  })

  it("keeps all tracked ids on duplicate registration at capacity", () => {
    const tracker = createChildSessionTracker(2)

    tracker.remember("child-1", true)
    tracker.remember("child-2", true)
    tracker.remember("child-1", true)

    expect(tracker.trackedChildCount()).toBe(2)
    expect(tracker.isChildSession("child-1")).toBe(true)
    expect(tracker.isChildSession("child-2")).toBe(true)
  })

  it("ignores events without a session id", () => {
    const tracker = createChildSessionTracker()

    tracker.remember(undefined, true)
    expect(tracker.isChildSession()).toBe(false)
    expect(tracker.trackedChildCount()).toBe(0)
  })
})
