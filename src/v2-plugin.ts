import { Plugin } from "@opencode/plugin"
import { createGoogle } from "@ai-sdk/google"
import { Schema } from "effect"
import { ID as ModelID, Info as ModelInfo, VariantID as ModelVariantID } from "@opencode/schema/model"
import { ID as ProviderID, Info as ProviderInfo } from "@opencode/schema/provider"
import { IntegrationMethodID } from "@opencode/schema/integration-id"
import { authorizeAntigravity, exchangeAntigravity } from "./antigravity/oauth.js"
import { ANTIGRAVITY_PROVIDER_ID } from "./constants.js"
import { formatRefreshParts, isOAuthAuth, parseRefreshParts } from "./plugin/auth.js"
import { loadAccounts, saveAccountsReplace, type AccountMetadataV3 } from "./plugin/storage.js"
import { OPENCODE_MODEL_DEFINITIONS } from "./plugin/config/models.js"
import type { OAuthAuthDetails, PluginClient } from "./plugin/types.js"
import { checkAccountsQuota } from "./plugin/quota.js"
import { createLogger, initLogger } from "./plugin/logger.js"
import { initRuntimeConfig, loadConfig } from "./plugin/config/index.js"
import { AccountManager } from "./plugin/accounts.js"
import {
  disposeAntigravityRuntimeResources,
  executeAntigravityRequest,
  refreshOAuthCredentialUnified,
} from "./plugin/engine.js"
import { verifyAccountAccess } from "./plugin/verify.js"
import { createSessionRecoveryHook, getRecoverySuccessToast } from "./plugin/recovery.js"
import { initDiskSignatureCache } from "./plugin/cache.js"
import { createProactiveRefreshQueue, type ProactiveRefreshQueue } from "./plugin/refresh-queue.js"
import { initHealthTracker, initTokenTracker } from "./plugin/rotation.js"
import { initAntigravityVersion } from "./plugin/version.js"
import { createAutoUpdateCheckerHook } from "./hooks/auto-update-checker/index.js"

const PLUGIN_ID = "opencode-antigravity-auth"
const INTEGRATION_ID = "google"
const GOOGLE_PROVIDER_ID = ProviderID.google
const ANTIGRAVITY_SDK = new URL("./google-sdk.js", import.meta.url).href
const bridgeLog = createLogger("v2-bridge")

type OAuthValue = {
  type: "oauth"
  access: string
  refresh: string
  expires: number
}

function isOAuthValue(value: unknown): value is OAuthValue {
  return !!value && typeof value === "object" &&
    (value as Record<string, unknown>).type === "oauth" &&
    typeof (value as Record<string, unknown>).access === "string"
}

/**
 * Per-session child tracking for R-LIFECYCLE-ROOT-ONLY-CHILD.
 *
 * Limitation: the model fetch path (input plus init, no hook context) carries
 * no supported session identifier, and one must NOT be inferred from the
 * request payload or headers without a supported contract. An unknown or
 * unresolvable session therefore classifies as ROOT (toasts on): failing open
 * can only add noise, while inheriting last-active child state could wrongly
 * silence a root session's toasts under overlapping root/child requests.
 * Callers that DO know the session (event handlers) pass its ID explicitly.
 */
export function createChildSessionTracker(maxTrackedSessions = 1000) {
  const childSessionIds = new Set<string>()
  const evictOldestIfNeeded = () => {
    if (childSessionIds.size < maxTrackedSessions) return
    const oldest = childSessionIds.values().next().value
    if (oldest !== undefined) childSessionIds.delete(oldest)
  }
  return {
    remember: (sessionId: string | undefined, isChild: boolean | undefined) => {
      if (!sessionId) return
      if (isChild === true) {
        if (childSessionIds.has(sessionId)) return
        evictOldestIfNeeded()
        childSessionIds.add(sessionId)
      } else if (isChild === false) {
        childSessionIds.delete(sessionId)
      }
    },
    isChildSession: (sessionId?: string | null): boolean => {
      if (!sessionId) return false
      return childSessionIds.has(sessionId)
    },
    trackedChildCount: (): number => childSessionIds.size,
  }
}

export type ChildSessionTracker = ReturnType<typeof createChildSessionTracker>

