import crypto from "node:crypto"
import {
  ANTIGRAVITY_ENDPOINT,
  EMPTY_SCHEMA_PLACEHOLDER_NAME,
  EMPTY_SCHEMA_PLACEHOLDER_DESCRIPTION,
  getRandomizedHeaders,
} from "../constants"
import { CLAUDE_TOOL_SYSTEM_INSTRUCTION, CLAUDE_DESCRIPTION_PROMPT, ANTIGRAVITY_SYSTEM_INSTRUCTION } from "../constants"
import { getKeepThinking } from "./config"
import { createStreamingTransformer, transformSseLine, transformStreamingPayload } from "./core/streaming"
import {
  DEBUG_MESSAGE_PREFIX,
  isDebugEnabled,
  isDebugTuiEnabled,
  logAntigravityDebugResponse,
  logCacheStats,
  type AntigravityDebugContext,
} from "./debug"
import { createLogger } from "./logger"
import {
  DEFAULT_THINKING_BUDGET,
  deepFilterThinkingBlocks,
  extractThinkingConfig,
  extractVariantThinkingConfig,
  extractUsageFromSsePayload,
  extractUsageMetadata,
  fixToolResponseGrouping,
  validateAndFixClaudeToolPairing,
  applyToolPairingFixes,
  injectParameterSignatures,
  injectToolHardeningInstruction,
  isThinkingCapableModel,
  normalizeThinkingConfig,
  parseAntigravityApiBody,
  resolveThinkingConfig,
  rewriteAntigravityPreviewAccessError,
  transformThinkingParts,
  type AntigravityApiBody,
} from "./request-helpers"
import {
  analyzeConversationState,
  closeToolLoopForThinking,
  detectRecoveryErrorType,
  needsThinkingRecovery,
} from "../modules/session-recovery/index.js"
import {
  sanitizeCrossModelPayloadInPlace,
  buildSignatureSessionKey,
  cacheSignature,
  defaultSignatureStore,
  ensureThoughtSignature,
  ensureThinkingBeforeToolUseInContents,
  ensureThinkingBeforeToolUseInMessages,
  extractConversationSeedFromContents,
  extractConversationSeedFromMessages,
  extractTextFromContent,
  getCachedSignature,
  hasSignedThinkingInContents,
  hasSignedThinkingInMessages,
  hasSignedThinkingPart,
  hasToolUseInContents,
  hasToolUseInMessages,
  isGeminiThinkingPart,
  isGeminiToolUsePart,
  resolveConversationKey,
  resolveConversationKeyFromRequests,
  resolveProjectKey,
  sanitizeRequestPayloadForAntigravity,
  shouldCacheThinkingSignatures,
  isGemini3Model,
  isImageGenerationModel,
  buildImageGenerationConfig,
  isValidImageAspectRatio,
  VALID_IMAGE_ASPECT_RATIOS,
  applyGeminiTransforms,
  cleanJSONSchemaForAntigravity,
} from "../modules/inference/index.js"
import {
  resolveModelWithTier,
  resolveModelWithVariant,
  resolveAntigravityModel,
  isClaudeModel,
  isClaudeThinkingModel,
  CLAUDE_THINKING_MAX_OUTPUT_TOKENS,
  type ThinkingTier,
} from "../modules/inference/index.js"
import { getSessionFingerprint, buildFingerprintHeaders, type Fingerprint } from "./fingerprint"
import type { GoogleSearchConfig } from "../modules/inference/index.js"

const log = createLogger("request")

/** Routes signature-policy diagnostics through the request logger. */
const debugSignaturePolicy = (message: string, fields?: Record<string, unknown>): void => log.debug(message, fields)

const PLUGIN_SESSION_ID = `-${crypto.randomUUID()}`

const sessionDisplayedThinkingHashes = new Set<string>()

/** Produces a stable short key for the initial system/user conversation seed. */
function hashConversationSeed(seed: string): string {
  return crypto.createHash("sha256").update(seed, "utf8").digest("hex").slice(0, 16)
}

function formatDebugLinesForThinking(lines: string[]): string {
  const cleaned = lines
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .slice(-50)
  const prelude = `[ThinkingResolution] source=debug_tui lines=${cleaned.length}`
  return `${DEBUG_MESSAGE_PREFIX}\n- ${prelude}\n${cleaned.map((line) => `- ${line}`).join("\n")}`
}

function injectDebugThinking(response: unknown, debugText: string): unknown {
  if (!response || typeof response !== "object") {
    return response
  }

  const resp = response as any

  if (Array.isArray(resp.candidates) && resp.candidates.length > 0) {
    const candidates = resp.candidates.slice()
    const first = candidates[0]

    if (
      first &&
      typeof first === "object" &&
      first.content &&
      typeof first.content === "object" &&
      Array.isArray(first.content.parts)
    ) {
      const parts = [{ thought: true, text: debugText }, ...first.content.parts]
      candidates[0] = { ...first, content: { ...first.content, parts } }
      return { ...resp, candidates }
    }

    return resp
  }

  if (Array.isArray(resp.content)) {
    const content = [{ type: "thinking", thinking: debugText }, ...resp.content]
    return { ...resp, content }
  }

  if (!resp.reasoning_content) {
    return { ...resp, reasoning_content: debugText }
  }

  return resp
}

/**
 * Synthetic thinking placeholder text used when keep_thinking=true but debug mode is off.
 * Injected via the same path as debug text (injectDebugThinking) to ensure consistent
 * signature caching and multi-turn handling.
 */
const SYNTHETIC_THINKING_PLACEHOLDER = "[Thinking preserved]\n"

function stripInjectedDebugFromParts(parts: unknown): unknown {
  if (!Array.isArray(parts)) {
    return parts
  }

  return parts.filter((part) => {
    if (!part || typeof part !== "object") {
      return true
    }

    const record = part as any
    const text =
      typeof record.text === "string" ? record.text : typeof record.thinking === "string" ? record.thinking : undefined

    // Strip debug blocks and synthetic thinking placeholders
    if (text && (text.startsWith(DEBUG_MESSAGE_PREFIX) || text.startsWith(SYNTHETIC_THINKING_PLACEHOLDER.trim()))) {
      return false
    }

    return true
  })
}

function stripInjectedDebugFromRequestPayload(payload: Record<string, unknown>): void {
  const anyPayload = payload as any

  if (Array.isArray(anyPayload.contents)) {
    anyPayload.contents = anyPayload.contents.map((content: any) => {
      if (!content || typeof content !== "object") {
        return content
      }

      if (Array.isArray(content.parts)) {
        return { ...content, parts: stripInjectedDebugFromParts(content.parts) }
      }

      if (Array.isArray(content.content)) {
        return { ...content, content: stripInjectedDebugFromParts(content.content) }
      }

      return content
    })
  }

  if (Array.isArray(anyPayload.messages)) {
    anyPayload.messages = anyPayload.messages.map((message: any) => {
      if (!message || typeof message !== "object") {
        return message
      }

      if (Array.isArray(message.content)) {
        return { ...message, content: stripInjectedDebugFromParts(message.content) }
      }

      return message
    })
  }
}

