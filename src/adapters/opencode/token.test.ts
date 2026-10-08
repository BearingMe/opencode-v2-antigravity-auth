import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { ANTIGRAVITY_PROVIDER_ID } from "./constants.js"
import { clearCachedAuth, resolveCachedAuth, storeCachedAuth } from "../../modules/accounts/index.js"
import { ensureProjectContext, invalidateProjectContextCache } from "./project.js"
import { AntigravityTokenRefreshError, refreshAccessToken } from "./token"
import type { AccountOAuthCredential } from "../../modules/accounts/index.js"
import type { PluginClient } from "./types.js"

const baseAuth: AccountOAuthCredential = {
  type: "oauth",
  refresh: "refresh-token|project-123",
  access: "old-access",
  expires: Date.now() - 1000,
}

/** Creates the minimal host auth client required by token refresh tests. */
function createClient() {
  return {
    auth: {
      set: vi.fn(async () => {}),
    },
  } as PluginClient & {
    auth: { set: ReturnType<typeof vi.fn> }
  }
}

describe("refreshAccessToken", () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
    clearCachedAuth()
    invalidateProjectContextCache()
  })

  it("updates the caller when refresh token is unchanged", async () => {
    const client = createClient()
    const fetchMock = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          access_token: "new-access",
          expires_in: 3600,
        }),
        { status: 200 },
      )
    })
    vi.stubGlobal("fetch", fetchMock)

    const result = await refreshAccessToken(baseAuth, client, ANTIGRAVITY_PROVIDER_ID)

    expect(result?.access).toBe("new-access")
    expect(client.auth.set.mock.calls.length).toBe(0)
  })

  it("handles Google refresh token rotation", async () => {
    const client = createClient()
    const fetchMock = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          access_token: "next-access",
          expires_in: 3600,
          refresh_token: "rotated-token",
        }),
        { status: 200 },
      )
    })
    vi.stubGlobal("fetch", fetchMock)

    const result = await refreshAccessToken(baseAuth, client, ANTIGRAVITY_PROVIDER_ID)

    expect(result?.access).toBe("next-access")
    expect(result?.refresh).toContain("rotated-token")
    expect(client.auth.set.mock.calls.length).toBe(0)
  })

  it("throws a typed error on invalid_grant", async () => {
    const client = createClient()
    const fetchMock = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          error: "invalid_grant",
          error_description: "Refresh token revoked",
        }),
        { status: 400, statusText: "Bad Request" },
      )
    })
    vi.stubGlobal("fetch", fetchMock)

    await expect(refreshAccessToken(baseAuth, client, ANTIGRAVITY_PROVIDER_ID)).rejects.toMatchObject({
      name: "AntigravityTokenRefreshError",
      code: "invalid_grant",
    })
  })

  it("evicts cached auth and project context on invalid_grant", async () => {
    const auth = { ...baseAuth, refresh: "synthetic-refresh|project-hint" }
    let projectChecks = 0
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        if (String(input) === "https://oauth2.googleapis.com/token") {
          return Response.json({ error: "invalid_grant" }, { status: 400, statusText: "Bad Request" })
        }
        projectChecks += 1
        return Response.json({ cloudaicompanionProject: `managed-${projectChecks}` })
      }),
    )
    const cachedAuth = { ...auth, access: "cached-access", expires: Date.now() + 60_000 }
    storeCachedAuth(cachedAuth)
    await ensureProjectContext({ ...auth, access: "project-access" })

    await expect(refreshAccessToken(auth, createClient(), ANTIGRAVITY_PROVIDER_ID)).rejects.toBeInstanceOf(
      AntigravityTokenRefreshError,
    )

    const staleAuth = { ...auth, access: undefined, expires: 0 }
    expect(resolveCachedAuth(staleAuth).access).toBeUndefined()
    expect((await ensureProjectContext({ ...auth, access: "project-access" })).auth.refresh).toContain("managed-2")
    expect(projectChecks).toBe(2)
  })
})
