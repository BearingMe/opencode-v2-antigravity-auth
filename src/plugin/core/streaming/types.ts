export type { SignatureStore, SignedThinking } from "../../../modules/inference/index.js"

export interface StreamingCallbacks {
  onCacheSignature?: (sessionKey: string, text: string, signature: string) => void
  onInjectDebug?: (response: unknown, debugText: string) => unknown
  // Note: onInjectSyntheticThinking removed - keep_thinking now unified with debug via debugText
  transformThinkingParts?: (parts: unknown) => unknown
}

export interface StreamingOptions {
  signatureSessionKey?: string
  debugText?: string
  cacheSignatures?: boolean
  displayedThinkingHashes?: Set<string>
  // Note: injectSyntheticThinking removed - keep_thinking now unified with debug via debugText
}

export interface ThoughtBuffer {
  get(index: number): string | undefined
  set(index: number, text: string): void
  clear(): void
}
