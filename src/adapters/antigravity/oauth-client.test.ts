import { afterEach, describe, expect, it, vi } from "vitest"
import { createOAuthAuthorization, exchangeOAuthAuthorizationCode } from "./oauth-client.js"

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("Antigravity OAuth adapter", () => {
  it("builds an authorization URL with PKCE and preserves project state", async () => {
    const authorization = await createOAuthAuthorization("synthetic-project")
    const url = new URL(authorization.url)

    expect(url.origin + url.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth")
    expect(url.searchParams.get("code_challenge_method")).toBe("S256")
    expect(url.searchParams.get("code_challenge")).toBeTruthy()
    expect(url.searchParams.get("access_type")).toBe("offline")
    expect(JSON.parse(Buffer.from(url.searchParams.get("state")!, "base64url").toString("utf8"))).toEqual({
      verifier: authorization.verifier,
      projectId: "synthetic-project",
    })
  })

  it("exchanges authorization code and reads the user email", async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = []
    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      requests.push({ url, init })
      if (url === "https://oauth2.googleapis.com/token") {
        const body = new URLSearchParams(String(init?.body))
        expect(body.get("code")).toBe("synthetic-code")
        expect(body.get("code_verifier")).toBe("synthetic-verifier")
        return Response.json({ access_token: "synthetic-access", expires_in: 900, refresh_token: "synthetic-refresh" })
      }
      return Response.json({ email: "synthetic@example.com" })
    })

    await expect(exchangeOAuthAuthorizationCode("synthetic-code", "synthetic-verifier")).resolves.toEqual({
      accessToken: "synthetic-access",
      expiresIn: 900,
      refreshToken: "synthetic-refresh",
      email: "synthetic@example.com",
    })
    expect(requests.map(({ url }) => url)).toEqual([
      "https://oauth2.googleapis.com/token",
      "https://www.googleapis.com/oauth2/v1/userinfo?alt=json",
    ])
  })

  it("returns the token endpoint's failure body without calling userinfo", async () => {
    const fetchMock = vi.fn(async () => new Response("invalid code", { status: 400 }))
    vi.stubGlobal("fetch", fetchMock)

    await expect(exchangeOAuthAuthorizationCode("bad-code", "verifier")).resolves.toEqual({ error: "invalid code" })
    expect(fetchMock).toHaveBeenCalledOnce()
  })

  it("rejects malformed token payloads and tolerates unavailable userinfo", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ expires_in: 900, refresh_token: "synthetic-refresh" }))
      .mockResolvedValueOnce(
        Response.json({ access_token: "synthetic-access", expires_in: 900, refresh_token: "synthetic-refresh" }),
      )
      .mockRejectedValueOnce(new Error("userinfo unavailable"))
    vi.stubGlobal("fetch", fetchMock)

    await expect(exchangeOAuthAuthorizationCode("bad-payload", "verifier")).resolves.toEqual({
      error: "Invalid token response",
    })
    await expect(exchangeOAuthAuthorizationCode("valid-token", "verifier")).resolves.toEqual({
      accessToken: "synthetic-access",
      expiresIn: 900,
      refreshToken: "synthetic-refresh",
      email: undefined,
    })
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })
})