export default Plugin.define({
  id: PLUGIN_ID,
  async setup(ctx) {
    let currentAuth: OAuthAuthDetails | null = null
    const bridgeClient = makeBridgeClient(ctx, (next) => {
      currentAuth = next
    })

    const nativeConfig = loadConfig(ctx.location.directory)
    initRuntimeConfig(nativeConfig)
    initLogger(bridgeClient)
    await initAntigravityVersion()

    if (nativeConfig.health_score) {
      initHealthTracker({
        initial: nativeConfig.health_score.initial,
        successReward: nativeConfig.health_score.success_reward,
        rateLimitPenalty: nativeConfig.health_score.rate_limit_penalty,
        failurePenalty: nativeConfig.health_score.failure_penalty,
        recoveryRatePerHour: nativeConfig.health_score.recovery_rate_per_hour,
        minUsable: nativeConfig.health_score.min_usable,
        maxScore: nativeConfig.health_score.max_score,
      })
    }

    if (nativeConfig.token_bucket) {
      initTokenTracker({
        maxTokens: nativeConfig.token_bucket.max_tokens,
        regenerationRatePerMinute: nativeConfig.token_bucket.regeneration_rate_per_minute,
        initialTokens: nativeConfig.token_bucket.initial_tokens,
      })
    }

    if (nativeConfig.keep_thinking) {
      initDiskSignatureCache(nativeConfig.signature_cache)
    }

    const sessionRecovery = createSessionRecoveryHook({ client: bridgeClient, directory: ctx.location.directory }, nativeConfig)

    const updateChecker = createAutoUpdateCheckerHook(bridgeClient, ctx.location.directory, {
      showStartupToast: true,
      autoUpdate: nativeConfig.auto_update,
    })

    const childSessions = createChildSessionTracker()
    const handlePluginEvent = async (input: { event: { type: string; properties?: unknown } }) => {
      await updateChecker.event(input)

      if (input.event.type === "session.created") {
        const props = input.event.properties as { info?: { parentID?: string }; sessionID?: string; id?: string } | undefined
        const createdId = props?.sessionID ?? props?.id
        const createdIsChild = !!props?.info?.parentID
        childSessions.remember(createdId, createdIsChild)
        bridgeLog.debug(createdIsChild ? "child-session-detected" : "root-session-detected", {})
      }

      if (sessionRecovery && input.event.type === "session.error") {
        const props = input.event.properties as Record<string, unknown> | undefined
        const sessionID = props?.sessionID as string | undefined
        const messageID = props?.messageID as string | undefined
        const error = props?.error

        if (sessionRecovery.isRecoverableError(error)) {
          const recovered = await sessionRecovery.handleSessionRecovery({
            id: messageID,
            role: "assistant" as const,
            sessionID,
            error,
          })

          if (recovered && sessionID && nativeConfig.auto_resume) {
            await ctx.session.prompt({ sessionID, text: nativeConfig.resume_text }).catch(() => {})

            const successToast = getRecoverySuccessToast()
            bridgeLog.debug("recovery-toast", { ...successToast })
            if (!nativeConfig.quiet_mode && !(nativeConfig.toast_scope === "root_only" && childSessions.isChildSession(sessionID))) {
              await bridgeClient.tui.showToast({
                body: {
                  title: successToast.title,
                  message: successToast.message,
                  variant: "success",
                },
              }).catch(() => {})
            }
          }
        }
      }
    }

    bridgeLog.info("V2 plugin setup", {
      directory: ctx.location.directory,
      version: ctx.app?.version,
    })

    const getAuth = async () => {
      const connection = await ctx.integration.connection.active(INTEGRATION_ID)
      if (connection) {
        const credential = await ctx.integration.connection.resolve(connection)
        if (isOAuthValue(credential)) {
          return {
            type: "oauth",
            refresh: credential.refresh,
            access: credential.access,
            expires: credential.expires,
          }
        }
        // An explicit non-OAuth Google connection (for example an API key) must
        // take precedence over saved Antigravity accounts for ordinary Gemini.
        return { type: "none" }
      }
      if (currentAuth) return currentAuth

      const saved = await loadAccounts()
      const account = saved?.accounts[saved.activeIndex ?? 0]
      if (!account?.refreshToken) return { type: "none" }
      return {
        type: "oauth" as const,
        refresh: formatRefreshParts({
          refreshToken: account.refreshToken,
          projectId: account.projectId,
          managedProjectId: account.managedProjectId,
        }),
      }
    }

    const requireOAuthAuth = async () => {
      const auth = await getAuth()
      if (!isOAuthAuth(auth)) {
        throw new Error("Antigravity OAuth is no longer available. Reconnect Google Antigravity before retrying.")
      }
      return auth
    }
    let nativeManager: AccountManager | null = null
    let refreshQueue: ProactiveRefreshQueue | null = null
    const resetNativeManager = () => {
      refreshQueue?.stop()
      refreshQueue = null
      nativeManager = null
    }
    const loadNativeManager = async () => {
      const auth = await requireOAuthAuth()
      nativeManager ??= await AccountManager.loadFromDisk(auth)
      if (nativeConfig.proactive_token_refresh && !refreshQueue && nativeManager.getAccountCount() > 0) {
        refreshQueue = createProactiveRefreshQueue(bridgeClient, ANTIGRAVITY_PROVIDER_ID, {
          enabled: nativeConfig.proactive_token_refresh,
          bufferSeconds: nativeConfig.proactive_refresh_buffer_seconds,
          checkIntervalSeconds: nativeConfig.proactive_refresh_check_interval_seconds,
        })
        refreshQueue.setAccountManager(nativeManager)
        refreshQueue.start()
      }
      return nativeManager
    }
    const antigravityFetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      await requireOAuthAuth()
      const destination = getFetchDestination(input)
      if (destination.hostname === "generativelanguage.googleapis.com" && !isGenerativeLanguageModelPath(destination.pathname)) {
        throw new Error(`Unsupported Google Generative Language endpoint for Antigravity OAuth: ${destination.pathname}`)
      }
      // Gemini may fetch externally hosted attachments. Never forward the SDK's
      // placeholder key or OAuth credentials to a different origin.
      if (destination.hostname !== "generativelanguage.googleapis.com") {
        const normalizedExternal = await normalizeFetchBody(input, init)
        const externalHeaders = new Headers(normalizedExternal.init?.headers)
        externalHeaders.delete("x-goog-api-key")
        externalHeaders.delete("authorization")
        return fetch(normalizedExternal.input, { ...normalizedExternal.init, headers: externalHeaders })
      }

      const normalized = await normalizeFetchBody(input, init)
      bridgeLog.debug("Dispatching Antigravity model request", {
        destination: destination.hostname,
        path: destination.pathname,
      })

      // Native engine: multi-account rotation, backoff, warmup, and signature
      // handling live in src/plugin/engine.ts (no V1 harness involved).
      const accountManager = await loadNativeManager()
      return executeAntigravityRequest(normalized.input, normalized.init, {
        client: bridgeClient,
        providerId: ANTIGRAVITY_PROVIDER_ID,
        config: nativeConfig,
        accountManager,
        isChildSession: childSessions.isChildSession(),
      })
    }

    let accountSummary = (await loadAccounts())?.accounts ?? []
    await ctx.integration.transform((editor) => {
      editor.update(INTEGRATION_ID, (integration) => {
        integration.name = "Google Antigravity"
      })
      editor.method.update({
        integrationID: INTEGRATION_ID,
        method: {
          id: "google-oauth",
          type: "oauth",
          label: "OAuth with Google (Antigravity)",
          form: [{
            key: "accountAction",
            type: "string",
            title: accountSummary.length
              ? `Account action — saved: ${accountSummary.map((account) => `${account.email ?? "Unnamed account"}${account.enabled === false ? " (disabled)" : ""}`).join(", ")}`
              : "Account action — no saved accounts",
            default: "add",
            options: [
              { value: "add", label: "Add or refresh this account" },
              { value: "replace", label: "Replace all saved accounts" },
            ],
          }, {
            key: "projectId",
            type: "string",
            title: "Project ID (optional)",
            description: "Override automatic Google project detection.",
          }],
        },
        authorize: async (answer) => {
          const action = answer.accountAction === "replace" ? "replace" : "add"
          const projectId = typeof answer.projectId === "string" ? answer.projectId : ""
          const authorization = await authorizeAntigravity(projectId)
          return {
            mode: "code" as const,
            url: authorization.url,
            instructions: "Complete Google sign-in, then paste either the authorization code or the full localhost redirect URL.",
            callback: async (code: string) => {
              const params = parseOAuthCallbackInput(
                code,
                new URL(authorization.url).searchParams.get("state") ?? "",
              )
              const result = await exchangeAntigravity(params.code, params.state)
              if (result.type !== "success") throw new Error(result.error)
              await persistOAuthAccount(result, action)
              accountSummary = (await loadAccounts())?.accounts ?? []
              currentAuth = {
                type: "oauth",
                refresh: formatRefreshParts({ refreshToken: result.refresh, projectId: result.projectId }),
                access: result.access,
                expires: result.expires,
              }
              resetNativeManager()
              return {
                type: "oauth" as const,
                access: result.access,
                refresh: `${result.refresh}|${result.projectId}`,
                expires: result.expires,
                metadata: { email: result.email },
                methodID: Schema.decodeUnknownSync(IntegrationMethodID)("google-oauth"),
              }
            },
          }
        },
        refresh: async (credential) => refreshOAuthCredential(credential, bridgeClient),
        label: (credential) => {
          const email = credential.metadata?.email
          return typeof email === "string" ? email : accountSummary.find(
            (account) => account.refreshToken === parseRefreshParts(credential.refresh).refreshToken,
          )?.email
        },
      })
    })

    await ctx.provider.transform((editor) => {
      const existing = editor.get(GOOGLE_PROVIDER_ID)
      const models = new Map(existing?.models ?? [])
      for (const [id, definition] of Object.entries(OPENCODE_MODEL_DEFINITIONS)) {
        const modelID = Schema.decodeUnknownSync(ModelID)(id)
        const model = ModelInfo.default(GOOGLE_PROVIDER_ID, modelID)
        models.set(id, {
          ...model,
          name: definition.name,
          package: `aisdk:${ANTIGRAVITY_SDK}`,
          settings: {},
          limit: { context: definition.limit.context, output: definition.limit.output },
          capabilities: { tools: true, input: ["text", "image", "pdf"], output: ["text"] },
          variants: Object.entries(definition.variants ?? {}).map(([variantID, settings]) => ({
            id: Schema.decodeUnknownSync(ModelVariantID)(variantID),
            settings: settings as Record<string, unknown>,
          })),
        })
      }

      if (existing) {
        editor.update(GOOGLE_PROVIDER_ID, (provider) => {
          provider.activation = "enabled"
          provider.package = `aisdk:${ANTIGRAVITY_SDK}`
        })
        editor.models.set(GOOGLE_PROVIDER_ID, [...models.values()])
      } else {
        editor.add({
          info: {
            ...ProviderInfo.empty(GOOGLE_PROVIDER_ID),
            name: "Google Antigravity",
            activation: "enabled",
            package: `aisdk:${ANTIGRAVITY_SDK}`,
          },
          models: [...models.values()],
        })
      }
    })

    await ctx.model.transform((editor) => {
      for (const model of editor.list(GOOGLE_PROVIDER_ID)) {
        if (!model.id.startsWith("antigravity-") && !model.id.startsWith("gemini-")) continue
        editor.update(GOOGLE_PROVIDER_ID, model.id.toString(), (draft) => {
          draft.package = `aisdk:${ANTIGRAVITY_SDK}`
        })
      }
    })

    await ctx.aisdk.hook("sdk", async (event) => {
      if (event.package !== ANTIGRAVITY_SDK && event.package !== "@ai-sdk/google") return
      const antigravityModel = event.model.id.startsWith("antigravity-")
      const geminiModel = event.model.id.startsWith("gemini-")
      if (!antigravityModel && !geminiModel) return
      const auth = await getAuth()
      if (!isOAuthAuth(auth)) {
        if (antigravityModel) {
          throw new Error("Antigravity OAuth is not connected. Connect Google Antigravity before using this model.")
        }
        bridgeLog.debug("Keeping Google SDK model on its configured API-key route", { model: event.model.id })
        if (event.package === ANTIGRAVITY_SDK) event.sdk = createGoogle(event.options)
        return
      }
      event.options.fetch = antigravityFetch
      // The Google SDK requires an API key even though this fetch bridge uses OAuth.
      // Its generated x-goog-api-key header is removed by the request adapter.
      event.options.apiKey = "antigravity-oauth"
      bridgeLog.info("Routed Google SDK model through OAuth bridge", {
        model: event.model.id,
        package: event.package,
      })
      event.sdk = createGoogle(event.options)
    }, { providerID: GOOGLE_PROVIDER_ID })

    await ctx.tool.transform((editor) => {
      editor.add({
        name: "antigravity_accounts",
        description: "Manage Antigravity Google accounts and inspect their quota status.",
        input: {
          type: "object",
          properties: {
            action: {
              type: "string",
              enum: ["list", "check_quota", "verify", "enable", "disable", "select", "delete", "delete_all"],
              description: "Account management operation",
            },
            index: { type: "integer", minimum: 0, description: "Zero-based account index for account-specific operations" },
          },
          required: ["action"],
          additionalProperties: false,
        },
        execute: async (input) => manageAccounts(input as { action: string; index?: number }, bridgeClient, () => {
          resetNativeManager()
        }, (auth) => {
          currentAuth = auth
          resetNativeManager()
        }),
      })
    })

    await ctx.session.hook("retry", async (event) => {
      if (event.decision.retry) return
      const v1Error = { name: event.error.type, message: event.error.message, status: event.error.status }
      await handlePluginEvent({
        event: {
          type: "session.error",
          properties: { sessionID: event.sessionID, error: v1Error },
        },
      })
    })

    const controller = new AbortController()
    void (async () => {
      for await (const event of ctx.event.subscribe({ signal: controller.signal })) {
        const data = event.data as { parentID?: string; sessionID?: string; id?: string }
        const properties = event.type === "session.created"
          ? { info: { parentID: data.parentID }, sessionID: data.sessionID ?? data.id }
          : event.data
        await handlePluginEvent({
          event: {
            type: event.type,
            properties,
          },
        })
      }
    })().catch((error: unknown) => {
      if (!controller.signal.aborted) console.error("Antigravity event listener stopped", error)
    })

    return async () => {
      controller.abort()
      refreshQueue?.stop()
      refreshQueue = null
      await disposeAntigravityRuntimeResources()
    }

  },
})

