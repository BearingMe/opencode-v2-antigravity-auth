import { formatRefreshParts, parseRefreshParts } from "./auth.js"
import { ensureProjectContext } from "./project.js"
import { prepareAntigravityRequest } from "./request.js"
import { AntigravityTokenRefreshError, refreshAccessToken } from "./token.js"
import { extractVerificationErrorDetails } from "./verification.js"
import type { PluginClient } from "./types.js"

export type VerificationProbeResult = {
  status: "ok" | "blocked" | "error"
  message: string
  verifyUrl?: string
}

export async function verifyAccountAccess(
  account: {
    refreshToken: string
    email?: string
    projectId?: string
    managedProjectId?: string
  },
  client: PluginClient,
  providerId: string,
): Promise<VerificationProbeResult> {
  const parsed = parseRefreshParts(account.refreshToken)
  if (!parsed.refreshToken) {
    return { status: "error", message: "Missing refresh token for selected account." }
  }

  const auth = {
    type: "oauth" as const,
    refresh: formatRefreshParts({
      refreshToken: parsed.refreshToken,
      projectId: parsed.projectId ?? account.projectId,
      managedProjectId: parsed.managedProjectId ?? account.managedProjectId,
    }),
    access: "",
    expires: 0,
  }

  let refreshedAuth: Awaited<ReturnType<typeof refreshAccessToken>>
  try {
    refreshedAuth = await refreshAccessToken(auth, client, providerId)
  } catch (error) {
    if (error instanceof AntigravityTokenRefreshError) {
      return { status: "error", message: error.message }
    }
    return { status: "error", message: `Token refresh failed: ${String(error)}` }
  }

  if (!refreshedAuth?.access) {
    return { status: "error", message: "Could not refresh access token for this account." }
  }

  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), 20000)

  let response: Response
  try {
    const project = await ensureProjectContext(refreshedAuth)
    const prepared = prepareAntigravityRequest(
      "https://generativelanguage.googleapis.com/v1beta/models/antigravity-gemini-3.1-pro:generateContent",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: "Reply OK" }] }],
          generationConfig: { maxOutputTokens: 16, temperature: 0 },
        }),
        signal: controller.signal,
      },
      refreshedAuth.access,
      project.effectiveProjectId,
    )
    response = await fetch(prepared.request, prepared.init)
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      return { status: "error", message: "Verification check timed out." }
    }
    return { status: "error", message: `Verification check failed: ${String(error)}` }
  } finally {
    clearTimeout(timeoutId)
  }

  let responseBody = ""
  try {
    responseBody = await response.text()
  } catch {
    responseBody = ""
  }

  if (response.ok) {
    return { status: "ok", message: "Account verification check passed." }
  }

  const extracted = extractVerificationErrorDetails(responseBody)
  if (response.status === 403 && extracted.validationRequired) {
    return {
      status: "blocked",
      message: extracted.message ?? "Google requires additional account verification.",
      verifyUrl: extracted.verifyUrl,
    }
  }

  const fallbackMessage = extracted.message ?? `Request failed (${response.status} ${response.statusText}).`
  return {
    status: "error",
    message: fallbackMessage,
  }
}
