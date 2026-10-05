import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { resolveCachedAuth, storeCachedAuth, clearCachedAuth } from "./cache"
import type { OAuthAuthDetails } from "./types"

/** Builds a synthetic auth snapshot for cache policy tests. */
function createAuth(overrides: Partial<OAuthAuthDetails> = {}): OAuthAuthDetails {
  return {
    type: "oauth",
    refresh: "refresh-token|project-id",
    access: "access-token",
    expires: Date.now() + 3600000,
    ...overrides,
  }
}

describe("Auth Snapshot Cache", () => {
  beforeEach(() => {
    vi.useRealTimers()
    clearCachedAuth()
  })

  afterEach(() => {
    vi.useRealTimers()
    clearCachedAuth()
  })

  describe("auth cache", () => {
    describe("resolveCachedAuth", () => {
      it("returns input auth when no cache exists and caches it", () => {
        const auth = createAuth()
        const result = resolveCachedAuth(auth)
        expect(result).toEqual(auth)
      })

      it("returns input auth when refresh key is empty", () => {
        const auth = createAuth({ refresh: "" })
        const result = resolveCachedAuth(auth)
        expect(result).toEqual(auth)
      })

      it("returns input auth when it has valid (unexpired) access token", () => {
        const oldAuth = createAuth({ access: "old-access", expires: Date.now() + 3600000 })
        resolveCachedAuth(oldAuth) // cache it

        const newAuth = createAuth({ access: "new-access", expires: Date.now() + 7200000 })
        const result = resolveCachedAuth(newAuth)
        expect(result.access).toBe("new-access")
      })

      it("returns cached auth when input auth is expired but cached is valid", () => {
        vi.useFakeTimers()
        vi.setSystemTime(new Date(0))

        const validAuth = createAuth({
          access: "valid-access",
          expires: 3600000, // expires at t=3600000
        })
        resolveCachedAuth(validAuth) // cache it

        // Now create an expired auth with the same refresh token
        const expiredAuth = createAuth({
          access: "expired-access",
          expires: 30000, // expires within buffer (60s)
        })

        const result = resolveCachedAuth(expiredAuth)
        expect(result.access).toBe("valid-access")
      })

      it("returns input auth when both are expired (updates cache)", () => {
        vi.useFakeTimers()
        vi.setSystemTime(new Date(0))

        const expiredCached = createAuth({
          access: "cached-expired",
          expires: 30000, // expired within buffer
        })
        resolveCachedAuth(expiredCached)

        const expiredNew = createAuth({
          access: "new-expired",
          expires: 20000, // also expired within buffer
        })

        const result = resolveCachedAuth(expiredNew)
        expect(result.access).toBe("new-expired")
      })
    })

    describe("storeCachedAuth", () => {
      it("stores auth in cache", () => {
        const auth = createAuth({ access: "stored-access" })
        storeCachedAuth(auth)

        const expiredAuth = createAuth({ access: "expired", expires: Date.now() - 1000 })
        const result = resolveCachedAuth(expiredAuth)
        expect(result.access).toBe("stored-access")
      })

      it("does nothing when refresh key is empty", () => {
        const auth = createAuth({ refresh: "", access: "no-key-access" })
        storeCachedAuth(auth)

        // Should not be retrievable since key was empty
        const testAuth = createAuth({ refresh: "", access: "test" })
        const result = resolveCachedAuth(testAuth)
        expect(result.access).toBe("test") // returns the input, not cached
      })

      it("does nothing when refresh key is whitespace only", () => {
        const auth = createAuth({ refresh: "   ", access: "whitespace-access" })
        storeCachedAuth(auth)

        const testAuth = createAuth({ refresh: "   ", access: "test" })
        const result = resolveCachedAuth(testAuth)
        expect(result.access).toBe("test")
      })
    })

    describe("clearCachedAuth", () => {
      it("clears all cache when no argument provided", () => {
        storeCachedAuth(createAuth({ refresh: "token1|p", access: "access1" }))
        storeCachedAuth(createAuth({ refresh: "token2|p", access: "access2" }))

        clearCachedAuth()

        const auth1 = createAuth({ refresh: "token1|p", access: "new1" })
        const auth2 = createAuth({ refresh: "token2|p", access: "new2" })

        expect(resolveCachedAuth(auth1).access).toBe("new1")
        expect(resolveCachedAuth(auth2).access).toBe("new2")
      })

      it("clears specific refresh token from cache", () => {
        storeCachedAuth(createAuth({ refresh: "token1|p", access: "access1" }))
        storeCachedAuth(createAuth({ refresh: "token2|p", access: "access2" }))

        clearCachedAuth("token1|p")

        // token1 should be cleared
        const expiredAuth1 = createAuth({ refresh: "token1|p", access: "new1", expires: Date.now() - 1000 })
        expect(resolveCachedAuth(expiredAuth1).access).toBe("new1")

        // token2 should still be cached
        const expiredAuth2 = createAuth({ refresh: "token2|p", access: "new2", expires: Date.now() - 1000 })
        expect(resolveCachedAuth(expiredAuth2).access).toBe("access2")
      })
    })
  })
})
