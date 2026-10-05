/** Model family used by the account and request policies. */
export type InferenceModelFamily = "claude" | "gemini"

/** Quota group classification passed to account selection as data. */
export type InferenceQuotaGroup = "claude" | "gemini-pro" | "gemini-flash"

/** Model classification produced by inference for downstream account policy. */
export interface InferenceModelClassification {
  model: string
  family: InferenceModelFamily
  quotaGroup: InferenceQuotaGroup
}

/** Search options accepted by the Gemini request transform. */
export interface InferenceSearchOptions {
  mode?: "auto" | "off"
  threshold?: number
}

/** Device fingerprint fields used to construct Antigravity request headers. */
export interface InferenceFingerprint {
  deviceId: string
  sessionToken: string
  userAgent: string
  apiClient: string
  clientMetadata: { ideType: string; platform: string; pluginType: string }
  createdAt: number
  quotaUser?: string
}

/** Optional request transformation controls. */
export interface InferenceRequestOptions<Fingerprint = InferenceFingerprint> {
  claudeToolHardening?: boolean
  claudePromptAutoCaching?: boolean
  googleSearch?: InferenceSearchOptions
  fingerprint?: Fingerprint
}

/** Inputs to the Antigravity request transformation. */
export interface PrepareInferenceRequest<Fingerprint = InferenceFingerprint> {
  input: RequestInfo
  init?: RequestInit
  accessToken: string
  projectId: string
  endpointOverride?: string
  forceThinkingRecovery?: boolean
  options?: InferenceRequestOptions<Fingerprint>
}

/** Prepared request and metadata needed by the native execution loop. */
export interface PreparedInferenceRequest {
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
}

/** Inputs to response normalization; debug context remains opaque to the API. */
export interface TransformInferenceResponse<DebugContext = unknown> {
  response: Response
  streaming: boolean
  debugContext?: DebugContext | null
  requestedModel?: string
  projectId?: string
  endpoint?: string
  effectiveModel?: string
  sessionId?: string
  toolDebugMissing?: number
  toolDebugSummary?: string
  toolDebugPayload?: string
  debugLines?: string[]
}

/** Public operations currently required by the native request execution loop. */
export interface InferenceApi<Fingerprint = InferenceFingerprint, DebugContext = unknown> {
  /** Classifies a public model ID for downstream account selection. */
  classifyModel(model: string): InferenceModelClassification
  /** Rejects a model ID that is not supported by this inference provider. */
  assertModelSupported(model: string): void
  /** Creates the request body used to acquire a signed Claude thinking block. */
  buildThinkingWarmupBody(bodyText: string | undefined, isClaudeThinking: boolean): string | null
  /** Prepares the provider request after account and project context are known. */
  prepareRequest(input: PrepareInferenceRequest<Fingerprint>): PreparedInferenceRequest
  /** Normalizes a provider response, preserving incremental SSE behavior. */
  transformResponse(input: TransformInferenceResponse<DebugContext>): Promise<Response>
}

export type {
  InferencePorts,
  InferenceRecoveryPort,
  InferencePipelineRuntimePort,
  InferenceRequestPolicyPort,
  InferenceSignatureCachePort,
  InferenceSignaturePersistencePort,
} from "./ports.js"

export {
  ANTIGRAVITY_SYSTEM_INSTRUCTION,
  CLAUDE_DESCRIPTION_PROMPT,
  CLAUDE_TOOL_SYSTEM_INSTRUCTION,
  EMPTY_SCHEMA_PLACEHOLDER_DESCRIPTION,
  EMPTY_SCHEMA_PLACEHOLDER_NAME,
  MIN_SIGNATURE_LENGTH,
  SKIP_THOUGHT_SIGNATURE,
} from "./constants.js"
export * from "./transforms/index.js"
export { cleanJSONSchemaForAntigravity } from "./schema-cleaner.js"
export {
  cacheSignature,
  clearSignatureCache,
  configureSignaturePersistence,
  configureSignatureTextHash,
  getCachedSignature,
} from "./signature-cache.js"
export {
  buildSignatureSessionKey,
  extractConversationSeedFromContents,
  extractConversationSeedFromMessages,
  extractTextFromContent,
  resolveConversationKey,
  resolveConversationKeyFromRequests,
  resolveProjectKey,
  shouldCacheThinkingSignatures,
} from "./signature-context.js"
export { createSignatureStore, defaultSignatureStore } from "./signature-store.js"
export type { SignatureStore, SignedThinking } from "./signature-store.js"
export {
  ensureThoughtSignature,
  ensureThinkingBeforeToolUseInContents,
  ensureThinkingBeforeToolUseInMessages,
  hasSignedThinkingInContents,
  hasSignedThinkingInMessages,
  hasSignedThinkingPart,
  hasToolUseInContents,
  hasToolUseInMessages,
  isGeminiThinkingPart,
  isGeminiToolUsePart,
  sanitizeRequestPayloadForAntigravity,
} from "./signature-policy.js"
export type { SignatureRepairOptions } from "./signature-policy.js"
export type { RequestSanitizationOptions } from "./signature-policy.js"
export * from "./request-helpers.js"
export type { RequestThinkingConfig } from "./request-helpers.js"
export type { ThinkingFilterOptions } from "./thinking-filter.js"
export {
  cacheThinkingSignaturesFromResponse,
  createStreamingTransformer,
  createThoughtBuffer,
  deduplicateThinkingText,
  transformSseLine,
  transformStreamingPayload,
} from "./streaming/index.js"
export type { StreamingCallbacks, StreamingOptions, ThoughtBuffer } from "./streaming/index.js"
export { createInferencePipeline } from "./pipeline.js"
