import { beforeEach, describe, expect, it, vi } from "vitest"

const {
  authorizeAntigravity,
  exchangeAntigravity,
  loadAccounts,
  updateAccounts,
  verifyAccountAccess,
  mockNativeFetch,
  mockLoadManager,
  mockUnifiedRefresh,
  mockRefreshQueue,
  mockCreateRefreshQueue,
  createdRefreshQueues,
  resetRefreshQueueMocks,
  lifecycleEvents,
  mockDisposeResources,
  written,
} = vi.hoisted(() => {
  const lifecycleEvents: string[] = []
  /** Builds an observable queue double with its own lifecycle identity. */
  const makeRefreshQueue = (id: number) => ({
    setAccountManager: vi.fn(() => lifecycleEvents.push(`queue-${id}:set-manager`)),
    start: vi.fn(() => lifecycleEvents.push(`queue-${id}:start`)),
    stop: vi.fn(() => lifecycleEvents.push(`queue-${id}:stop`)),
  })
  const mockRefreshQueue = makeRefreshQueue(1)
  const createdRefreshQueues: Array<typeof mockRefreshQueue> = [mockRefreshQueue]
  let returnInitialQueue = true
  const mockCreateRefreshQueue = vi.fn(() => {
    if (returnInitialQueue) {
      returnInitialQueue = false
      lifecycleEvents.push("create-queue-1")
      return mockRefreshQueue
    }
    const id = createdRefreshQueues.length + 1
    const queue = makeRefreshQueue(id)
    createdRefreshQueues.push(queue)
    lifecycleEvents.push(`create-queue-${id}`)
    return queue
  })
  return {
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
    updateAccounts: vi.fn(),
    verifyAccountAccess: vi.fn(async () => ({ status: "ok" as const, message: "verified" })),
    mockNativeFetch: vi.fn(),
    mockLoadManager: vi.fn(),
    mockUnifiedRefresh: vi.fn(async (credential: unknown) => credential),
    mockRefreshQueue,
    mockCreateRefreshQueue,
    createdRefreshQueues,
    resetRefreshQueueMocks: () => {
      returnInitialQueue = true
      createdRefreshQueues.length = 0
      createdRefreshQueues.push(mockRefreshQueue)
    },
    lifecycleEvents,
    mockDisposeResources: vi.fn(async () => undefined),
    written: [] as unknown[],
  }
})

// Transactional storage mock mirroring adapters/filesystem/account-store.ts updateAccounts:
// the updater runs against a clone of the latest loadAccounts value and its
// replacement store is recorded. Unchanged inputs record nothing.
updateAccounts.mockImplementation(
  async (updater: (current: unknown) => Promise<{ storage: unknown; result: unknown }>) => {
    const current = (await loadAccounts()) ?? { version: 4, accounts: [], activeIndex: 0 }
    const input = structuredClone(current)
    const { storage, result } = await updater(input)
    if (storage !== input) {
      written.push(storage)
      loadAccounts.mockResolvedValue(storage)
    }
    return result
  },
)

vi.mock("../../plugin/verify.js", () => ({
  verifyAccountAccess,
}))

vi.mock("../../plugin/version.js", () => ({
  initAntigravityVersion: vi.fn(async () => undefined),
}))

vi.mock("../../antigravity/oauth.js", () => ({ authorizeAntigravity, exchangeAntigravity }))
vi.mock("../filesystem/account-store.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../filesystem/account-store.js")>()
  return { ...actual, loadAccounts, updateAccounts }
})
vi.mock("../../app/composition.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../app/composition.js")>()),
  executeAntigravityRequest: mockNativeFetch,
  disposeAntigravityRuntimeResources: mockDisposeResources,
  refreshOAuthCredentialUnified: mockUnifiedRefresh,
}))
vi.mock("./account-pool.js", () => ({
  AccountManager: { loadFromDisk: mockLoadManager },
}))
vi.mock("../../plugin/refresh-queue.js", () => ({
  createProactiveRefreshQueue: mockCreateRefreshQueue,
}))

