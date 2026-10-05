import type { InferenceSignaturePersistencePort } from "./ports.js"

interface SignatureEntry {
  signature: string
  timestamp: number
}

const SIGNATURE_CACHE_TTL_MS = 60 * 60 * 1000
const MAX_ENTRIES_PER_SESSION = 100

const signatureCache = new Map<string, Map<string, SignatureEntry>>()
let persistence: InferenceSignaturePersistencePort | undefined
/** Produces the bounded cache key used for each thinking text. */
let hashSignatureText = (text: string): string => text

/** Configures the stable text-key function supplied by the runtime adapter. */
export function configureSignatureTextHash(hashText: (text: string) => string): void {
  hashSignatureText = hashText
}

/** Connects the optional filesystem persistence tier to the inference cache. */
export function configureSignaturePersistence(port?: InferenceSignaturePersistencePort): void {
  persistence = port
}

/** Caches a thinking signature for a conversation and its exact thinking text. */
export function cacheSignature(sessionId: string, text: string, signature: string): void {
  if (!sessionId || !text || !signature) return
  const textKey = hashSignatureText(text)

  let sessionEntries = signatureCache.get(sessionId)
  if (!sessionEntries) {
    sessionEntries = new Map()
    signatureCache.set(sessionId, sessionEntries)
  }

  if (sessionEntries.size >= MAX_ENTRIES_PER_SESSION) {
    const now = Date.now()
    for (const [cachedTextKey, entry] of sessionEntries) {
      if (now - entry.timestamp > SIGNATURE_CACHE_TTL_MS) sessionEntries.delete(cachedTextKey)
    }

    if (sessionEntries.size >= MAX_ENTRIES_PER_SESSION) {
      const oldestEntries = [...sessionEntries.entries()]
        .sort((left, right) => left[1].timestamp - right[1].timestamp)
        .slice(0, Math.floor(MAX_ENTRIES_PER_SESSION / 4))
      for (const [cachedTextKey] of oldestEntries) sessionEntries.delete(cachedTextKey)
    }
  }

  sessionEntries.set(textKey, { signature, timestamp: Date.now() })
  persistence?.set(sessionId, text, signature)
}

/** Returns a live cached signature, loading and promoting it from persistence on a miss. */
export function getCachedSignature(sessionId: string, text: string): string | undefined {
  if (!sessionId || !text) return undefined
  const textKey = hashSignatureText(text)

  const sessionEntries = signatureCache.get(sessionId)
  const entry = sessionEntries?.get(textKey)
  if (entry) {
    if (Date.now() - entry.timestamp <= SIGNATURE_CACHE_TTL_MS) return entry.signature
    sessionEntries?.delete(textKey)
  }

  const storedSignature = persistence?.get(sessionId, text)
  if (!storedSignature) return undefined

  cacheMemoryEntry(sessionId, textKey, storedSignature)
  return storedSignature
}

/** Clears the in-memory cache for one conversation or all conversations. */
export function clearSignatureCache(sessionId?: string): void {
  if (sessionId) signatureCache.delete(sessionId)
  else signatureCache.clear()
}

/** Promotes a persistent result into memory without writing it back to persistence. */
function cacheMemoryEntry(sessionId: string, textKey: string, signature: string): void {
  let sessionEntries = signatureCache.get(sessionId)
  if (!sessionEntries) {
    sessionEntries = new Map()
    signatureCache.set(sessionId, sessionEntries)
  }

  if (sessionEntries.size >= MAX_ENTRIES_PER_SESSION) {
    const oldestEntries = [...sessionEntries.entries()]
      .sort((left, right) => left[1].timestamp - right[1].timestamp)
      .slice(0, Math.floor(MAX_ENTRIES_PER_SESSION / 4))
    for (const [cachedTextKey] of oldestEntries) sessionEntries.delete(cachedTextKey)
  }

  sessionEntries.set(textKey, { signature, timestamp: Date.now() })
}