function makeBridgeClient(ctx: Parameters<Parameters<typeof Plugin.define>[0]["setup"]>[0], setAuth: (auth: OAuthAuthDetails) => void): PluginClient {
  const client = {
    app: {
      log: async (input: unknown) => {
        console.debug("[antigravity]", input)
      },
    },
    auth: {
      set: async (input: unknown) => {
        const body = (input as { body?: Record<string, unknown> }).body
        if (body?.type === "oauth") {
          setAuth({
            type: "oauth",
            refresh: typeof body.refresh === "string" ? body.refresh : "",
            access: typeof body.access === "string" ? body.access : "",
            expires: typeof body.expires === "number" ? body.expires : 0,
          })
        }
        return { data: undefined }
      },
    },
    session: {
      prompt: async (input: unknown) => {
        const request = input as { path?: { id?: string }; body?: { parts?: Array<{ text?: string }> } }
        const text = request.body?.parts?.map((part) => part.text ?? "").join("") ?? ""
        if (request.path?.id) await ctx.session.prompt({ sessionID: request.path.id, text })
        return { data: undefined }
      },
      abort: async (input: unknown) => {
        const id = (input as { path?: { id?: string } }).path?.id
        if (id) await ctx.session.interrupt({ sessionID: id })
        return { data: undefined }
      },
      messages: async (input: unknown) => {
        const id = (input as { path?: { id?: string } }).path?.id
        return { data: id ? await ctx.session.context({ sessionID: id }) : [] }
      },
    },
    tui: {
      showToast: async (input: unknown) => {
        console.info("[antigravity]", input)
        return { data: undefined }
      },
    },
  }
  return client as unknown as PluginClient
}

