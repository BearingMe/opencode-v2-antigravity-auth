import type { SignatureStore } from "../signature-store.js"

export type { SignatureStore, SignedThinking } from "../signature-store.js"

/** Optional inference transformations and persistence handoffs used while streaming. */
export interface StreamingCallbacks {
  onCacheSignature?: (sessionKey: string, text: string, signature: string) => void
  onInjectDebug?: (response: unknown, debugText: string) => unknown
  // Note: onInjectSyntheticThinking removed - keep_thinking now unified with debug via debugText
  transformThinkingParts?: (parts: unknown) => unknown
  processImageData?: (input: { mimeType?: string; data?: string }) => string | null | undefined
}

/** Per-response state needed to deduplicate and cache streamed thinking. */
export interface StreamingOptions {
  signatureSessionKey?: string
  debugText?: string
  cacheSignatures?: boolean
  displayedThinkingHashes?: Set<string>
  // Note: injectSyntheticThinking removed - keep_thinking now unified with debug via debugText
}

/** Small indexed accumulator for partial reasoning chunks. */
export interface ThoughtBuffer {
  get(index: number): string | undefined
  set(index: number, text: string): void
  clear(): void
}
