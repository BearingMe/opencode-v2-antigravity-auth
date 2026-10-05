/** Thinking text and its provider-issued signature retained for tool continuations. */
export interface SignedThinking {
  text: string
  signature: string
}

/** In-memory access to the latest signed thinking block for a request scope. */
export interface SignatureStore {
  get(sessionKey: string): SignedThinking | undefined
  set(sessionKey: string, value: SignedThinking): void
  has(sessionKey: string): boolean
  delete(sessionKey: string): void
}

/** Creates an isolated map-backed store for signed thinking values. */
export function createSignatureStore(): SignatureStore {
  const store = new Map<string, SignedThinking>()

  return {
    get: (key) => store.get(key),
    set: (key, value) => store.set(key, value),
    has: (key) => store.has(key),
    delete: (key) => {
      store.delete(key)
    },
  }
}

/** Shared signature store used by request preparation and streaming callbacks. */
export const defaultSignatureStore = createSignatureStore()