export async function normalizeFetchBody(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<{ input: string; init: RequestInit }> {
  const request = input instanceof Request ? new Request(input.clone(), init) : undefined
  const url = request?.url ?? (input instanceof URL ? input.toString() : typeof input === "string" ? input : input.url)
  const headers = new Headers(request?.headers ?? init?.headers)
  const method = request?.method ?? init?.method ?? "GET"
  const signal = request?.signal ?? init?.signal
  const output: RequestInit = {
    ...init,
    method,
    headers,
    signal,
  }

  if (request) {
    output.cache = request.cache
    output.credentials = request.credentials
    output.integrity = request.integrity
    output.keepalive = request.keepalive
    output.mode = request.mode
    output.redirect = request.redirect
    output.referrer = request.referrer
    output.referrerPolicy = request.referrerPolicy
  }

  const body = request
    ? request.body ? await request.clone().arrayBuffer() : undefined
    : init?.body
  if (body === undefined || body === null) {
    delete output.body
    return { input: url, init: output }
  }

  const contentType = headers.get("content-type")?.toLowerCase() ?? ""
  let bytes: ArrayBuffer | undefined
  if (body instanceof ArrayBuffer) bytes = body
  else if (ArrayBuffer.isView(body)) {
    bytes = body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength) as ArrayBuffer
  }

  if (contentType.includes("json") && bytes) {
    output.body = new TextDecoder().decode(bytes)
  } else if (request && bytes) {
    output.body = bytes
  } else {
    output.body = body
  }
  return { input: url, init: output }
}

