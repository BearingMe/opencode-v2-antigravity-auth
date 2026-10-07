import { Plugin } from "@opencode/plugin"
import { createGoogle } from "@ai-sdk/google"
import { Schema } from "effect"
import { ID as ModelID, Info as ModelInfo, VariantID as ModelVariantID } from "@opencode/schema/model"
import { ID as ProviderID, Info as ProviderInfo } from "@opencode/schema/provider"
import { IntegrationMethodID } from "@opencode/schema/integration-id"
import { authorizeAntigravity, exchangeAntigravity } from "./oauth.js"
import { applyOpenCodeToolResultBatches, createOpenCodeSessionRecovery } from "./session-recovery.js"
import { createOpenCodeAccountAdministration } from "./account-administration.js"
import { ANTIGRAVITY_PROVIDER_ID } from "../../constants.js"
import { AntigravityAccounts } from "./rpc.js"
import { formatRefreshParts, isOAuthAuth, parseRefreshParts } from "../../modules/accounts/index.js"
import { configureAccountStoreLogger, loadAccounts } from "../filesystem/account-store.js"
import {
  MAX_SAVED_ACCOUNTS,
  checkQuota as checkAccountsQuota,
  persistRefreshRotation,
  type MutationOp,
} from "../../plugin/account-service.js"
import { OPENCODE_MODEL_DEFINITIONS } from "./config/models.js"
import type { AccountOAuthCredential } from "../../modules/accounts/index.js"
import type { PluginClient } from "./types.js"
import { createLogger, initLogger } from "./logger.js"
import { initRuntimeConfig, loadConfig } from "./config/index.js"
import { AccountManager } from "./account-pool.js"
import {
  disposeAntigravityRuntimeResources,
  executeAntigravityRequest,
  refreshOAuthCredentialUnified,
} from "../../app/composition.js"
import { getRecoverySuccessToast } from "../../modules/session-recovery/index.js"
import { initDiskSignatureCache } from "./signature-cache.js"
import { createProactiveRefreshQueue, type ProactiveRefreshQueue } from "./refresh-queue.js"
import { initHealthTracker, initTokenTracker } from "../../modules/accounts/index.js"
import { initAntigravityVersion } from "./version.js"
import { createAutoUpdateCheckerHook } from "./hooks/auto-update-checker/index.js"

const PLUGIN_ID = "opencode-v2-antigravity-auth"
const INTEGRATION_ID = "antigravity"
const ANTIGRAVITY_PROVIDER = Schema.decodeUnknownSync(ProviderID)(ANTIGRAVITY_PROVIDER_ID)
const ANTIGRAVITY_OAUTH_METHOD_ID = "antigravity-oauth"
const ANTIGRAVITY_SDK = new URL("./google-sdk.js", import.meta.url).href
const bridgeLog = createLogger("v2-bridge")

type OAuthValue = {
  type: "oauth"
  access: string
  refresh: string
  expires: number
}

