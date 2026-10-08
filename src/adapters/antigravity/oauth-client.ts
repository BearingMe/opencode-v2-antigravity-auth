import { generatePKCE } from "@openauthjs/openauth/pkce"

import {
  ANTIGRAVITY_AUTH_USER_AGENT,
  ANTIGRAVITY_CLIENT_ID,
  ANTIGRAVITY_CLIENT_SECRET,
  ANTIGRAVITY_REDIRECT_URI,
  ANTIGRAVITY_SCOPES,
} from "./constants.js"

interface PkcePair {
  challenge: string
  verifier: string
}

/** Authorization-code response fields used by the account OAuth flow. */
export interface AuthorizationCodeTokens {
  accessToken: string
  expiresIn: unknown
  refreshToken: string
  email?: string
}

/** Builds the provider authorization URL with a fresh PKCE challenge. */
export async function createOAuthAuthorization(projectId: string): Promise<{
  url: string
  verifier: string
}> {
  const pkce = (await generatePKCE()) as PkcePair
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth")
  url.searchParams.set("client_id", ANTIGRAVITY_CLIENT_ID)
  url.searchParams.set("response_type", "code")
  url.searchParams.set("redirect_uri", ANTIGRAVITY_REDIRECT_URI)
  url.searchParams.set("scope", ANTIGRAVITY_SCOPES.join(" "))
  url.searchParams.set("code_challenge", pkce.challenge)
  url.searchParams.set("code_challenge_method", "S256")
  url.searchParams.set("state", encodeOAuthState({ verifier: pkce.verifier, projectId }))
  url.searchParams.set("access_type", "offline")
  url.searchParams.set("prompt", "consent")
  return { url: url.toString(), verifier: pkce.verifier }
}

/** Encodes OAuth state without exposing the verifier in the authorization URL. */
function encodeOAuthState(state: { verifier: string; projectId: string }): string {
  return Buffer.from(JSON.stringify(state), "utf8").toString("base64url")
}

/** Exchanges an authorization code, then reads the associated Google email. */
export async function exchangeOAuthAuthorizationCode(
  code: string,
  verifier: string,
): Promise<AuthorizationCodeTokens | { error: string }> {
  const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
      Accept: "*/*",
      "Accept-Encoding": "gzip, deflate, br",
      "User-Agent": ANTIGRAVITY_AUTH_USER_AGENT,
    },
    body: new URLSearchParams({
      client_id: ANTIGRAVITY_CLIENT_ID,
      client_secret: ANTIGRAVITY_CLIENT_SECRET,
      code,
      grant_type: "authorization_code",
      redirect_uri: ANTIGRAVITY_REDIRECT_URI,
      code_verifier: verifier,
    }),
  })

  if (!tokenResponse.ok) return { error: await tokenResponse.text() }

  const tokenPayload: unknown = await tokenResponse.json()
  if (
    typeof tokenPayload !== "object" ||
    tokenPayload === null ||
    typeof (tokenPayload as Record<string, unknown>).access_token !== "string"
  ) {
    return { error: "Invalid token response" }
  }
  const tokenRecord = tokenPayload as Record<string, unknown>
  const accessToken = tokenRecord.access_token
  if (typeof accessToken !== "string") return { error: "Invalid token response" }

  let email: string | undefined
  try {
    const userInfoResponse = await fetch("https://www.googleapis.com/oauth2/v1/userinfo?alt=json", {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "User-Agent": ANTIGRAVITY_AUTH_USER_AGENT,
      },
    })
    if (userInfoResponse.ok) {
      const userInfo: unknown = await userInfoResponse.json()
      if (
        typeof userInfo === "object" &&
        userInfo !== null &&
        typeof (userInfo as Record<string, unknown>).email === "string"
      ) {
        email = (userInfo as Record<string, unknown>).email as string
      }
    }
  } catch {
    email = undefined
  }

  if (typeof tokenRecord.refresh_token !== "string" || !tokenRecord.refresh_token) {
    return { error: "Missing refresh token in response" }
  }
  return {
    accessToken,
    expiresIn: tokenRecord.expires_in,
    refreshToken: tokenRecord.refresh_token,
    email,
  }
}