export function getFetchDestination(input: RequestInfo | URL): URL {
  const value = input instanceof Request
    ? input.url
    : input instanceof URL
      ? input.toString()
      : input
  try {
    const destination = new URL(value)
    if (destination.protocol !== "https:" && destination.protocol !== "http:") {
      throw new Error("Unsupported URL protocol")
    }
    return destination
  } catch {
    throw new Error("Antigravity OAuth fetch requires an absolute HTTP(S) URL")
  }
}

export function isGenerativeLanguageModelPath(pathname: string): boolean {
  return /^\/v1(?:beta)?\/models\/[^/]+:(?:generateContent|streamGenerateContent|countTokens)$/.test(pathname)
}

export function parseOAuthCallbackInput(value: string, expectedState: string): { code: string; state: string } {
  const trimmed = value.trim()
  if (!trimmed) throw new Error("Missing authorization code")

  let parsed: URL
  try {
    parsed = new URL(trimmed)
  } catch {
    if (!expectedState) throw new Error("Missing OAuth state; restart Google sign-in and paste the full redirect URL")
    return { code: trimmed, state: expectedState }
  }

  const code = parsed.searchParams.get("code")
  const state = parsed.searchParams.get("state")
  if (!code) throw new Error("Missing code in OAuth redirect URL")
  if (!state) throw new Error("Missing state in OAuth redirect URL")
  if (expectedState && state !== expectedState) throw new Error("OAuth state mismatch; restart Google sign-in")
  return { code, state }
}

