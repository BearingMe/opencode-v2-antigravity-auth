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
  classifyModel(model: string): InferenceModelClassification
  prepareRequest(input: PrepareInferenceRequest<Fingerprint>): PreparedInferenceRequest
  transformResponse(input: TransformInferenceResponse<DebugContext>): Promise<Response>
}

export type {
  InferencePorts,
  InferenceRecoveryPort,
  InferenceRequestPolicyPort,
  InferenceSignatureCachePort,
} from "./ports.js"