/** Accepts only the host's resolved OAuth credential shape. */
function isOAuthValue(value: unknown): value is OAuthValue {
  return (
    !!value &&
    typeof value === "object" &&
    (value as Record<string, unknown>).type === "oauth" &&
    typeof (value as Record<string, unknown>).access === "string"
  )
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
  /** Evicts the oldest child id before adding another tracked session. */
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

export const opencodePlugin = Plugin.define({
  id: PLUGIN_ID,
  /** Initializes host services and registers the Antigravity integration. */
  async setup(ctx) {
    configureAccountStoreLogger(createLogger("storage"))
    let currentAuth: AccountOAuthCredential | null = null
    let accountSummary = (await loadAccounts())?.accounts ?? []
    /** Refreshes login-form account text without failing a completed mutation. */
    const refreshAccountSummary = async (): Promise<void> => {
      try {
        accountSummary = (await loadAccounts())?.accounts ?? []
        await ctx.integration.reload()
      } catch (error: unknown) {
        // Presentation failure must not turn an already-persisted mutation
        // or login into a failed operation.
        bridgeLog.warn("Unable to reload the login account summary", { error: String(error) })
      }
    }
    const bridgeClient = makeBridgeClient(ctx, (next) => {
      currentAuth = next
    })

    const nativeConfig = loadConfig(ctx.location.directory)
    initRuntimeConfig(nativeConfig)
    initLogger(bridgeClient)
    await initAntigravityVersion()
    const accountAdministration = createOpenCodeAccountAdministration(bridgeClient, ANTIGRAVITY_PROVIDER_ID)

    // Accounts RPC lives on the production server plugin: a separate entry has
    // no host auto-load contract (only "." and "./tui" load automatically),
    // so registering here is what makes the TUI reachable.
    let accountsRegistration: { dispose: () => Promise<void> | void } | null = null
    try {
      accountsRegistration = await ctx.rpc.register(AntigravityAccounts, {
        list: async () => accountAdministration.list(),
        quota: async (input) => accountAdministration.quota({ refresh: input.refresh ?? true }),
        verify: async (input) => {
          const outcome = await accountAdministration.verify({ id: input.id })
          if ("ok" in outcome) return outcome
          resetNativeManager()
          await refreshAccountSummary()
          const projected: {
            index: number
            email?: string
            checkedAt: number
            status: "ok" | "blocked" | "error"
            message: string
            verifyUrl?: string
          } = {
            index: outcome.index,
            checkedAt: outcome.checkedAt,
            status: outcome.status,
            message: outcome.message,
          }
          if (outcome.email !== undefined) projected.email = outcome.email
          if (outcome.verifyUrl !== undefined) projected.verifyUrl = outcome.verifyUrl
          return projected
        },
        mutate: async (input) => {
          const outcome = await accountAdministration.mutate(
            { id: input.id },
            input.op,
            input.family ? { family: input.family } : {},
          )
          if ("ok" in outcome) return outcome
          const selected = outcome.selected
          if (selected) {
            currentAuth = {
              type: "oauth",
              refresh: formatRefreshParts(selected.refreshParts),
              access: "",
              expires: 0,
            }
          } else {
            currentAuth = { type: "oauth", refresh: "", access: "", expires: 0 }
          }
          resetNativeManager()
          await refreshAccountSummary()
          return {
            op: outcome.op,
            index: outcome.index,
            nextActiveIndex: outcome.nextActiveIndex,
            activeIndexByFamily: outcome.activeIndexByFamily,
            remaining: outcome.remaining,
            selected: selected
              ? {
                  id: selected.id,
                  index: selected.index,
                  ...(selected.email !== undefined ? { email: selected.email } : {}),
                }
              : null,
          }
        },
        deleteAll: async () => {
          await accountAdministration.deleteAll()
          currentAuth = { type: "oauth", refresh: "", access: "", expires: 0 }
          resetNativeManager()
          await refreshAccountSummary()
          return { remaining: 0 as const }
        },
        ping: async () => "ANTIGRAVITY_RPC_ACCOUNTS_OK",
      })
    } catch (error: unknown) {
      bridgeLog.debug("accounts-rpc-unavailable", { error: error instanceof Error ? error.message : String(error) })
      accountsRegistration = null
    }

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

    const sessionRecovery = createOpenCodeSessionRecovery(bridgeClient, ctx.location.directory, nativeConfig)

    const updateChecker = createAutoUpdateCheckerHook(bridgeClient, ctx.location.directory, {
      showStartupToast: true,
      autoUpdate: nativeConfig.auto_update,
    })

    const childSessions = createChildSessionTracker()
    /** Dispatches host events to the update checker and recovery policies. */
    const handlePluginEvent = async (input: { event: { type: string; properties?: unknown } }) => {
      await updateChecker.event(input)

      if (input.event.type === "session.created") {
        const props = input.event.properties as
          { info?: { parentID?: string }; sessionID?: string; id?: string } | undefined
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
            const successToast = getRecoverySuccessToast()
            bridgeLog.debug("recovery-toast", { ...successToast })
            if (
              !nativeConfig.quiet_mode &&
              !(nativeConfig.toast_scope === "root_only" && childSessions.isChildSession(sessionID))
            ) {
              await bridgeClient.tui
                .showToast({
                  body: {
                    title: successToast.title,
                    message: successToast.message,
                    variant: "success",
                  },
                })
                .catch(() => {})
            }
          }
        }
      }
    }

    bridgeLog.info("V2 plugin setup", {
      directory: ctx.location.directory,
      version: ctx.app?.version,
    })

    /** Resolves the active host integration before falling back to saved accounts. */
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
        // Don't silently switch to a saved OAuth account when this integration
        // has an explicit non-OAuth connection.
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

    /** Fails closed when Antigravity is connected without an OAuth credential. */
    const requireOAuthAuth = async () => {
      const auth = await getAuth()
      if (!isOAuthAuth(auth)) {
        throw new Error("Antigravity OAuth is no longer available. Reconnect Antigravity before retrying.")
      }
      return auth
    }
    let nativeManager: AccountManager | null = null
    let refreshQueue: ProactiveRefreshQueue | null = null
    /** Stops proactive refresh before discarding the cached account manager. */
    const resetNativeManager = () => {
      refreshQueue?.stop()
      refreshQueue = null
      nativeManager = null
    }
    /** Loads account state once and starts proactive refresh when configured. */
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
    /** Routes approved model traffic while stripping credentials from external fetches. */
    const antigravityFetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      await requireOAuthAuth()
      const destination = getFetchDestination(input)
      if (
        destination.hostname === "generativelanguage.googleapis.com" &&
        !isGenerativeLanguageModelPath(destination.pathname)
      ) {
        throw new Error(
          `Unsupported Google Generative Language endpoint for Antigravity OAuth: ${destination.pathname}`,
        )
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

      // The application composition selects the module and transport adapters;
      // execution and retry policy live in src/app/execute-request.ts.
      const accountManager = await loadNativeManager()
      return executeAntigravityRequest(normalized.input, normalized.init, {
        client: bridgeClient,
        providerId: ANTIGRAVITY_PROVIDER_ID,
        config: nativeConfig,
        accountManager,
        isChildSession: childSessions.isChildSession(),
      })
    }

    await ctx.integration.transform((editor) => {
      editor.method.update({
        integrationID: INTEGRATION_ID,
        method: {
          id: ANTIGRAVITY_OAUTH_METHOD_ID,
          type: "oauth",
          label: "Sign in with Google for Antigravity",
          form: [
            {
              key: "accountAction",
              type: "string",
              title: "Antigravity",
              description: formatAuthSummary(accountSummary, MAX_SAVED_ACCOUNTS),
              required: true,
              options: [
                {
                  value: "add",
                  label:
                    accountSummary.length >= MAX_SAVED_ACCOUNTS
                      ? "Reconnect a saved account"
                      : "Add or reconnect an account",
                },
              ],
            },
          ],
        },
        authorize: async (answer) => {
          // The host answers method.form BEFORE starting OAuth/opening a URL.
          // Refuse missing/legacy answers rather than bypassing consent.
          if (answer.accountAction !== "add")
            throw new Error("Choose Add or reconnect an account before starting Antigravity sign-in.")
          accountSummary = (await loadAccounts())?.accounts ?? []
          const authorization = await authorizeAntigravity("")
          return {
            mode: "code" as const,
            url: authorization.url,
            instructions: formatAuthInstructions(accountSummary, MAX_SAVED_ACCOUNTS),
            callback: async (code: string) => {
              const params = parseOAuthCallbackInput(code, new URL(authorization.url).searchParams.get("state") ?? "")
              const result = await exchangeAntigravity(params.code, params.state)
              if (result.type !== "success") throw new Error(result.error)
              await accountAdministration.persistOAuth(result, "add")
              await refreshAccountSummary()
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
                methodID: Schema.decodeUnknownSync(IntegrationMethodID)(ANTIGRAVITY_OAUTH_METHOD_ID),
              }
            },
          }
        },
        refresh: async (credential) => refreshOAuthCredential(credential, bridgeClient),
        label: (credential) => {
          const email = credential.metadata?.email
          return typeof email === "string"
            ? email
            : accountSummary.find(
                (account) => account.refreshToken === parseRefreshParts(credential.refresh).refreshToken,
              )?.email
        },
      })
      editor.update(INTEGRATION_ID, (integration) => {
        integration.name = "Antigravity"
      })
    })

    await ctx.provider.transform((editor) => {
      const existing = editor.get(ANTIGRAVITY_PROVIDER)
      const models = Object.entries(OPENCODE_MODEL_DEFINITIONS).map(([id, definition]) => {
        const modelID = Schema.decodeUnknownSync(ModelID)(id)
        const model = ModelInfo.default(ANTIGRAVITY_PROVIDER, modelID)
        return {
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
        }
      })

      if (existing) {
        editor.update(ANTIGRAVITY_PROVIDER, (provider) => {
          provider.activation = "enabled"
          provider.package = `aisdk:${ANTIGRAVITY_SDK}`
        })
        editor.models.set(ANTIGRAVITY_PROVIDER, models)
      } else {
        editor.add({
          info: {
            ...ProviderInfo.empty(ANTIGRAVITY_PROVIDER),
            name: "Antigravity",
            activation: "enabled",
            package: `aisdk:${ANTIGRAVITY_SDK}`,
          },
          models,
        })
      }
    })

    await ctx.model.transform((editor) => {
      for (const model of editor.list(ANTIGRAVITY_PROVIDER)) {
        if (!model.id.startsWith("antigravity-") && !model.id.startsWith("gemini-")) continue
        editor.update(ANTIGRAVITY_PROVIDER, model.id.toString(), (draft) => {
          draft.package = `aisdk:${ANTIGRAVITY_SDK}`
        })
      }
    })

    await ctx.aisdk.hook(
      "sdk",
      async (event) => {
        if (event.package !== ANTIGRAVITY_SDK) return
        const antigravityModel = event.model.id.startsWith("antigravity-")
        const geminiModel = event.model.id.startsWith("gemini-")
        if (!antigravityModel && !geminiModel) return
        const auth = await getAuth()
        if (!isOAuthAuth(auth)) {
          throw new Error("Antigravity OAuth is not connected. Connect Antigravity before using this model.")
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
      },
      { providerID: ANTIGRAVITY_PROVIDER },
    )

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
            index: {
              type: "integer",
              minimum: 0,
              description: "Zero-based account index for account-specific operations",
            },
          },
          required: ["action"],
          additionalProperties: false,
        },
        execute: async (input) => {
          const action = input as { action: string; index?: number }
          const result = await manageAccounts(
            action,
            bridgeClient,
            () => {
              resetNativeManager()
            },
            (auth) => {
              currentAuth = auth
              resetNativeManager()
            },
          )
          if (["verify", "enable", "disable", "select", "delete", "delete_all"].includes(action.action)) {
            await refreshAccountSummary()
          }
          return result
        },
      })
    })

    await ctx.session.hook("context", async (event) => {
      if (!sessionRecovery) return

      const batches = sessionRecovery.findMissingToolResultBatches(event.messages)
      if (batches.length === 0) return

      const resultCount = applyOpenCodeToolResultBatches(event.messages, batches)
      await sessionRecovery.notifyToolResultRepair(event.sessionID, resultCount)
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
        const properties =
          event.type === "session.created"
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
      await accountsRegistration?.dispose()
      await disposeAntigravityRuntimeResources()
    }
  },
})

