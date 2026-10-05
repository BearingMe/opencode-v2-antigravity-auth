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