/**
 * Gets the stable session ID for this plugin instance.
 */
export function getPluginSessionId(): string {
  return PLUGIN_SESSION_ID
}

/** Creates a request-local project identifier when Antigravity has none. */
function generateSyntheticProjectId(): string {
  const adjectives = ["useful", "bright", "swift", "calm", "bold"]
  const nouns = ["fuze", "wave", "spark", "flow", "core"]
  const adj = adjectives[Math.floor(Math.random() * adjectives.length)]
  const noun = nouns[Math.floor(Math.random() * nouns.length)]
  const randomPart = crypto.randomUUID().slice(0, 5).toLowerCase()
  return `${adj}-${noun}-${randomPart}`
}

const STREAM_ACTION = "streamGenerateContent"

/**
 * Detects requests headed to the Google Generative Language API so we can intercept them.
 */
export function isGenerativeLanguageRequest(input: RequestInfo): boolean {
  const value = typeof input === "string" ? input : input.url
  try {
    return new URL(value).hostname === "generativelanguage.googleapis.com"
  } catch {
    return false
  }
}

/**
 * Options for request preparation.
 */
export interface PrepareRequestOptions {
  claudeToolHardening?: boolean

  claudePromptAutoCaching?: boolean

  googleSearch?: GoogleSearchConfig

  fingerprint?: Fingerprint
}

const UNSUPPORTED_ANTIGRAVITY_GEMINI_MODELS = new Set(["gemini-2.5-flash", "gemini-2.5-pro", "gemini-2.5-flash-image"])

/**
 * Reject OAuth model IDs that need a Google API-key connection instead.
 */
export function assertAntigravityModelSupported(model: string): void {
  const normalizedModel = model
    .replace(/^antigravity-/i, "")
    .replace(/-(minimal|low|medium|high)$/i, "")
    .toLowerCase()

  if (UNSUPPORTED_ANTIGRAVITY_GEMINI_MODELS.has(normalizedModel)) {
    throw new Error(
      `Model "${model}" is not available through Antigravity OAuth. Use a supported antigravity-gemini-* model or a Google API-key connection.`,
    )
  }
}

