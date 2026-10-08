import type { RecoveryErrorType } from "../session-recovery/index.js"

/** Signature-cache operations used by request transformation. */
export interface InferenceSignatureCachePort {
  cacheSignature(sessionId: string, text: string, signature: string): void
  getCachedSignature(sessionId: string, text: string): string | undefined
}

/** Optional persistence tier used by the in-memory thinking-signature policy. */
export interface InferenceSignaturePersistencePort {
  get(sessionId: string, text: string): string | undefined
  set(sessionId: string, text: string, signature: string): void
}

/** Runtime policy values required by inference without a host configuration type. */
export interface InferenceRequestPolicyPort {
  keepThinking(): boolean
  debugEnabled(): boolean
  debugTuiEnabled(): boolean
}

/** Logging and runtime hooks required by the request/response pipeline. */
export interface InferencePipelineRuntimePort<Fingerprint, DebugContext> {
  endpoint: string
  debugMessagePrefix: string
  createRequestId(): string
  hashConversationSeed(seed: string): string
  getUserAgent(fingerprint?: Fingerprint): string
  keepThinking(): boolean
  debugTuiEnabled(): boolean
  imageAspectRatio(): string | undefined
  processImageData(input: { mimeType?: string; data?: string }): string | null | undefined
  debug(message: string, fields?: Record<string, unknown>): void
  warn(message: string, fields?: Record<string, unknown>): void
  logResponse(
    context: DebugContext | null | undefined,
    response: Response,
    meta?: { body?: string; note?: string; error?: unknown; headersOverride?: HeadersInit },
  ): void
  logCacheStats(model: string, cacheReadTokens: number, cacheWriteTokens: number, totalInputTokens: number): void
}

/** Recovery-error classification needed while repairing outgoing requests. */
export interface InferenceRecoveryPort {
  detectErrorType(error: unknown): RecoveryErrorType | null
}

/** External collaborators required by the inference pipeline. */
export interface InferencePorts {
  signatures: InferenceSignatureCachePort
  policy: InferenceRequestPolicyPort
  recovery: InferenceRecoveryPort
}
