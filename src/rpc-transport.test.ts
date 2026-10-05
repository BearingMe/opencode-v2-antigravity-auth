import { beforeEach, describe, expect, it, vi } from "vitest"
import { Schema } from "effect"
import { AntigravityAccounts } from "./rpc.js"

const { loadAccounts, updateAccounts, verifyAccountAccess } = vi.hoisted(() => ({
  loadAccounts: vi.fn(),
  updateAccounts: vi.fn(),
  verifyAccountAccess: vi.fn(async () => ({ status: "ok" as const, message: "verified" })),
}))

// Transactional storage mock mirroring src/plugin/storage.ts updateAccounts.
updateAccounts.mockImplementation(async (updater: (current: unknown) => { storage: unknown; result: unknown }) => {
  const current = (await loadAccounts()) ?? { version: 4, accounts: [], activeIndex: 0 }
  const input = structuredClone(current)
  const { result } = await updater(input)
  return result
})

vi.mock("./plugin/verify.js", () => ({
  verifyAccountAccess,
}))

vi.mock("./plugin/version.js", () => ({
  initAntigravityVersion: vi.fn(async () => undefined),
}))

vi.mock("./antigravity/oauth.js", () => ({
  authorizeAntigravity: vi.fn(async () => ({ url: "https://accounts.google.com/auth", verifier: "v", projectId: "" })),
  exchangeAntigravity: vi.fn(async () => ({
    type: "success" as const,
    refresh: "r",
    access: "a",
    expires: 1,
    projectId: "p",
  })),
}))

vi.mock("./plugin/storage.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./plugin/storage.js")>()
  return { ...actual, loadAccounts, updateAccounts }
})

vi.mock("./app/composition.js", () => ({
  executeAntigravityRequest: vi.fn(),
  disposeAntigravityRuntimeResources: vi.fn(async () => undefined),
  refreshOAuthCredentialUnified: vi.fn(async (credential: unknown) => credential),
}))

vi.mock("./plugin/accounts.js", () => ({
  AccountManager: { loadFromDisk: vi.fn() },
}))

vi.mock("./plugin/refresh-queue.js", () => ({
  createProactiveRefreshQueue: vi.fn(() => ({ setAccountManager: vi.fn(), start: vi.fn(), stop: vi.fn() })),
}))

import plugin from "./v2-plugin.js"

/**
 * Host transport mirror: the opencode host wraps handler returns as
 * `{ output }` and JSON-encodes them through Effect, rejecting
 * `undefined` (and NaN/Infinity) with "Expected JSON value". A plain
 * JSON.stringify round-trip silently drops undefined properties, so it
 * cannot catch this regression — this codec can.
 */
const transportCodec = Schema.toCodecJson(Schema.Struct({ output: Schema.Unknown }))

function encodeTransport(output: unknown): unknown {
  return Schema.encodeSync(transportCodec)({ output })
}

type RpcHandlers = Record<string, (input: never) => Promise<unknown>>

function seedSparseStore(): void {
  loadAccounts.mockResolvedValue({
    version: 4,
    accounts: [
      // Sparse: durable id but no email and no optional metadata. The list
      // projection must omit lastVerificationAt/cooldownUntil/quotaResetTimes;
      // verify/mutate projections must omit email.
      { id: "acc-one", refreshToken: "secret-refresh-token-one", projectId: "p1", addedAt: 1, lastUsed: 2 },
      // Zero is legitimate and must survive; hostile reset-time entries drop.
      {
        id: "acc-two",
        email: "two@example.com",
        refreshToken: "secret-refresh-token-two",
        projectId: "p2",
        addedAt: 3,
        lastUsed: 4,
        lastVerificationAt: 0,
        coolingDownUntil: 0,
        rateLimitResetTimes: { claude: 0, gemini: 5, dropped: undefined, nan: NaN, inf: Infinity },
      },
      // Disabled account served from cache with refresh off.
      {
        id: "acc-three",
        email: "three@example.com",
        refreshToken: "secret-refresh-token-three",
        projectId: "p3",
        addedAt: 5,
        lastUsed: 6,
        enabled: false,
        cachedQuota: {
          claude: { remainingFraction: 0, resetTime: "2030-01-01T00:00:00.000Z", modelCount: 1 },
          "gemini-pro": { remainingFraction: 0.5, resetTime: "not-a-date", modelCount: 2 },
        },
        cachedQuotaUpdatedAt: 1700000000000,
      },
    ],
    activeIndex: 0,
  })
}

