import type { AccountAccessVerificationPort } from "../../modules/accounts/index.js"

/** HTTP result consumed by account verification policy. */
export interface VerificationProbeResponse {
  ok: boolean
  status: number
  statusText: string
  body: string
}

/** Prepared request passed to Antigravity's access-verification endpoint. */
export interface VerificationProbeInput {
  request: RequestInfo
  init: RequestInit
}

/** Builds the minimal Gemini request used only for account verification. */
export function createVerificationProbeRequest(signal: AbortSignal): VerificationProbeInput {
  return {
    request: "https://generativelanguage.googleapis.com/v1beta/models/antigravity-gemini-3.1-pro:generateContent",
    init: {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: "Reply OK" }] }],
        generationConfig: { maxOutputTokens: 16, temperature: 0 },
      }),
      signal,
    },
  }
}

/** Sends the prepared verification probe and reads the provider response body. */
export async function sendVerificationProbe(
  request: RequestInfo,
  init: RequestInit,
  timeoutMs = 20_000,
): Promise<VerificationProbeResponse> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  const abort = () => controller.abort(init.signal?.reason)
  init.signal?.addEventListener("abort", abort, { once: true })
  if (init.signal?.aborted) abort()
  try {
    const response = await fetch(request, { ...init, signal: controller.signal })
    let body = ""
    try {
      body = await response.text()
    } catch (error) {
      if (controller.signal.aborted) {
        throw error instanceof Error && error.name === "AbortError"
          ? error
          : new DOMException("Verification probe was aborted", "AbortError")
      }
      body = ""
    }
    return { ok: response.ok, status: response.status, statusText: response.statusText, body }
  } finally {
    clearTimeout(timeout)
    init.signal?.removeEventListener("abort", abort)
  }
}

/** Account access-verification port backed by the Antigravity probe transport. */
export const antigravityAccessVerificationPort: AccountAccessVerificationPort<
  VerificationProbeInput,
  VerificationProbeResponse
> = {
  verify: ({ request, init }) => sendVerificationProbe(request, init),
}
