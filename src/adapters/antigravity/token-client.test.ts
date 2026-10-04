import { afterEach, describe, expect, it, vi } from "vitest"
import { refreshOAuthToken } from "./token-client.js"

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("refreshOAuthToken", () => {
  it("sends a refresh-token grant and returns provider fields as account data", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      expect(init?.method).toBe("POST")
      expect(new Headers(init?.headers).get("content-type")).toBe("application/x-www-form-urlencoded")
      const body = new URLSearchParams(String(init?.body))
      expect(body.get("grant_type")).toBe("refresh_token")
      expect(body.get("refresh_token")).toBe("synthetic-refresh")
      return Response.json({ access_token: "synthetic-access", expires_in: 3600, refresh_token: "rotated" })
    })
    vi.stubGlobal("fetch", fetchMock)

    await expect(refreshOAuthToken("synthetic-refresh")).resolves.toEqual({
      accessToken: "synthetic-access",
      expiresIn: 3600,
      refreshToken: "rotated",
    })
    expect(fetchMock).toHaveBeenCalledOnce()
  })

  it("normalizes object-shaped endpoint errors while retaining status metadata", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json(
          { error: { status: "invalid_grant", message: "Token revoked" } },
          { status: 400, statusText: "Bad Request" },
        ),
      ),
    )

    await expect(refreshOAuthToken("synthetic-refresh")).rejects.toMatchObject({
      name: "OAuthTokenEndpointError",
      code: "invalid_grant",
      description: "Token revoked",
      status: 400,
      statusText: "Bad Request",
    })
  })

  it("rejects a malformed successful token response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ expires_in: 3600 })),
    )

    await expect(refreshOAuthToken("synthetic-refresh")).rejects.toThrow("Invalid token response")
  })
})
