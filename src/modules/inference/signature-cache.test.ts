import { afterEach, describe, expect, it, vi } from "vitest"
import {
  cacheSignature,
  clearSignatureCache,
  configureSignaturePersistence,
  configureSignatureTextHash,
  getCachedSignature,
} from "./signature-cache.js"
import type { InferenceSignaturePersistencePort } from "./ports.js"

/** Builds a simple persistence port for checking memory/disk cache handoff. */
function createPersistence(entries = new Map<string, string>()) {
  const get = vi.fn((sessionId: string, text: string) => entries.get(`${sessionId}:${text}`))
  const set = vi.fn((sessionId: string, text: string, signature: string) => {
    entries.set(`${sessionId}:${text}`, signature)
  })
  const port: InferenceSignaturePersistencePort = { get, set }
  return { entries, get, set, port }
}

describe("thinking signature cache", () => {
  afterEach(() => {
    vi.useRealTimers()
    clearSignatureCache()
    configureSignaturePersistence(undefined)
    configureSignatureTextHash((text) => text)
  })

  it("keeps signatures isolated by session and thinking text", () => {
    cacheSignature("session-a", "first thought", "sig-a")
    cacheSignature("session-b", "first thought", "sig-b")
    cacheSignature("session-a", "second thought", "sig-c")

    expect(getCachedSignature("session-a", "first thought")).toBe("sig-a")
    expect(getCachedSignature("session-b", "first thought")).toBe("sig-b")
    expect(getCachedSignature("session-a", "second thought")).toBe("sig-c")
    expect(getCachedSignature("session-b", "second thought")).toBeUndefined()
  })

  it("persists writes and promotes disk hits into memory", () => {
    const persistence = createPersistence()
    configureSignaturePersistence(persistence.port)

    cacheSignature("session", "thought", "signature")
    expect(persistence.set).toHaveBeenCalledOnce()

    clearSignatureCache("session")
    expect(getCachedSignature("session", "thought")).toBe("signature")
    expect(persistence.get).toHaveBeenCalledOnce()

    persistence.entries.clear()
    expect(getCachedSignature("session", "thought")).toBe("signature")
  })

  it("expires memory entries after the one-hour lifetime", () => {
    vi.useFakeTimers()
    vi.setSystemTime(0)
    cacheSignature("session", "thought", "signature")

    vi.setSystemTime(60 * 60 * 1000 + 1)

    expect(getCachedSignature("session", "thought")).toBeUndefined()
  })

  it("evicts the oldest quarter after reaching the per-session capacity", () => {
    vi.useFakeTimers()
    vi.setSystemTime(0)

    for (let index = 0; index < 100; index++) {
      vi.setSystemTime(index * 1000)
      cacheSignature("session", `thought-${index}`, `signature-${index}`)
    }

    vi.setSystemTime(100_000)
    cacheSignature("session", "new thought", "new signature")

    expect(getCachedSignature("session", "thought-0")).toBeUndefined()
    expect(getCachedSignature("session", "thought-30")).toBe("signature-30")
    expect(getCachedSignature("session", "new thought")).toBe("new signature")
  })
})