/** Adapts the supported host APIs to the structural client used by legacy facades. */
function makeBridgeClient(
  ctx: Parameters<Parameters<typeof Plugin.define>[0]["setup"]>[0],
  setAuth: (auth: AccountOAuthCredential) => void,
): PluginClient {
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

/** Clones SDK request data into a stable fetch shape without consuming the original. */
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

  const body = request ? (request.body ? await request.clone().arrayBuffer() : undefined) : init?.body
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

/** Requires the bridge destination to be an absolute HTTP(S) URL. */
export function getFetchDestination(input: RequestInfo | URL): URL {
  const value = input instanceof Request ? input.url : input instanceof URL ? input.toString() : input
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

/** Identifies supported model endpoints and excludes upload/other API paths. */
export function isGenerativeLanguageModelPath(pathname: string): boolean {
  return /^\/v1(?:beta)?\/models\/[^/]+:(?:generateContent|streamGenerateContent|countTokens)$/.test(pathname)
}

/** Builds the concise OAuth callback instructions shown after login begins. */
export function formatAuthInstructions(
  accounts: Array<{ email?: string | null; enabled?: boolean }>,
  maxAccounts: number,
): string {
  return [
    "Complete Google consent for Antigravity, then paste the authorization code or full localhost redirect URL.",
    ...(accounts.length >= maxAccounts
      ? [`Maximum of ${maxAccounts} Antigravity accounts reached; reconnect a saved account.`]
      : []),
  ].join("\n")
}

/** Summarizes saved accounts and the one-account-per-login workflow. */
export function formatAuthSummary(
  accounts: Array<{ email?: string | null; enabled?: boolean }>,
  maxAccounts: number,
): string {
  const lines = accounts.map((account) => {
    const email = account.email?.trim() ? account.email : "Unnamed account"
    return `- ${email}${account.enabled === false ? " (disabled)" : ""}`
  })
  return [
    `Antigravity — saved Google accounts (${accounts.length}/${maxAccounts})`,
    "",
    ...(lines.length > 0 ? lines : ["- (none yet)"]),
    "",
    "Signing in again reconnects a saved account. Manage accounts with /antigravity.",
    "One account per command. Run opencode auth login again to add another. Ctrl+C cancels.",
    ...(accounts.length >= maxAccounts
      ? [
          `Maximum of ${maxAccounts} Antigravity accounts reached. Sign in to an existing account or delete a saved account before adding another.`,
        ]
      : []),
  ].join("\n")
}

/** Parses a pasted OAuth code or redirect and enforces the expected state. */
export function parseOAuthCallbackInput(value: string, expectedState: string): { code: string; state: string } {
  const trimmed = value.trim()
  if (!trimmed) throw new Error("Missing authorization code")

  let parsed: URL
  try {
    parsed = new URL(trimmed)
  } catch {
    if (!expectedState)
      throw new Error("Missing OAuth state; restart Antigravity sign-in and paste the full redirect URL")
    return { code: trimmed, state: expectedState }
  }

  const code = parsed.searchParams.get("code")
  const state = parsed.searchParams.get("state")
  if (!code) throw new Error("Missing code in OAuth redirect URL")
  if (!state) throw new Error("Missing state in OAuth redirect URL")
  if (expectedState && state !== expectedState) throw new Error("OAuth state mismatch; restart Antigravity sign-in")
  return { code, state }
}

/** Refreshes a host credential through the shared token policy and persists rotation. */
export async function refreshOAuthCredential<T extends OAuthValue & { methodID: string }>(
  credential: T,
  client: PluginClient,
): Promise<T> {
  // Single refresh path (D-REFRESH-DUAL): delegate to the token policy.
  const refreshed = await refreshOAuthCredentialUnified(credential, client, ANTIGRAVITY_PROVIDER_ID)
  const previousRefreshToken = parseRefreshParts(credential.refresh).refreshToken
  const [rotatedRefreshToken = ""] = refreshed.refresh.split("|")
  await persistRefreshRotation(previousRefreshToken, rotatedRefreshToken)
  return refreshed
}

/** Implements the legacy agent-tool contract through account administration. */
export async function manageAccounts(
  input: { action: string; index?: number },
  client: PluginClient,
  invalidateFetch: () => void,
  setAuth: (auth: AccountOAuthCredential) => void,
): Promise<{ content: string }> {
  const accountAdministration = createOpenCodeAccountAdministration(client, ANTIGRAVITY_PROVIDER_ID)

  // Legacy tool adapter: input/output contract is unchanged. All storage
  // reads/writes live in the account service; this wrapper only
  // formats tool strings and applies in-memory effects (auth/invalidation).
  if (input.action === "list") {
    const dto = await accountAdministration.list()
    return {
      content: JSON.stringify(
        {
          activeIndex: dto.activeIndex,
          accounts: dto.accounts.map((account) => ({
            index: account.index,
            email: account.email,
            enabled: account.enabled,
            active: account.active,
            verificationRequired: account.verificationRequired,
            verificationStatus: account.verificationStatus,
            lastVerificationAt: account.lastVerificationAt,
            cooldownUntil: account.cooldownUntil,
            quotaResetTimes: account.quotaResetTimes,
          })),
        },
        null,
        2,
      ),
    }
  }

  if (input.action === "check_quota") {
    const outcome = await checkAccountsQuota(client, ANTIGRAVITY_PROVIDER_ID)
    return { content: JSON.stringify(outcome.results, null, 2) }
  }

  if (input.action === "verify") {
    const outcome = await accountAdministration.verify({ index: input.index ?? NaN })
    if ("ok" in outcome) {
      if (outcome.kind === "invalid-index") {
        return { content: `Invalid account index. There are ${outcome.accountCount} saved accounts.` }
      }
      if (outcome.kind === "not-found") {
        return { content: `Account ${input.index} was not found.` }
      }
      return { content: `Ambiguous account reference. There are ${outcome.accountCount} saved accounts.` }
    }
    invalidateFetch()
    const body: Record<string, unknown> = {
      index: outcome.index,
      email: outcome.email,
      checkedAt: outcome.checkedAt,
      status: outcome.status,
      message: outcome.message,
    }
    if (outcome.verifyUrl !== undefined) body.verifyUrl = outcome.verifyUrl
    return { content: JSON.stringify(body) }
  }

  if (input.action === "delete_all") {
    await accountAdministration.deleteAll()
    setAuth({ type: "oauth", refresh: "", access: "", expires: 0 })
    invalidateFetch()
    return { content: "All Antigravity accounts deleted." }
  }

  if (
    input.action === "delete" ||
    input.action === "enable" ||
    input.action === "disable" ||
    input.action === "select"
  ) {
    const op = input.action as MutationOp
    const outcome = await accountAdministration.mutate({ index: input.index ?? NaN }, op)
    if ("ok" in outcome) {
      if (outcome.kind === "invalid-index") {
        return { content: `Invalid account index. There are ${outcome.accountCount} saved accounts.` }
      }
      if (outcome.kind === "not-found") {
        return { content: `Account ${input.index} was not found.` }
      }
      return { content: `Unknown account action: ${input.action}` }
    }
    const selected = outcome.selected
    setAuth(
      selected
        ? {
            type: "oauth",
            refresh: formatRefreshParts(selected.refreshParts),
            access: "",
            expires: 0,
          }
        : { type: "oauth", refresh: "", access: "", expires: 0 },
    )
    invalidateFetch()
    return {
      content: selected
        ? `Selected ${selected.email ?? `account ${outcome.nextActiveIndex + 1}`}.`
        : "No Antigravity accounts remain.",
    }
  }

  // Unknown actions never reach the service, so they cannot write. The legacy
  // ordering is preserved: an out-of-range index reports the index error even
  // for an unknown action.
  const count = (await accountAdministration.list()).accounts.length
  if (!Number.isInteger(input.index) || (input.index as number) < 0 || (input.index as number) >= count) {
    return { content: `Invalid account index. There are ${count} saved accounts.` }
  }
  return { content: `Unknown account action: ${input.action}` }
}