export async function refreshOAuthCredential<T extends OAuthValue & { methodID: string }>(
  credential: T,
  client: PluginClient,
): Promise<T> {
  // Single refresh path (D-REFRESH-DUAL): delegate to src/plugin/token.ts.
  const refreshed = await refreshOAuthCredentialUnified(credential, client, ANTIGRAVITY_PROVIDER_ID)
  const previousRefreshToken = parseRefreshParts(credential.refresh).refreshToken
  const [rotatedRefreshToken = ""] = refreshed.refresh.split("|")
  if (rotatedRefreshToken && rotatedRefreshToken !== previousRefreshToken) {
    const stored = await loadAccounts()
    if (stored) {
      const accounts = stored.accounts.map((account) => account.refreshToken === previousRefreshToken
        ? { ...account, refreshToken: rotatedRefreshToken }
        : account)
      await saveAccountsReplace({ ...stored, accounts })
    }
  }
  return refreshed
}

async function persistOAuthAccount(
  result: Extract<Awaited<ReturnType<typeof exchangeAntigravity>>, { type: "success" }>,
  action: "add" | "replace",
): Promise<void> {
  const stored = await loadAccounts()
  const account: AccountMetadataV3 = {
    email: result.email,
    refreshToken: result.refresh,
    projectId: result.projectId,
    addedAt: Date.now(),
    lastUsed: Date.now(),
    enabled: true,
    lastVerificationAt: undefined,
    lastVerificationStatus: undefined,
    verificationRequired: undefined,
    verificationRequiredAt: undefined,
    verificationRequiredReason: undefined,
    verificationUrl: undefined,
  }

  let accounts = action === "replace" ? [] : [...(stored?.accounts ?? [])]
  const matchIndex = accounts.findIndex((existing) =>
    existing.refreshToken === account.refreshToken ||
    (!!account.email && existing.email?.toLowerCase() === account.email.toLowerCase()),
  )
  if (matchIndex >= 0) {
    const existing = accounts[matchIndex]
    if (existing) accounts[matchIndex] = { ...existing, ...account, addedAt: existing.addedAt }
  } else {
    if (accounts.length >= 10) throw new Error("Maximum of 10 Antigravity accounts reached")
    accounts.push(account)
  }

  const activeIndex = accounts.findIndex((entry) => entry.refreshToken === account.refreshToken)
  const selectedIndex = activeIndex >= 0 ? activeIndex : 0
  await saveAccountsReplace({
    version: 4,
    accounts,
    activeIndex: selectedIndex,
    activeIndexByFamily: { claude: selectedIndex, gemini: selectedIndex },
  })
}