import { opencodePlugin as plugin, createChildSessionTracker, refreshOAuthCredential } from "./plugin.js"
const sdkPackage = new URL("./google-sdk.js", import.meta.url).href

describe("V2 Antigravity runtime bridge", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    lifecycleEvents.length = 0
    resetRefreshQueueMocks()
    written.length = 0
    loadAccounts.mockResolvedValue({
      version: 4,
      accounts: [
        {
          email: "old@example.com",
          refreshToken: "old-refresh-token",
          projectId: "old-project",
          addedAt: 1,
          lastUsed: 2,
        },
      ],
      activeIndex: 0,
    })
    mockLoadManager.mockResolvedValue({ index: "native-manager", getAccountCount: () => 1 })
    mockNativeFetch.mockImplementation(async () => new Response("native-ok"))
  })

  it("registers a standalone Antigravity provider and routes its SDK requests through the native engine", async () => {
    let modelDefinitions: Array<Record<string, unknown>> = []
    let integrationMethod: Record<string, unknown> | undefined
    const integrationName: { name?: string } = {}
    const updateIntegration = vi.fn((_id: string, update: (integration: { name?: string }) => void) =>
      update(integrationName),
    )
    let antigravityProviderInfo: { id?: string; name?: string; activation?: string; package?: string } | undefined
    const getProvider = vi.fn((): { models: Map<string, unknown> } | undefined => undefined)
    const addProvider = vi.fn(
      (input: { info: typeof antigravityProviderInfo; models: Array<Record<string, unknown>> }) => {
        antigravityProviderInfo = input.info ?? undefined
        modelDefinitions = input.models
      },
    )
    let providerTransform: ((editor: unknown) => void) | undefined
    let sdkHook:
      | ((event: {
          package: string
          model: { id: string }
          options: Record<string, unknown>
          sdk?: unknown
        }) => Promise<void> | void)
      | undefined
    type ContextMessage = {
      role: string
      content: Array<{ type: string; id?: string; name?: string; result?: unknown }>
    }
    let contextHook: ((event: { sessionID: string; messages: ContextMessage[] }) => Promise<void> | void) | undefined
    let cleanup: (() => void) | void

    const connection = { id: "antigravity-connection" }
    let activeConnection: typeof connection | undefined = connection
    let credential: unknown = {
      type: "oauth",
      access: "access-token",
      refresh: "refresh-token|project-id",
      expires: Date.now() + 60_000,
    }
    const accountsDispose = vi.fn()
    let replayIntegration: (() => void) | undefined
    const ctx = {
      location: { directory: "C:/test-project" },
      integration: {
        reload: vi.fn(async () => {
          replayIntegration?.()
        }),
        transform: async (callback: (editor: unknown) => void) => {
          replayIntegration = () =>
            callback({
              get: vi.fn(),
              update: updateIntegration,
              method: {
                update: (value: Record<string, unknown>) => {
                  integrationMethod = value
                },
              },
            })
          replayIntegration()
        },
        connection: {
          active: vi.fn(async (integrationID: string) =>
            integrationID === "antigravity" ? activeConnection : undefined,
          ),
          resolve: vi.fn(async () => credential),
        },
      },
      provider: {
        transform: async (callback: (editor: unknown) => void) => {
          providerTransform = callback
          callback({
            get: getProvider,
            update: (_id: string, update: (provider: { activation?: string; package?: string }) => void) =>
              update(antigravityProviderInfo ?? {}),
            models: {
              set: (_id: string, models: Array<Record<string, unknown>>) => {
                modelDefinitions = models
              },
            },
            add: addProvider,
          })
        },
      },
      model: {
        transform: async (callback: (editor: unknown) => void) =>
          callback({
            list: () => modelDefinitions,
            update: (_providerID: string, modelID: string, update: (model: Record<string, unknown>) => void) => {
              const model = modelDefinitions.find((item) => item.id === modelID)
              if (model) update(model)
            },
          }),
      },
      aisdk: {
        hook: vi.fn(async (_name: string, callback: typeof sdkHook) => {
          sdkHook = callback
        }),
      },
      session: {
        hook: vi.fn(
          async (
            name: string,
            callback: (event: { sessionID: string; messages: ContextMessage[] }) => Promise<void> | void,
          ) => {
            if (name === "context") contextHook = callback
            return { dispose: vi.fn() }
          },
        ),
      },
      tool: { transform: async (callback: (editor: unknown) => void) => callback({ add: vi.fn() }) },
      rpc: {
        register: vi.fn(async () => ({ dispose: accountsDispose })),
      },
      event: { subscribe: async function* () {} },
    }

    cleanup = await plugin.setup(ctx as never)
    expect(ctx.session.hook).toHaveBeenCalledWith("context", expect.any(Function))
    expect(ctx.session.hook).toHaveBeenCalledWith("retry", expect.any(Function))

    const contextEvent = {
      sessionID: "ses-recovery-test",
      messages: [
        {
          role: "assistant",
          content: [{ type: "tool-call", id: "call-1", name: "search" }],
        },
      ],
    }
    await contextHook?.(contextEvent)
    expect(contextEvent.messages).toHaveLength(2)
    expect(contextEvent.messages[1]).toMatchObject({
      role: "tool",
      content: [
        {
          type: "tool-result",
          id: "call-1",
          name: "search",
          result: { type: "text", value: "Operation cancelled by user (ESC pressed)" },
        },
      ],
    })

    expect(modelDefinitions.map((model) => String(model.id)).sort()).toEqual([
      "antigravity-claude-opus-4-6-thinking",
      "antigravity-claude-sonnet-4-6-thinking",
      "antigravity-gemini-3.1-pro",
      "antigravity-gemini-3.6-flash",
      "antigravity-gemini-3.7-flash",
      "antigravity-gemini-3.8-flash",
      "antigravity-gpt-oss-120b-medium",
    ])
    expect(addProvider).toHaveBeenCalledOnce()
    expect(antigravityProviderInfo).toMatchObject({
      id: "antigravity",
      name: "Antigravity",
      activation: "enabled",
      package: `aisdk:${sdkPackage}`,
    })
    expect(getProvider).toHaveBeenCalledWith("antigravity")
    const geminiFlash = modelDefinitions.find((model) => model.id === "antigravity-gemini-3.8-flash")
    const geminiPreviewAlias = modelDefinitions.find((model) => model.id === "gemini-3-flash-preview")
    expect(geminiFlash?.name).toBe("Gemini 3.8 Flash")
    expect(geminiFlash?.package).toBe(`aisdk:${sdkPackage}`)
    expect(geminiPreviewAlias).toBeUndefined()

    const replaceModels = vi.fn((_providerID: string, models: Array<Record<string, unknown>>) => {
      modelDefinitions = models
    })
    getProvider.mockReturnValue({ models: new Map([["api-only-model", { id: "api-only-model" }]]) })
    if (!providerTransform) throw new Error("expected provider transform")
    providerTransform({
      get: getProvider,
      update: (_id: string, update: (provider: { activation?: string; package?: string }) => void) =>
        update(antigravityProviderInfo ?? {}),
      models: { set: replaceModels },
      add: addProvider,
    })
    expect(replaceModels).toHaveBeenCalledOnce()
    expect(modelDefinitions.some((model) => model.id === "api-only-model")).toBe(false)
    expect(addProvider).toHaveBeenCalledOnce()

    expect(updateIntegration).toHaveBeenCalledExactlyOnceWith("antigravity", expect.any(Function))
    expect(ctx.integration.connection.active.mock.calls.every(([id]) => id === "antigravity")).toBe(true)
    expect(integrationName.name).toBe("Antigravity")
    expect(ctx.aisdk.hook).toHaveBeenCalledWith("sdk", expect.any(Function), { providerID: "antigravity" })
    const claudeModel = modelDefinitions.find((model) => model.id === "antigravity-claude-opus-4-6-thinking")
    expect(claudeModel?.package).toBe(`aisdk:${sdkPackage}`)
    expect((claudeModel?.settings as Record<string, unknown>)?.fetch).toBeUndefined()
    expect(sdkHook).toEqual(expect.any(Function))
    const rpcRegister = ctx.rpc.register as unknown as {
      mock: { calls: Array<[unknown, Record<string, (input: unknown) => Promise<unknown>>]> }
    }
    expect(rpcRegister.mock.calls).toHaveLength(1)
    expect(rpcRegister.mock.calls[0]?.[0]).toBeDefined()
    const handlers = rpcRegister.mock.calls[0]?.[1]
    expect(handlers).toBeDefined()
    if (!handlers) throw new Error("expected RPC handlers")
    expect(Object.keys(handlers).sort()).toEqual(["deleteAll", "list", "mutate", "ping", "quota", "verify"])
    /** Invokes a registered RPC handler and fails clearly when it is absent. */
    const call = async (name: string, input: unknown) => {
      const handler = handlers[name]
      if (!handler) throw new Error(`missing RPC handler: ${name}`)
      return handler(input)
    }
    await expect(call("ping", {})).resolves.toBe("ANTIGRAVITY_RPC_ACCOUNTS_OK")
    expect(integrationMethod).toBeDefined()
    expect(typeof integrationMethod?.refresh).toBe("function")
    const label = integrationMethod?.label as (credential: {
      refresh: string
      metadata?: Record<string, unknown>
    }) => string | undefined
    expect(label({ refresh: "old-refresh-token|old-project" })).toBe("old@example.com")
    expect(label({ refresh: "other-token", metadata: { email: "connected@example.com" } })).toBe(
      "connected@example.com",
    )
    expect(integrationMethod?.integrationID).toBe("antigravity")
    expect(integrationMethod?.method).toMatchObject({ id: "antigravity-oauth" })
    expect(integrationMethod?.method).toMatchObject({
      form: [
        {
          key: "accountAction",
          required: true,
          description: expect.stringContaining("old@example.com"),
          options: [{ value: "add" }],
        },
      ],
    })
    expect(integrationMethod?.method).not.toHaveProperty("login")
    expect(integrationMethod?.method).toHaveProperty("form.0.options", [expect.objectContaining({ value: "add" })])

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

    // Google SDK events aren't handled by this provider-scoped bridge.
    const googleOptions = { apiKey: "google-api-key" }
    const googleEvent = { package: "@ai-sdk/google", model: { id: "gemini-2.5-flash" }, options: googleOptions }
    await sdkHook?.(googleEvent)
    expect(googleEvent.options).toBe(googleOptions)
    expect(ctx.integration.connection.active).not.toHaveBeenCalled()

    activeConnection = undefined
    loadAccounts.mockResolvedValue({ version: 4, accounts: [], activeIndex: 0 })
    await expect(
      sdkHook?.({
        package: sdkPackage,
        model: { id: "antigravity-gemini-3.8-flash-tiered" },
        options: {},
      }),
    ).rejects.toThrow("Antigravity OAuth is not connected")

    activeConnection = connection
    credential = {
      type: "oauth",
      access: "access-token",
      refresh: "refresh-token|project-id",
      expires: Date.now() + 60_000,
    }
    loadAccounts.mockResolvedValue({
      version: 4,
      accounts: [
        {
          email: "old@example.com",
          refreshToken: "old-refresh-token",
          projectId: "old-project",
          addedAt: 1,
          lastUsed: 2,
        },
      ],
      activeIndex: 0,
    })

    const authorize = integrationMethod?.authorize as (answer: Record<string, string>) => Promise<{
      mode: string
      instructions: string
      callback: (code: string) => Promise<{ refresh: string; access: string }>
    }>
    // Missing/legacy answers (including the removed Exit) may not generate an OAuth URL.
    authorizeAntigravity.mockClear()
    await expect(authorize({ accountAction: "exit" })).rejects.toThrow("Choose Add")
    await expect(authorize({})).rejects.toThrow("Choose Add")
    await expect(authorize({ accountAction: "replace" })).rejects.toThrow("Choose Add")
    expect(authorizeAntigravity).not.toHaveBeenCalled()
    const authorization = await authorize({ accountAction: "add", projectId: "ignored-project" })
    expect(authorizeAntigravity).toHaveBeenCalledWith("")
    expect(authorization.mode).toBe("code")
    expect(authorization.instructions).toContain("authorization code")
    expect(authorization.instructions).not.toContain("Menu:")
    // Cancelling before callback has no persistence side effect.
    expect(updateAccounts).not.toHaveBeenCalled()
    const login = await authorization.callback("oauth-code")
    expect(integrationMethod?.method).toMatchObject({ form: [{ description: expect.stringContaining("2/10") }] })
    expect(login.refresh).toBe("new-refresh-token|new-project")
    expect(written[0]).toMatchObject({
      accounts: expect.arrayContaining([
        expect.objectContaining({ refreshToken: "old-refresh-token" }),
        expect.objectContaining({ refreshToken: "new-refresh-token", email: "new@example.com" }),
      ]),
      activeIndex: 1,
    })

    written.length = 0
    updateAccounts.mockClear()
    exchangeAntigravity.mockRejectedValueOnce(new Error("OAuth denied"))
    await expect(authorization.callback("denied-code")).rejects.toThrow("OAuth denied")
    expect(updateAccounts).not.toHaveBeenCalled()

    const fullPool = Array.from({ length: 10 }, (_, index) => ({
      id: `account-${index}`,
      email: `saved-${index}@example.com`,
      refreshToken: `saved-token-${index}`,
      addedAt: 1,
      lastUsed: 2,
    }))
    loadAccounts.mockResolvedValue({ version: 4, accounts: fullPool, activeIndex: 0 })
    const atCap = await authorize({ accountAction: "add" })
    expect(atCap.instructions).toContain("Maximum of 10 Antigravity accounts reached")
    await expect(atCap.callback("new-account-code")).rejects.toThrow("Maximum of 10 Antigravity accounts reached")
    // The throwing updater aborts the transaction without recording a store.
    expect(written).toHaveLength(0)

    exchangeAntigravity.mockResolvedValueOnce({
      type: "success",
      refresh: "rotated-existing-token",
      access: "new-access-token",
      expires: Date.now() + 3600_000,
      email: "SAVED-0@example.com",
      projectId: "auto-project",
    })
    await atCap.callback("existing-account-code")
    expect(updateAccounts).toHaveBeenCalledTimes(2)
    expect(written).toHaveLength(1)
    expect(written[0]).toMatchObject({
      accounts: [
        expect.objectContaining({ id: "account-0", refreshToken: "rotated-existing-token" }),
        ...fullPool.slice(1),
      ],
    })

    // Every RPC method output is credential-free even with token material
    // seeded. Placed after the auth assertions: mutate/deleteAll repoint the
    // in-memory auth, which earlier assertions must not observe.
    loadAccounts.mockResolvedValue({
      version: 4,
      accounts: [
        {
          id: "acc-one",
          email: "one@example.com",
          refreshToken: "secret-refresh-token-one",
          projectId: "p1",
          addedAt: 1,
          lastUsed: 2,
        },
        {
          id: "acc-two",
          email: "two@example.com",
          refreshToken: "secret-refresh-token-two",
          projectId: "p2",
          addedAt: 2,
          lastUsed: 3,
        },
      ],
      activeIndex: 0,
    })
    /** Asserts that an RPC result contains no seeded credential material. */
    const scanSecrets = (value: unknown) => {
      const text = JSON.stringify(value)
      expect(text).not.toContain("secret-refresh-token-one")
      expect(text).not.toContain("secret-refresh-token-two")
      expect(text).not.toContain("refreshParts")
      expect(text).not.toContain("updatedAccount")
      expect(text).not.toContain("access-token")
    }
    scanSecrets(await call("list", {}))
    scanSecrets(await call("quota", { refresh: false }))
    scanSecrets(await call("verify", { id: "acc-one" }))
    scanSecrets(await call("mutate", { id: "acc-one", op: "disable" }))
    expect(integrationMethod?.method).toMatchObject({
      form: [{ description: expect.stringContaining("one@example.com (disabled)") }],
    })
    // Stale ids fail closed without writing.
    const staleWrites = written.length
    const stale = await call("mutate", { id: "acc-missing", op: "select" })
    expect(stale).toMatchObject({ ok: false, kind: "not-found" })
    scanSecrets(stale)
    expect(written.length).toBe(staleWrites)
    scanSecrets(await call("deleteAll", {}))
    expect(integrationMethod?.method).toMatchObject({ form: [{ description: expect.stringContaining("0/10") }] })

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
    expect(ctx.integration.connection.active).toHaveBeenCalledWith("antigravity")
    expect(sdkEvent.sdk).toBeDefined()
    expect(sdkOptions.apiKey).toBe("antigravity-oauth")
    const fetchModel = sdkOptions as { fetch: (input: string, init: RequestInit) => Promise<Response> }
    const payload = JSON.stringify({ contents: [{ role: "user", parts: [{ text: "hello" }] }] })
    const requestUrl =
      "https://generativelanguage.googleapis.com/v1beta/models/antigravity-claude-opus-4-6-thinking:generateContent"
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
    expect(mockNativeFetch.mock.calls[0]?.[2]).toMatchObject({ providerId: "antigravity" })
    expect(mockRefreshQueue.setAccountManager).toHaveBeenCalledOnce()
    expect(mockRefreshQueue.start).toHaveBeenCalledOnce()

    // A successful account mutation stops the old queue and manager. The next
    // native request creates a fresh manager and proactive queue.
    loadAccounts.mockResolvedValue({
      version: 4,
      accounts: [{ id: "acc-one", email: "one@example.com", refreshToken: "token-one", addedAt: 1, lastUsed: 1 }],
      activeIndex: 0,
    })
    await call("mutate", { id: "acc-one", op: "enable" })
    expect(mockRefreshQueue.stop).toHaveBeenCalledOnce()
    await fetchModel.fetch(requestUrl, requestInit)
    expect(mockLoadManager).toHaveBeenCalledTimes(2)
    expect(mockCreateRefreshQueue).toHaveBeenCalledTimes(2)
    expect(createdRefreshQueues).toHaveLength(2)
    expect(createdRefreshQueues[1]).not.toBe(createdRefreshQueues[0])
    expect(lifecycleEvents).toEqual([
      "create-queue-1",
      "queue-1:set-manager",
      "queue-1:start",
      "queue-1:stop",
      "create-queue-2",
      "queue-2:set-manager",
      "queue-2:start",
    ])

    expect(cleanup).toEqual(expect.any(Function))
    await cleanup?.()
    expect(accountsDispose).toHaveBeenCalledOnce()
    expect(mockRefreshQueue.stop).toHaveBeenCalledOnce()
    expect(createdRefreshQueues[1]?.stop).toHaveBeenCalledOnce()
    expect(mockDisposeResources).toHaveBeenCalledOnce()
  })

  it("refreshes OAuth credentials through the unified token path", async () => {
    const credential = {
      type: "oauth" as const,
      access: "old-access",
      refresh: "old-refresh|old-project",
      expires: 1,
      methodID: "antigravity-oauth",
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
