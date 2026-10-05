/** Transport boundary for inference requests and signature warmups. */
export interface AntigravityInferenceClient {
  /** Sends prepared request without consuming, retrying, or reclassifying it. */
  send(input: RequestInfo | URL, init?: RequestInit): Promise<Response>
}

/** Creates the Antigravity inference transport around the runtime fetch implementation. */
export function createAntigravityInferenceClient(fetchImpl: typeof fetch = fetch): AntigravityInferenceClient {
  return {
    send(input, init) {
      return fetchImpl(input, init)
    },
  }
}