export function prepareAntigravityRequest(
  input: RequestInfo,
  init: RequestInit | undefined,
  accessToken: string,
  projectId: string,
  endpointOverride?: string,
  forceThinkingRecovery = false,
  options?: PrepareRequestOptions,
): {
  request: RequestInfo
  init: RequestInit
  streaming: boolean
  requestedModel?: string
  effectiveModel?: string
  projectId?: string
  endpoint?: string
  sessionId?: string
  toolDebugMissing?: number
  toolDebugSummary?: string
  toolDebugPayload?: string
  needsSignedThinkingWarmup?: boolean
  thinkingRecoveryMessage?: string
} {
  const baseInit: RequestInit = { ...init }
  const headers = new Headers(init?.headers ?? {})
  let resolvedProjectId = projectId?.trim() || ""
  let toolDebugMissing = 0
  const toolDebugSummaries: string[] = []
  let toolDebugPayload: string | undefined
  let sessionId: string | undefined
  let needsSignedThinkingWarmup = false
  let thinkingRecoveryMessage: string | undefined

  if (!isGenerativeLanguageRequest(input)) {
    return {
      request: input,
      init: { ...baseInit, headers },
      streaming: false,
    }
  }

  headers.set("Authorization", `Bearer ${accessToken}`)
  // OAuth requests must not carry the Google SDK's API-key credential.
  headers.delete("x-goog-api-key")
  headers.delete("x-api-key")
  // Strip x-goog-user-project header to prevent 403 auth/license conflicts.
  // This header is added by OpenCode/AI SDK and can force project-level checks
  // that are not required for Antigravity OAuth requests.
  headers.delete("x-goog-user-project")

  const requestUrl = typeof input === "string" ? input : input.url
  const match = requestUrl.match(/\/models\/([^:]+):(\w+)/)
  if (!match) {
    return {
      request: input,
      init: { ...baseInit, headers },
      streaming: false,
    }
  }

  const [, rawModel = "", rawAction = ""] = match
  const requestedModel = rawModel

  assertAntigravityModelSupported(rawModel)

  const resolved = resolveAntigravityModel(rawModel)
  const effectiveModel = resolved.actualModel

  const streaming = rawAction === STREAM_ACTION
  const baseEndpoint = endpointOverride ?? ANTIGRAVITY_ENDPOINT
  const transformedUrl = `${baseEndpoint}/v1internal:${rawAction}${streaming ? "?alt=sse" : ""}`

  const isClaude = isClaudeModel(resolved.actualModel)
  const isClaudeThinking = isClaudeThinkingModel(resolved.actualModel)
  const keepThinkingEnabled = getKeepThinking()
  const enableClaudePromptAutoCaching = options?.claudePromptAutoCaching ?? false

  // Tier-based thinking configuration from model resolver (can be overridden by variant config)
  let tierThinkingBudget = resolved.thinkingBudget
  let tierThinkingLevel = resolved.thinkingLevel
  let signatureSessionKey = buildSignatureSessionKey(
    PLUGIN_SESSION_ID,
    effectiveModel,
    undefined,
    resolveProjectKey(projectId),
  )

  let body = baseInit.body
  if (typeof baseInit.body === "string" && baseInit.body) {
    try {
      const parsedBody = JSON.parse(baseInit.body) as Record<string, unknown>
      const isWrapped = typeof parsedBody.project === "string" && "request" in parsedBody

      if (isWrapped) {
        const wrappedBody = {
          ...parsedBody,
          model: effectiveModel,
        } as Record<string, unknown>

        // Some callers may already send an Antigravity-wrapped body.
        // We still need to sanitize Claude thinking blocks (remove cache_control)
        // and attach a stable sessionId so multi-turn signature caching works.
        const requestRoot = wrappedBody.request
        const requestObjects: Array<Record<string, unknown>> = []

        if (requestRoot && typeof requestRoot === "object") {
          requestObjects.push(requestRoot as Record<string, unknown>)
          const nested = (requestRoot as any).request
          if (nested && typeof nested === "object") {
            requestObjects.push(nested as Record<string, unknown>)
          }
        }

        const conversationKey = resolveConversationKeyFromRequests(requestObjects, hashConversationSeed)
        // Strip tier suffix from model for cache key to prevent cache misses on tier change
        // e.g., "claude-opus-4-6-thinking-high" -> "claude-opus-4-6-thinking"
        const modelForCacheKey = effectiveModel.replace(/-(minimal|low|medium|high)$/i, "")
        signatureSessionKey = buildSignatureSessionKey(
          PLUGIN_SESSION_ID,
          modelForCacheKey,
          conversationKey,
          resolveProjectKey(parsedBody.project),
        )

        if (requestObjects.length > 0) {
          sessionId = signatureSessionKey
        }

        for (const req of requestObjects) {
          // Use stable session ID for signature caching across multi-turn conversations
          ;(req as any).sessionId = signatureSessionKey
          stripInjectedDebugFromRequestPayload(req as Record<string, unknown>)

          if (isClaude) {
            // Step 0: Sanitize cross-model metadata (strips Gemini signatures when sending to Claude)
            sanitizeCrossModelPayloadInPlace(req, { targetModel: effectiveModel })

            // Step 1: Strip corrupted/unsigned thinking blocks FIRST
            deepFilterThinkingBlocks(req, signatureSessionKey, getCachedSignature, true)

            if (enableClaudePromptAutoCaching && (req as any).cache_control === undefined) {
              ;(req as any).cache_control = { type: "ephemeral" }
            }

            // Step 2: THEN inject signed thinking from cache (after stripping)
            if (isClaudeThinking && keepThinkingEnabled && Array.isArray((req as any).contents)) {
              ;(req as any).contents = ensureThinkingBeforeToolUseInContents(
                (req as any).contents,
                signatureSessionKey,
                { onDebug: debugSignaturePolicy },
              )
            }
            if (isClaudeThinking && keepThinkingEnabled && Array.isArray((req as any).messages)) {
              ;(req as any).messages = ensureThinkingBeforeToolUseInMessages(
                (req as any).messages,
                signatureSessionKey,
                { onDebug: debugSignaturePolicy },
              )
            }

            // Step 3: Apply tool pairing fixes (ID assignment, response matching, orphan recovery)
            applyToolPairingFixes(req as Record<string, unknown>, true)
          }
        }

        if (isClaudeThinking && keepThinkingEnabled && sessionId) {
          const hasToolUse = requestObjects.some(
            (req) =>
              (Array.isArray((req as any).contents) && hasToolUseInContents((req as any).contents)) ||
              (Array.isArray((req as any).messages) && hasToolUseInMessages((req as any).messages)),
          )
          const hasSignedThinking = requestObjects.some(
            (req) =>
              (Array.isArray((req as any).contents) &&
                hasSignedThinkingInContents((req as any).contents, signatureSessionKey)) ||
              (Array.isArray((req as any).messages) &&
                hasSignedThinkingInMessages((req as any).messages, signatureSessionKey)),
          )
          const hasCachedThinking = defaultSignatureStore.has(signatureSessionKey)
          needsSignedThinkingWarmup = hasToolUse && !hasSignedThinking && !hasCachedThinking
        }

        body = JSON.stringify(wrappedBody)
      } else {
        const requestPayload: Record<string, unknown> = { ...parsedBody }

        const rawGenerationConfig = requestPayload.generationConfig as Record<string, unknown> | undefined
        const extraBody = requestPayload.extra_body as Record<string, unknown> | undefined

        const variantConfig = extractVariantThinkingConfig(
          requestPayload.providerOptions as Record<string, unknown> | undefined,
          rawGenerationConfig,
        )
        const isGemini3 = effectiveModel.toLowerCase().includes("gemini-3")

        log.debug(
          `[ThinkingResolution] rawModel=${rawModel} resolvedModel=${effectiveModel} resolvedTier=${tierThinkingLevel ?? "none"} variantLevel=${variantConfig?.thinkingLevel ?? "none"} variantBudget=${variantConfig?.thinkingBudget ?? "none"} providerOptions.google=${JSON.stringify((requestPayload.providerOptions as any)?.google ?? null)} generationConfig.thinkingConfig=${JSON.stringify((rawGenerationConfig as any)?.thinkingConfig ?? null)}`,
        )

        if (variantConfig?.thinkingLevel && isGemini3) {
          // Gemini 3 native format - use thinkingLevel directly
          tierThinkingLevel = variantConfig.thinkingLevel
          tierThinkingBudget = undefined
        } else if (variantConfig?.thinkingBudget) {
          if (isGemini3) {
            // Legacy format for Gemini 3 - convert with deprecation warning
            log.warn("[Deprecated] Using thinkingBudget for Gemini 3 model. Use thinkingLevel instead.")
            tierThinkingLevel =
              variantConfig.thinkingBudget <= 8192 ? "low" : variantConfig.thinkingBudget <= 16384 ? "medium" : "high"
            tierThinkingBudget = undefined
          } else {
            // Claude / Gemini 2.5 - use budget directly
            tierThinkingBudget = variantConfig.thinkingBudget
            tierThinkingLevel = undefined
          }
        }

        if (isClaude) {
          if (!requestPayload.toolConfig) {
            requestPayload.toolConfig = {}
          }
          if (typeof requestPayload.toolConfig === "object" && requestPayload.toolConfig !== null) {
            const toolConfig = requestPayload.toolConfig as Record<string, unknown>
            if (!toolConfig.functionCallingConfig) {
              toolConfig.functionCallingConfig = {}
            }
            if (typeof toolConfig.functionCallingConfig === "object" && toolConfig.functionCallingConfig !== null) {
              ;(toolConfig.functionCallingConfig as Record<string, unknown>).mode = "VALIDATED"
            }
          }
        }

        // Resolve thinking configuration based on user settings and model capabilities
        // Image generation models don't support thinking - skip thinking config entirely
        const isImageModel = isImageGenerationModel(effectiveModel)
        const userThinkingConfig = isImageModel
          ? undefined
          : extractThinkingConfig(requestPayload, rawGenerationConfig, extraBody)
        const hasAssistantHistory =
          Array.isArray(requestPayload.contents) &&
          requestPayload.contents.some((c: any) => c?.role === "model" || c?.role === "assistant")

        // The legacy bare Sonnet 4.6 ID is non-thinking.
        // Ignore any client-provided thinkingConfig for that model.
        const lowerEffective = effectiveModel.toLowerCase()
        const isClaudeSonnetNonThinking = lowerEffective === "claude-sonnet-4-6"
        const effectiveUserThinkingConfig = isClaudeSonnetNonThinking || isImageModel ? undefined : userThinkingConfig

        // For image models, add imageConfig instead of thinkingConfig
        if (isImageModel) {
          const imageAspectRatio = process.env.OPENCODE_IMAGE_ASPECT_RATIO
          if (imageAspectRatio && !isValidImageAspectRatio(imageAspectRatio)) {
            log.warn(`Invalid aspect ratio "${imageAspectRatio}". Using default "1:1".`, {
              validAspectRatios: VALID_IMAGE_ASPECT_RATIOS,
            })
          }
          const imageConfig = buildImageGenerationConfig(imageAspectRatio)
          const generationConfig = (rawGenerationConfig ?? {}) as Record<string, unknown>
          generationConfig.imageConfig = imageConfig
          // Remove any thinkingConfig that might have been set
          delete generationConfig.thinkingConfig
          // Set reasonable defaults for image generation
          if (!generationConfig.candidateCount) {
            generationConfig.candidateCount = 1
          }
          requestPayload.generationConfig = generationConfig

          // Add safety settings for image generation (permissive to allow creative content)
          if (!requestPayload.safetySettings) {
            requestPayload.safetySettings = [
              { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_ONLY_HIGH" },
              { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_ONLY_HIGH" },
              { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_ONLY_HIGH" },
              { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_ONLY_HIGH" },
              { category: "HARM_CATEGORY_CIVIC_INTEGRITY", threshold: "BLOCK_ONLY_HIGH" },
            ]
          }

          // Image models don't support tools - remove them entirely
          delete requestPayload.tools
          delete requestPayload.toolConfig

          // Replace system instruction with a simple image generation prompt
          // Image models should not receive agentic coding assistant instructions
          requestPayload.systemInstruction = {
            parts: [
              {
                text: "You are an AI image generator. Generate images based on user descriptions. Focus on creating high-quality, visually appealing images that match the user's request.",
              },
            ],
          }
        } else {
          const finalThinkingConfig = resolveThinkingConfig(
            effectiveUserThinkingConfig,
            isClaudeSonnetNonThinking ? false : (resolved.isThinkingModel ?? isThinkingCapableModel(effectiveModel)),
            isClaude,
            hasAssistantHistory,
          )

          const normalizedThinking = normalizeThinkingConfig(finalThinkingConfig)
          if (normalizedThinking) {
            // Use tier-based thinking budget if specified via model suffix, otherwise fall back to user config
            const thinkingBudget = tierThinkingBudget ?? normalizedThinking.thinkingBudget

            // Build thinking config based on model type
            let thinkingConfig: Record<string, unknown>

            if (isClaudeThinking) {
              // Claude uses snake_case keys
              thinkingConfig = {
                include_thoughts: normalizedThinking.includeThoughts ?? true,
                ...(typeof thinkingBudget === "number" && thinkingBudget > 0
                  ? { thinking_budget: thinkingBudget }
                  : {}),
              }
            } else if (tierThinkingLevel) {
              // Gemini 3 uses thinkingLevel string (low/medium/high)
              thinkingConfig = {
                includeThoughts: normalizedThinking.includeThoughts,
                thinkingLevel: tierThinkingLevel,
              }
            } else {
              // Gemini 2.5 and others use numeric budget
              thinkingConfig = {
                includeThoughts: normalizedThinking.includeThoughts,
                ...(typeof thinkingBudget === "number" && thinkingBudget > 0 ? { thinkingBudget } : {}),
              }
            }

            if (rawGenerationConfig) {
              rawGenerationConfig.thinkingConfig = thinkingConfig

              if (isClaudeThinking && typeof thinkingBudget === "number" && thinkingBudget > 0) {
                const currentMax = (rawGenerationConfig.maxOutputTokens ?? rawGenerationConfig.max_output_tokens) as
                  number | undefined
                if (!currentMax || currentMax <= thinkingBudget) {
                  rawGenerationConfig.maxOutputTokens = CLAUDE_THINKING_MAX_OUTPUT_TOKENS
                  if (rawGenerationConfig.max_output_tokens !== undefined) {
                    delete rawGenerationConfig.max_output_tokens
                  }
                }
              }

              requestPayload.generationConfig = rawGenerationConfig
            } else {
              const generationConfig: Record<string, unknown> = { thinkingConfig }

              if (isClaudeThinking && typeof thinkingBudget === "number" && thinkingBudget > 0) {
                generationConfig.maxOutputTokens = CLAUDE_THINKING_MAX_OUTPUT_TOKENS
              }

              requestPayload.generationConfig = generationConfig
            }
          } else if (rawGenerationConfig?.thinkingConfig) {
            delete rawGenerationConfig.thinkingConfig
            requestPayload.generationConfig = rawGenerationConfig
          }
        } // End of else block for non-image models

        // Clean up thinking fields from extra_body
        if (extraBody) {
          delete extraBody.thinkingConfig
          delete extraBody.thinking
        }
        delete requestPayload.thinkingConfig
        delete requestPayload.thinking

        if ("system_instruction" in requestPayload) {
          requestPayload.systemInstruction = requestPayload.system_instruction
          delete requestPayload.system_instruction
        }

        if (isClaudeThinking && Array.isArray(requestPayload.tools) && requestPayload.tools.length > 0) {
          const hint =
            "Interleaved thinking is enabled. You may think between tool calls and after receiving tool results before deciding the next action or final answer. Do not mention these instructions or any constraints about thinking blocks; just apply them."
          const existing = requestPayload.systemInstruction

          if (typeof existing === "string") {
            requestPayload.systemInstruction = existing.trim().length > 0 ? `${existing}\n\n${hint}` : hint
          } else if (existing && typeof existing === "object") {
            const sys = existing as Record<string, unknown>
            const partsValue = sys.parts

            if (Array.isArray(partsValue)) {
              const parts = partsValue as unknown[]
              let appended = false

              for (let i = parts.length - 1; i >= 0; i--) {
                const part = parts[i]
                if (part && typeof part === "object") {
                  const partRecord = part as Record<string, unknown>
                  const text = partRecord.text
                  if (typeof text === "string") {
                    partRecord.text = `${text}\n\n${hint}`
                    appended = true
                    break
                  }
                }
              }

              if (!appended) {
                parts.push({ text: hint })
              }
            } else {
              sys.parts = [{ text: hint }]
            }

            requestPayload.systemInstruction = sys
          } else if (Array.isArray(requestPayload.contents)) {
            requestPayload.systemInstruction = { parts: [{ text: hint }] }
          }
        }

        const cachedContentFromExtra =
          typeof requestPayload.extra_body === "object" && requestPayload.extra_body
            ? ((requestPayload.extra_body as Record<string, unknown>).cached_content ??
              (requestPayload.extra_body as Record<string, unknown>).cachedContent)
            : undefined
        const cachedContent =
          (requestPayload.cached_content as string | undefined) ??
          (requestPayload.cachedContent as string | undefined) ??
          (cachedContentFromExtra as string | undefined)
        if (cachedContent) {
          requestPayload.cachedContent = cachedContent
        }

        delete requestPayload.cached_content
        delete requestPayload.cachedContent
        if (requestPayload.extra_body && typeof requestPayload.extra_body === "object") {
          delete (requestPayload.extra_body as Record<string, unknown>).cached_content
          delete (requestPayload.extra_body as Record<string, unknown>).cachedContent
          if (Object.keys(requestPayload.extra_body as Record<string, unknown>).length === 0) {
            delete requestPayload.extra_body
          }
        }

        // Normalize tools. For Claude models, keep full function declarations (names + schemas).
        const hasTools = Array.isArray(requestPayload.tools) && requestPayload.tools.length > 0

        if (hasTools) {
          if (isClaude) {
            const functionDeclarations: any[] = []
            const passthroughTools: any[] = []

            const normalizeSchema = (schema: any) => {
              const createPlaceholderSchema = (base: any = {}) => ({
                ...base,
                type: "object",
                properties: {
                  [EMPTY_SCHEMA_PLACEHOLDER_NAME]: {
                    type: "boolean",
                    description: EMPTY_SCHEMA_PLACEHOLDER_DESCRIPTION,
                  },
                },
                required: [EMPTY_SCHEMA_PLACEHOLDER_NAME],
              })

              if (!schema || typeof schema !== "object" || Array.isArray(schema)) {
                toolDebugMissing += 1
                return createPlaceholderSchema()
              }

              const cleaned = cleanJSONSchemaForAntigravity(schema)

              if (!cleaned || typeof cleaned !== "object" || Array.isArray(cleaned)) {
                toolDebugMissing += 1
                return createPlaceholderSchema()
              }

              // Claude VALIDATED mode requires tool parameters to be an object schema
              // with at least one property.
              const hasProperties =
                cleaned.properties &&
                typeof cleaned.properties === "object" &&
                Object.keys(cleaned.properties).length > 0

              cleaned.type = "object"

              if (!hasProperties) {
                cleaned.properties = {
                  [EMPTY_SCHEMA_PLACEHOLDER_NAME]: {
                    type: "boolean",
                    description: EMPTY_SCHEMA_PLACEHOLDER_DESCRIPTION,
                  },
                }
                cleaned.required = Array.isArray(cleaned.required)
                  ? Array.from(new Set([...cleaned.required, EMPTY_SCHEMA_PLACEHOLDER_NAME]))
                  : [EMPTY_SCHEMA_PLACEHOLDER_NAME]
              }

              return cleaned
            }

            ;(requestPayload.tools as any[]).forEach((tool: any) => {
              const pushDeclaration = (decl: any, source: string) => {
                const schema =
                  decl?.parameters ||
                  decl?.parametersJsonSchema ||
                  decl?.input_schema ||
                  decl?.inputSchema ||
                  tool.parameters ||
                  tool.parametersJsonSchema ||
                  tool.input_schema ||
                  tool.inputSchema ||
                  tool.function?.parameters ||
                  tool.function?.parametersJsonSchema ||
                  tool.function?.input_schema ||
                  tool.function?.inputSchema ||
                  tool.custom?.parameters ||
                  tool.custom?.parametersJsonSchema ||
                  tool.custom?.input_schema

                let name =
                  decl?.name ||
                  tool.name ||
                  tool.function?.name ||
                  tool.custom?.name ||
                  `tool-${functionDeclarations.length}`

                // Sanitize tool name: must be alphanumeric with underscores, no special chars
                name = String(name)
                  .replace(/[^a-zA-Z0-9_-]/g, "_")
                  .slice(0, 64)

                const description =
                  decl?.description || tool.description || tool.function?.description || tool.custom?.description || ""

                functionDeclarations.push({
                  name,
                  description: String(description || ""),
                  parameters: normalizeSchema(schema),
                })

                toolDebugSummaries.push(`decl=${name},src=${source},hasSchema=${schema ? "y" : "n"}`)
              }

              if (Array.isArray(tool.functionDeclarations) && tool.functionDeclarations.length > 0) {
                tool.functionDeclarations.forEach((decl: any) => pushDeclaration(decl, "functionDeclarations"))
                return
              }

              // Fall back to function/custom style definitions.
              if (tool.function || tool.custom || tool.parameters || tool.input_schema || tool.inputSchema) {
                pushDeclaration(tool.function ?? tool.custom ?? tool, "function/custom")
                return
              }

              // Preserve any non-function tool entries (e.g., codeExecution) untouched.
              passthroughTools.push(tool)
            })

            const finalTools: any[] = []
            if (functionDeclarations.length > 0) {
              finalTools.push({ functionDeclarations })
            }
            requestPayload.tools = finalTools.concat(passthroughTools)
          } else {
            // Gemini-specific tool normalization and feature injection
            const geminiResult = applyGeminiTransforms(requestPayload, {
              model: effectiveModel,
              normalizedThinking: undefined, // Thinking config already applied above (lines 816-880)
              tierThinkingBudget,
              tierThinkingLevel: tierThinkingLevel as ThinkingTier | undefined,
            })

            if (geminiResult.webSearchSkipped) {
              log.warn("web_search was skipped because Gemini cannot combine it with function declarations")
            }

            toolDebugMissing = geminiResult.toolDebugMissing
            toolDebugSummaries.push(...geminiResult.toolDebugSummaries)
          }

          try {
            toolDebugPayload = JSON.stringify(requestPayload.tools)
          } catch {
            toolDebugPayload = undefined
          }

          // Apply Claude tool hardening (ported from LLM-API-Key-Proxy)
          // Injects parameter signatures into descriptions and adds system instruction
          // Can be disabled via config.claude_tool_hardening = false to reduce context size
          const enableToolHardening = options?.claudeToolHardening ?? true
          if (
            enableToolHardening &&
            isClaude &&
            Array.isArray(requestPayload.tools) &&
            requestPayload.tools.length > 0
          ) {
            // Inject parameter signatures into tool descriptions
            requestPayload.tools = injectParameterSignatures(requestPayload.tools, CLAUDE_DESCRIPTION_PROMPT)

            // Inject tool hardening system instruction
            injectToolHardeningInstruction(requestPayload as Record<string, unknown>, CLAUDE_TOOL_SYSTEM_INSTRUCTION)
          }
        }

        const conversationKey = resolveConversationKey(requestPayload, hashConversationSeed)
        signatureSessionKey = buildSignatureSessionKey(
          PLUGIN_SESSION_ID,
          effectiveModel,
          conversationKey,
          resolveProjectKey(projectId),
        )

        // For Claude models, filter out unsigned thinking blocks (required by Claude API)
        // Attempts to restore signatures from cache for multi-turn conversations
        // Handle both Gemini-style contents[] and Anthropic-style messages[] payloads.
        if (isClaude) {
          // Step 0: Sanitize cross-model metadata (strips Gemini signatures when sending to Claude)
          sanitizeCrossModelPayloadInPlace(requestPayload, { targetModel: effectiveModel })

          // Step 1: Strip corrupted/unsigned thinking blocks FIRST
          deepFilterThinkingBlocks(requestPayload, signatureSessionKey, getCachedSignature, true)

          if (enableClaudePromptAutoCaching && requestPayload.cache_control === undefined) {
            requestPayload.cache_control = { type: "ephemeral" }
          }

          // Step 2: THEN inject signed thinking from cache (after stripping)
          if (isClaudeThinking && keepThinkingEnabled && Array.isArray(requestPayload.contents)) {
            requestPayload.contents = ensureThinkingBeforeToolUseInContents(
              requestPayload.contents,
              signatureSessionKey,
              { onDebug: debugSignaturePolicy },
            )
          }
          if (isClaudeThinking && keepThinkingEnabled && Array.isArray(requestPayload.messages)) {
            requestPayload.messages = ensureThinkingBeforeToolUseInMessages(
              requestPayload.messages,
              signatureSessionKey,
              { onDebug: debugSignaturePolicy },
            )
          }

          // Step 3: Check if warmup needed (AFTER injection attempt)
          if (isClaudeThinking && keepThinkingEnabled) {
            const hasToolUse =
              (Array.isArray(requestPayload.contents) && hasToolUseInContents(requestPayload.contents)) ||
              (Array.isArray(requestPayload.messages) && hasToolUseInMessages(requestPayload.messages))
            const hasSignedThinking =
              (Array.isArray(requestPayload.contents) &&
                hasSignedThinkingInContents(requestPayload.contents, signatureSessionKey)) ||
              (Array.isArray(requestPayload.messages) &&
                hasSignedThinkingInMessages(requestPayload.messages, signatureSessionKey))
            const hasCachedThinking = defaultSignatureStore.has(signatureSessionKey)
            needsSignedThinkingWarmup = hasToolUse && !hasSignedThinking && !hasCachedThinking
          }
        }

        // For Claude models, ensure functionCall/tool use parts carry IDs (required by Anthropic).
        // We use a two-pass approach: first collect all functionCalls and assign IDs,
        // then match functionResponses to their corresponding calls using a FIFO queue per function name.
        if (isClaude && Array.isArray(requestPayload.contents)) {
          let toolCallCounter = 0
          // Track pending call IDs per function name as a FIFO queue
          const pendingCallIdsByName = new Map<string, string[]>()

          // First pass: assign IDs to all functionCalls and collect them
          requestPayload.contents = requestPayload.contents.map((content: any) => {
            if (!content || !Array.isArray(content.parts)) {
              return content
            }

            const newParts = content.parts.map((part: any) => {
              if (part && typeof part === "object" && part.functionCall) {
                const call = { ...part.functionCall }
                if (!call.id) {
                  call.id = `tool-call-${++toolCallCounter}`
                }
                const nameKey = typeof call.name === "string" ? call.name : `tool-${toolCallCounter}`
                // Push to the queue for this function name
                const queue = pendingCallIdsByName.get(nameKey) || []
                queue.push(call.id)
                pendingCallIdsByName.set(nameKey, queue)
                return { ...part, functionCall: call }
              }
              return part
            })

            return { ...content, parts: newParts }
          })

          // Second pass: match functionResponses to their corresponding calls (FIFO order)
          requestPayload.contents = (requestPayload.contents as any[]).map((content: any) => {
            if (!content || !Array.isArray(content.parts)) {
              return content
            }

            const newParts = content.parts.map((part: any) => {
              if (part && typeof part === "object" && part.functionResponse) {
                const resp = { ...part.functionResponse }
                if (!resp.id && typeof resp.name === "string") {
                  const queue = pendingCallIdsByName.get(resp.name)
                  if (queue && queue.length > 0) {
                    // Consume the first pending ID (FIFO order)
                    resp.id = queue.shift()
                    pendingCallIdsByName.set(resp.name, queue)
                  }
                }
                return { ...part, functionResponse: resp }
              }
              return part
            })

            return { ...content, parts: newParts }
          })

          // Third pass: Apply orphan recovery for mismatched tool IDs
          // This handles cases where context compaction or other processes
          // create ID mismatches between calls and responses.
          // Ported from LLM-API-Key-Proxy's _fix_tool_response_grouping()
          requestPayload.contents = fixToolResponseGrouping(requestPayload.contents as any[])
        }

        // Fourth pass: Fix Claude format tool pairing (defense in depth)
        // Handles orphaned tool_use blocks in Claude's messages[] format
        if (Array.isArray(requestPayload.messages)) {
          requestPayload.messages = validateAndFixClaudeToolPairing(requestPayload.messages)
        }

        // =====================================================================
        // LAST RESORT RECOVERY: "Let it crash and start again"
        // =====================================================================
        // If after all our processing we're STILL in a bad state (tool loop without
        // thinking at turn start), don't try to fix it - just close the turn and
        // start fresh. This prevents permanent session breakage.
        //
        // This handles cases where:
        // - Context compaction stripped thinking blocks
        // - Signature cache miss
        // - Any other corruption we couldn't repair
        // - API error indicated thinking_block_order issue (forceThinkingRecovery=true)
        //
        // The synthetic messages allow Claude to generate fresh thinking on the
        // new turn instead of failing with "Expected thinking but found text".
        if (isClaudeThinking && Array.isArray(requestPayload.contents)) {
          const conversationState = analyzeConversationState(requestPayload.contents)

          // Force recovery if API returned thinking_block_order error (retry case)
          // or if proactive check detects we need recovery
          if (forceThinkingRecovery || needsThinkingRecovery(conversationState)) {
            // Set message for toast notification (shown in plugin.ts, respects quiet mode)
            thinkingRecoveryMessage = forceThinkingRecovery
              ? "Thinking recovery: retrying with fresh turn (API error)"
              : "Thinking recovery: restarting turn (corrupted context)"

            requestPayload.contents = closeToolLoopForThinking(requestPayload.contents)

            defaultSignatureStore.delete(signatureSessionKey)
          }
        }

        if ("model" in requestPayload) {
          delete requestPayload.model
        }

        stripInjectedDebugFromRequestPayload(requestPayload)
        sanitizeRequestPayloadForAntigravity(requestPayload, { signatureSessionKey })

        const effectiveProjectId = projectId?.trim() || generateSyntheticProjectId()
        resolvedProjectId = effectiveProjectId

        // Inject Antigravity system instruction with role "user" (CLIProxyAPI v6.6.89 compatibility)
        // This sets request.systemInstruction.role = "user" and request.systemInstruction.parts[0].text
        const existingSystemInstruction = requestPayload.systemInstruction
        if (existingSystemInstruction && typeof existingSystemInstruction === "object") {
          const sys = existingSystemInstruction as Record<string, unknown>
          sys.role = "user"
          if (Array.isArray(sys.parts) && sys.parts.length > 0) {
            const firstPart = sys.parts[0] as Record<string, unknown>
            if (firstPart && typeof firstPart.text === "string") {
              firstPart.text = ANTIGRAVITY_SYSTEM_INSTRUCTION + "\n\n" + firstPart.text
            } else {
              sys.parts = [{ text: ANTIGRAVITY_SYSTEM_INSTRUCTION }, ...sys.parts]
            }
          } else {
            sys.parts = [{ text: ANTIGRAVITY_SYSTEM_INSTRUCTION }]
          }
        } else if (typeof existingSystemInstruction === "string") {
          requestPayload.systemInstruction = {
            role: "user",
            parts: [{ text: ANTIGRAVITY_SYSTEM_INSTRUCTION + "\n\n" + existingSystemInstruction }],
          }
        } else {
          requestPayload.systemInstruction = {
            role: "user",
            parts: [{ text: ANTIGRAVITY_SYSTEM_INSTRUCTION }],
          }
        }

        const wrappedBody: Record<string, unknown> = {
          project: effectiveProjectId,
          model: effectiveModel,
          request: requestPayload,
        }

        wrappedBody.requestType = "agent"
        wrappedBody.userAgent = "antigravity"
        wrappedBody.requestId = "agent-" + crypto.randomUUID()
        if (wrappedBody.request && typeof wrappedBody.request === "object") {
          // Use stable session ID for signature caching across multi-turn conversations
          sessionId = signatureSessionKey
          ;(wrappedBody.request as any).sessionId = signatureSessionKey
        }

        body = JSON.stringify(wrappedBody)
      }
    } catch (error) {
      throw error
    }
  }

  if (streaming) {
    headers.set("Accept", "text/event-stream")
  }

  // Add interleaved thinking header for Claude thinking models
  // This enables real-time streaming of thinking tokens
  if (isClaudeThinking) {
    const existing = headers.get("anthropic-beta")
    const interleavedHeader = "interleaved-thinking-2025-05-14"

    if (existing) {
      if (!existing.includes(interleavedHeader)) {
        headers.set("anthropic-beta", `${existing},${interleavedHeader}`)
      }
    } else {
      headers.set("anthropic-beta", interleavedHeader)
    }
  }

  const selectedHeaders = getRandomizedHeaders()
  const fingerprint = options?.fingerprint ?? getSessionFingerprint()
  const fingerprintHeaders = buildFingerprintHeaders(fingerprint)

  headers.set("User-Agent", fingerprintHeaders["User-Agent"] || selectedHeaders["User-Agent"])
  return {
    request: transformedUrl,
    init: {
      ...baseInit,
      headers,
      body,
    },
    streaming,
    requestedModel,
    effectiveModel: effectiveModel,
    projectId: resolvedProjectId,
    endpoint: transformedUrl,
    sessionId,
    toolDebugMissing,
    toolDebugSummary: toolDebugSummaries.slice(0, 20).join(" | "),
    toolDebugPayload,
    needsSignedThinkingWarmup,
    thinkingRecoveryMessage,
  }
}

export function buildThinkingWarmupBody(bodyText: string | undefined, isClaudeThinking: boolean): string | null {
  if (!bodyText || !isClaudeThinking) {
    return null
  }

  let parsed: Record<string, unknown>
  try {
    parsed = JSON.parse(bodyText) as Record<string, unknown>
  } catch {
    return null
  }

  const warmupPrompt = "Warmup request for thinking signature."

  const updateRequest = (req: Record<string, unknown>) => {
    req.contents = [{ role: "user", parts: [{ text: warmupPrompt }] }]
    delete req.tools
    delete (req as any).toolConfig

    const generationConfig = (req.generationConfig ?? {}) as Record<string, unknown>
    generationConfig.thinkingConfig = {
      include_thoughts: true,
      thinking_budget: DEFAULT_THINKING_BUDGET,
    }
    generationConfig.maxOutputTokens = CLAUDE_THINKING_MAX_OUTPUT_TOKENS
    req.generationConfig = generationConfig
  }

  if (parsed.request && typeof parsed.request === "object") {
    updateRequest(parsed.request as Record<string, unknown>)
    const nested = (parsed.request as any).request
    if (nested && typeof nested === "object") {
      updateRequest(nested as Record<string, unknown>)
    }
  } else {
    updateRequest(parsed)
  }

  return JSON.stringify(parsed)
}

/**
 * Normalizes Antigravity responses: applies retry headers, extracts cache usage into headers,
 * rewrites preview errors, flattens streaming payloads, and logs debug metadata.
 *
 * For streaming SSE responses, uses TransformStream for true real-time incremental streaming.
 * Thinking/reasoning tokens are transformed and forwarded immediately as they arrive.
 */
export async function transformAntigravityResponse(
  response: Response,
  streaming: boolean,
  debugContext?: AntigravityDebugContext | null,
  requestedModel?: string,
  projectId?: string,
  endpoint?: string,
  effectiveModel?: string,
  sessionId?: string,
  toolDebugMissing?: number,
  toolDebugSummary?: string,
  toolDebugPayload?: string,
  debugLines?: string[],
): Promise<Response> {
  const contentType = response.headers.get("content-type") ?? ""
  const isJsonResponse = contentType.includes("application/json")
  const isEventStreamResponse = contentType.includes("text/event-stream")

  // Generate text for thinking injection:
  // - If debug=true: inject full debug logs
  // - If keep_thinking=true (but no debug): inject placeholder to trigger signature caching
  // Both use the same injection path (injectDebugThinking) for consistent behavior
  const debugText =
    isDebugTuiEnabled() && Array.isArray(debugLines) && debugLines.length > 0
      ? formatDebugLinesForThinking(debugLines)
      : getKeepThinking()
        ? SYNTHETIC_THINKING_PLACEHOLDER
        : undefined
  const cacheSignatures = shouldCacheThinkingSignatures(effectiveModel)

  if (!isJsonResponse && !isEventStreamResponse) {
    logAntigravityDebugResponse(debugContext, response, {
      note: "Non-JSON response (body omitted)",
    })
    return response
  }

  // For successful streaming responses, use TransformStream to transform SSE events
  // while maintaining real-time streaming (no buffering of entire response).
  // This enables thinking tokens to be displayed as they arrive, like the Codex plugin.
  if (streaming && response.ok && isEventStreamResponse && response.body) {
    const headers = new Headers(response.headers)

    logAntigravityDebugResponse(debugContext, response, {
      note: "Streaming SSE response (real-time transform)",
    })

    const streamingTransformer = createStreamingTransformer(
      defaultSignatureStore,
      {
        onCacheSignature: cacheSignature,
        onInjectDebug: injectDebugThinking,
        // onInjectSyntheticThinking removed - keep_thinking now uses debugText path
        transformThinkingParts,
      },
      {
        signatureSessionKey: sessionId,
        debugText,
        cacheSignatures,
        displayedThinkingHashes:
          effectiveModel && isGemini3Model(effectiveModel) ? sessionDisplayedThinkingHashes : undefined,
        // injectSyntheticThinking removed - keep_thinking now unified with debug via debugText
      },
    )
    return new Response(response.body.pipeThrough(streamingTransformer), {
      status: response.status,
      statusText: response.statusText,
      headers,
    })
  }

  const responseFallback = response.clone()

  try {
    const headers = new Headers(response.headers)
    const text = await response.text()

    if (!response.ok) {
      let errorBody
      try {
        errorBody = JSON.parse(text)
      } catch {
        errorBody = { error: { message: text } }
      }

      // Inject Debug Info
      if (errorBody?.error) {
        const rawErrorMessage =
          typeof errorBody.error.message === "string" && errorBody.error.message.length > 0
            ? errorBody.error.message
            : "Unknown error"
        const errorType = detectRecoveryErrorType(rawErrorMessage)
        const debugInfo = `\n\n[Debug Info]\nRequested Model: ${requestedModel || "Unknown"}\nEffective Model: ${effectiveModel || "Unknown"}\nProject: ${projectId || "Unknown"}\nEndpoint: ${endpoint || "Unknown"}\nStatus: ${response.status}\nRequest ID: ${headers.get("x-request-id") || "N/A"}${toolDebugMissing !== undefined ? `\nTool Debug Missing: ${toolDebugMissing}` : ""}${toolDebugSummary ? `\nTool Debug Summary: ${toolDebugSummary}` : ""}${toolDebugPayload ? `\nTool Debug Payload: ${toolDebugPayload}` : ""}`
        const injectedDebug = debugText ? `\n\n${debugText}` : ""
        errorBody.error.message = rawErrorMessage + debugInfo + injectedDebug

        // Check if this is a recoverable thinking error - throw to trigger retry
        if (errorType === "thinking_block_order") {
          const recoveryError = new Error("THINKING_RECOVERY_NEEDED")
          ;(recoveryError as any).recoveryType = errorType
          ;(recoveryError as any).originalError = errorBody
          ;(recoveryError as any).debugInfo = debugInfo
          throw recoveryError
        }

        // Detect context length / prompt too long errors - signal to caller for toast
        const errorMessage = errorBody.error.message?.toLowerCase() || ""
        if (
          errorMessage.includes("prompt is too long") ||
          errorMessage.includes("context length exceeded") ||
          errorMessage.includes("context_length_exceeded") ||
          errorMessage.includes("maximum context length")
        ) {
          headers.set("x-antigravity-context-error", "prompt_too_long")
        }

        // Detect tool pairing errors - signal to caller for toast
        if (
          errorMessage.includes("tool_use") &&
          errorMessage.includes("tool_result") &&
          (errorMessage.includes("without") || errorMessage.includes("immediately after"))
        ) {
          headers.set("x-antigravity-context-error", "tool_pairing")
        }

        return new Response(JSON.stringify(errorBody), {
          status: response.status,
          statusText: response.statusText,
          headers,
        })
      }

      if (errorBody?.error?.details && Array.isArray(errorBody.error.details)) {
        const retryInfo = errorBody.error.details.find(
          (detail: any) => detail["@type"] === "type.googleapis.com/google.rpc.RetryInfo",
        )

        if (retryInfo?.retryDelay) {
          const match = retryInfo.retryDelay.match(/^([\d.]+)s$/)
          if (match && match[1]) {
            const retrySeconds = parseFloat(match[1])
            if (!isNaN(retrySeconds) && retrySeconds > 0) {
              const retryAfterSec = Math.ceil(retrySeconds).toString()
              const retryAfterMs = Math.ceil(retrySeconds * 1000).toString()
              headers.set("Retry-After", retryAfterSec)
              headers.set("retry-after-ms", retryAfterMs)
            }
          }
        }
      }
    }

    const init = {
      status: response.status,
      statusText: response.statusText,
      headers,
    }

    const usageFromSse = streaming && isEventStreamResponse ? extractUsageFromSsePayload(text) : null
    const parsed: AntigravityApiBody | null =
      !streaming || !isEventStreamResponse ? parseAntigravityApiBody(text) : null
    const patched = parsed ? rewriteAntigravityPreviewAccessError(parsed, response.status, requestedModel) : null
    const effectiveBody = patched ?? parsed ?? undefined

    const usage = usageFromSse ?? (effectiveBody ? extractUsageMetadata(effectiveBody) : null)

    // Log cache stats when available
    if (usage && effectiveModel) {
      logCacheStats(
        effectiveModel,
        usage.cachedContentTokenCount ?? 0,
        0, // API doesn't provide cache write tokens separately
        usage.promptTokenCount ?? usage.totalTokenCount ?? 0,
      )
    }

    if (usage?.cachedContentTokenCount !== undefined) {
      headers.set("x-antigravity-cached-content-token-count", String(usage.cachedContentTokenCount))
      if (usage.totalTokenCount !== undefined) {
        headers.set("x-antigravity-total-token-count", String(usage.totalTokenCount))
      }
      if (usage.promptTokenCount !== undefined) {
        headers.set("x-antigravity-prompt-token-count", String(usage.promptTokenCount))
      }
      if (usage.candidatesTokenCount !== undefined) {
        headers.set("x-antigravity-candidates-token-count", String(usage.candidatesTokenCount))
      }
    }

    logAntigravityDebugResponse(debugContext, response, {
      body: text,
      note: streaming ? "Streaming SSE payload (buffered fallback)" : undefined,
      headersOverride: headers,
    })

    // Note: successful streaming responses are handled above via TransformStream.
    // This path only handles non-streaming responses or failed streaming responses.

    if (!parsed) {
      return new Response(text, init)
    }

    if (effectiveBody?.response !== undefined) {
      let responseBody: unknown = effectiveBody.response
      // Inject thinking text (debug logs or "[Thinking preserved]" placeholder)
      // Both debug=true and keep_thinking=true use the same path now
      if (debugText) {
        responseBody = injectDebugThinking(responseBody, debugText)
      }
      const transformed = transformThinkingParts(responseBody)
      return new Response(JSON.stringify(transformed), init)
    }

    if (patched) {
      return new Response(JSON.stringify(patched), init)
    }

    return new Response(text, init)
  } catch (error) {
    if (error instanceof Error && error.message === "THINKING_RECOVERY_NEEDED") {
      throw error
    }

    logAntigravityDebugResponse(debugContext, response, {
      error,
      note: "Failed to transform Antigravity response",
    })
    return responseFallback
  }
}