describe("Antigravity RPC transport", () => {
  let handlers: RpcHandlers
  let cleanup: (() => void) | void

  const call = async (name: keyof typeof AntigravityAccounts.methods, input: unknown): Promise<unknown> => {
    const handler = handlers[name]
    if (!handler) throw new Error(`missing RPC handler: ${name}`)
    return handler(input as never)
  }

  const scanSecrets = (value: unknown): void => {
    const text = JSON.stringify(value)
    expect(text).not.toContain("secret-refresh-token")
    expect(text).not.toContain("refreshParts")
    expect(text).not.toContain("updatedAccount")
  }

  beforeEach(async () => {
    vi.clearAllMocks()
    seedSparseStore()
    const ctx = {
      location: { directory: "C:/rpc-transport-test" },
      integration: {
        transform: async (callback: (editor: unknown) => void) =>
          callback({
            update: (id: string, update: (integration: { name: string }) => void) => update({ name: "" }),
            method: {
              list: () => [],
              remove: vi.fn(),
              update: vi.fn(),
            },
          }),
        connection: { active: vi.fn(async () => undefined), resolve: vi.fn() },
      },
      provider: {
        transform: async (callback: (editor: unknown) => void) =>
          callback({
            get: () => undefined,
            update: vi.fn(),
            models: { set: vi.fn() },
            add: vi.fn(),
          }),
      },
      model: {
        transform: async (callback: (editor: unknown) => void) => callback({ list: () => [] }),
      },
      aisdk: { hook: vi.fn(async () => undefined) },
      session: { hook: vi.fn(async () => ({ dispose: vi.fn() })) },
      tool: { transform: async (callback: (editor: unknown) => void) => callback({ add: vi.fn() }) },
      rpc: { register: vi.fn(async () => ({ dispose: vi.fn() })) },
      event: { subscribe: async function* () {} },
    }
    cleanup = await plugin.setup(ctx as never)
    const register = ctx.rpc.register as unknown as { mock: { calls: Array<[unknown, RpcHandlers]> } }
    const captured = register.mock.calls[0]?.[1]
    if (!captured) throw new Error("expected RPC handlers")
    handlers = captured
  })

  it("cleans up the RPC registration", async () => {
    expect(typeof cleanup).toBe("function")
    await cleanup?.()
  })

  it("proves the codec rejects the pre-fix explicit-undefined shape", () => {
    const legacy = {
      activeIndex: 0,
      activeIndexByFamily: { claude: 0, gemini: 0 },
      accounts: [
        {
          id: "acc-one",
          index: 0,
          email: "Account 1",
          enabled: true,
          active: true,
          verificationRequired: false,
          verificationStatus: "not_checked",
          lastVerificationAt: undefined,
          cooldownUntil: undefined,
        },
      ],
    }
    expect(() => encodeTransport(legacy)).toThrow(/Expected JSON value/)
  })

  it("transports sparse list output with hostile reset times dropped", async () => {
    const output = (await call("list", {})) as {
      activeIndex: number
      accounts: Array<Record<string, unknown>>
    }
    const [sparse, zeroed] = output.accounts
    expect(sparse).not.toHaveProperty("lastVerificationAt")
    expect(sparse).not.toHaveProperty("cooldownUntil")
    expect(sparse).not.toHaveProperty("quotaResetTimes")
    expect(zeroed?.lastVerificationAt).toBe(0)
    expect(zeroed?.cooldownUntil).toBe(0)
    expect(zeroed?.quotaResetTimes).toEqual({ claude: 0, gemini: 5 })
    AntigravityAccounts.methods.list.output.parse(output)
    const encoded = encodeTransport(output)
    scanSecrets(encoded)
  })

  it("transports an empty list", async () => {
    loadAccounts.mockResolvedValue({ version: 4, accounts: [], activeIndex: 0 })
    const output = await call("list", {})
    expect(output).toMatchObject({ accounts: [] })
    AntigravityAccounts.methods.list.output.parse(output)
    encodeTransport(output)
  })

  it("transports cached quota output with null-not-zero semantics", async () => {
    const output = (await call("quota", { refresh: false })) as {
      accounts: Array<{
        id: string
        groups: Record<string, { remainingFraction: number | null; resetTime: number | null }>
      }>
    }
    const cached = output.accounts.find((entry) => entry.id === "acc-three")
    expect(cached?.groups.claude?.remainingFraction).toBe(0)
    expect(cached?.groups["gemini-flash"]?.remainingFraction).toBeNull()
    expect(cached?.groups["gemini-pro"]?.resetTime).toBeNull()
    AntigravityAccounts.methods.quota.output.parse(output)
    const encoded = encodeTransport(output)
    scanSecrets(encoded)
  })

  it("transports verify success without email or verifyUrl", async () => {
    const output = (await call("verify", { id: "acc-one" })) as Record<string, unknown>
    expect(output).not.toHaveProperty("email")
    expect(output).not.toHaveProperty("verifyUrl")
    expect(output).toMatchObject({ status: "ok" })
    AntigravityAccounts.methods.verify.output.parse(output)
    const encoded = encodeTransport(output)
    scanSecrets(encoded)
  })

  it("transports verify failure", async () => {
    const output = await call("verify", { id: "acc-missing" })
    expect(output).toMatchObject({ ok: false, kind: "not-found" })
    AntigravityAccounts.methods.verify.output.parse(output)
    encodeTransport(output)
  })

  it("transports mutate select without email", async () => {
    const output = (await call("mutate", { id: "acc-one", op: "select" })) as {
      selected: Record<string, unknown> | null
    }
    expect(output.selected).not.toBeNull()
    expect(output.selected).not.toHaveProperty("email")
    AntigravityAccounts.methods.mutate.output.parse(output)
    const encoded = encodeTransport(output)
    scanSecrets(encoded)
  })

  it("transports mutate failure", async () => {
    const output = await call("mutate", { id: "acc-missing", op: "select" })
    expect(output).toMatchObject({ ok: false, kind: "not-found" })
    AntigravityAccounts.methods.mutate.output.parse(output)
    encodeTransport(output)
  })

  it("transports deleteAll and ping", async () => {
    const deleted = await call("deleteAll", {})
    expect(deleted).toEqual({ remaining: 0 })
    AntigravityAccounts.methods.deleteAll.output.parse(deleted)
    encodeTransport(deleted)
    const pong = await call("ping", {})
    expect(pong).toBe("ANTIGRAVITY_RPC_ACCOUNTS_OK")
    AntigravityAccounts.methods.ping.output.parse(pong)
    encodeTransport(pong)
  })
})