export async function manageAccounts(
  input: { action: string; index?: number },
  client: PluginClient,
  invalidateFetch: () => void,
  setAuth: (auth: OAuthAuthDetails) => void,
): Promise<{ content: string }> {
  const storage = await loadAccounts() ?? { version: 4 as const, accounts: [], activeIndex: 0 }
  const accounts = [...storage.accounts]

  if (input.action === "list") {
    return {
      content: JSON.stringify({
        activeIndex: storage.activeIndex,
        accounts: accounts.map((account, index) => ({
          index,
          email: account.email ?? `Account ${index + 1}`,
          enabled: account.enabled !== false,
          active: index === storage.activeIndex,
          verificationRequired: account.verificationRequired === true,
          verificationStatus: account.verificationRequired === true
            ? "verification_required"
            : account.lastVerificationStatus ?? "not_checked",
          lastVerificationAt: account.lastVerificationAt,
          cooldownUntil: account.coolingDownUntil,
          quotaResetTimes: account.rateLimitResetTimes,
        })),
      }, null, 2),
    }
  }

  if (input.action === "check_quota") {
    return { content: JSON.stringify(await checkAccountsQuota(accounts, client, ANTIGRAVITY_PROVIDER_ID), null, 2) }
  }

  if (input.action === "verify") {
    if (!Number.isInteger(input.index) || input.index! < 0 || input.index! >= accounts.length) {
      return { content: `Invalid account index. There are ${accounts.length} saved accounts.` }
    }
    const index = input.index!
    const account = accounts[index]
    if (!account) return { content: `Account ${index} was not found.` }
    const verification = await verifyAccountAccess(account, client, ANTIGRAVITY_PROVIDER_ID)
    if (verification.status === "ok") {
      if (account.verificationRequired) account.enabled = true
      delete account.verificationRequired
      delete account.verificationRequiredAt
      delete account.verificationRequiredReason
      delete account.verificationUrl
    } else if (verification.status === "blocked") {
      account.enabled = false
      account.verificationRequired = true
      account.verificationRequiredAt = Date.now()
      account.verificationRequiredReason = verification.message
      account.verificationUrl = verification.verifyUrl
    }
    account.lastVerificationStatus = verification.status
    account.lastVerificationAt = Date.now()
    await saveAccountsReplace({ ...storage, accounts })
    invalidateFetch()
    return { content: JSON.stringify({ index, email: account.email, checkedAt: account.lastVerificationAt, ...verification }) }
  }

  if (input.action === "delete_all") {
    await saveAccountsReplace({ version: 4, accounts: [], activeIndex: 0, activeIndexByFamily: { claude: 0, gemini: 0 } })
    setAuth({ type: "oauth", refresh: "", access: "", expires: 0 })
    invalidateFetch()
    return { content: "All Antigravity accounts deleted." }
  }

  if (!Number.isInteger(input.index) || input.index! < 0 || input.index! >= accounts.length) {
    return { content: `Invalid account index. There are ${accounts.length} saved accounts.` }
  }
  const index = input.index!

  if (input.action === "delete") {
    accounts.splice(index, 1)
  } else if (input.action === "enable" || input.action === "disable") {
    const account = accounts[index]
    if (account) account.enabled = input.action === "enable"
  } else if (input.action !== "select") {
    return { content: `Unknown account action: ${input.action}` }
  }

  const nextActiveIndex = input.action === "select"
    ? index
    : accounts.length === 0
      ? 0
      : index < storage.activeIndex
        ? storage.activeIndex - 1
        : Math.min(storage.activeIndex, accounts.length - 1)
  await saveAccountsReplace({
    version: 4,
    accounts,
    activeIndex: nextActiveIndex,
    activeIndexByFamily: { claude: nextActiveIndex, gemini: nextActiveIndex },
  })

  const selected = accounts[nextActiveIndex]
  setAuth(selected
    ? {
        type: "oauth",
        refresh: formatRefreshParts({
          refreshToken: selected.refreshToken,
          projectId: selected.projectId,
          managedProjectId: selected.managedProjectId,
        }),
        access: "",
        expires: 0,
      }
    : { type: "oauth", refresh: "", access: "", expires: 0 })
  invalidateFetch()
  return { content: selected ? `Selected ${selected.email ?? `account ${nextActiveIndex + 1}`}.` : "No Antigravity accounts remain." }
}
