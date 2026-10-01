import { describe, expect, it } from "vitest"
import plugin, { formatAuthInstructions, formatAuthSummary, getFetchDestination, isGenerativeLanguageModelPath, normalizeFetchBody, parseOAuthCallbackInput } from "./v2-plugin.js"

describe("OpenCode V2 plugin entrypoint", () => {
  it("exports a stable V2 plugin definition", () => {
    expect(plugin.id).toBe("opencode-v2-antigravity-auth")
    expect(plugin.setup).toEqual(expect.any(Function))
  })
})

describe("normalizeFetchBody", () => {
  it("decodes JSON request bytes produced by the V2 AI SDK transport", async () => {
    const json = JSON.stringify({ contents: [{ role: "user", parts: [{ text: "hello" }] }] })
    const bytes = new TextEncoder().encode(json)
    const input = new URL("https://generativelanguage.googleapis.com/v1beta/models/gemini-3-pro:generateContent")

    const normalized = await normalizeFetchBody(input, {
      method: "POST",
      headers: { "content-type": "application/json; charset=utf-8" },
      body: bytes,
    })

    expect(normalized.input).toBe(input.toString())
    expect(normalized.init?.body).toBe(json)
  })

  it("leaves non-JSON and empty request bodies unchanged", async () => {
    const bytes = new Uint8Array([1, 2, 3])
    const binary = await normalizeFetchBody("https://example.com/upload", {
      headers: { "content-type": "application/octet-stream" },
      body: bytes,
    })
    const empty = await normalizeFetchBody("https://example.com/empty", {
      headers: { "content-type": "application/json" },
    })

    expect(binary.init?.body).toBe(bytes)
    expect(empty.init?.body).toBeUndefined()
  })

  it("normalizes Request URL, method, headers, body, and signal without consuming the original", async () => {
    const json = JSON.stringify({ contents: [{ role: "user", parts: [{ text: "hello" }] }] })
    const controller = new AbortController()
    const original = new Request("https://generativelanguage.googleapis.com/v1beta/models/gemini-3-pro:generateContent", {
      method: "POST",
      headers: { "content-type": "application/json", "x-test": "request" },
      body: json,
      signal: controller.signal,
    })

    const normalized = await normalizeFetchBody(original, {
      headers: { "content-type": "application/json", "x-test-override": "init" },
    })

    expect(normalized.input).toBe(original.url)
    expect(normalized.init.method).toBe("POST")
    expect(new Headers(normalized.init.headers).get("x-test")).toBeNull()
    expect(new Headers(normalized.init.headers).get("x-test-override")).toBe("init")
    expect(normalized.init.body).toBe(json)
    expect(await original.text()).toBe(json)
    expect(normalized.init.signal?.aborted).toBe(false)
    controller.abort()
    expect(normalized.init.signal?.aborted).toBe(true)
  })

  it("decodes only the selected byte range of a typed-array view", async () => {
    const json = "{\"ok\":true}"
    const bytes = new TextEncoder().encode(`discard${json}tail`)
    const view = new Uint8Array(bytes.buffer, 7, json.length)
    const normalized = await normalizeFetchBody("https://generativelanguage.googleapis.com/v1beta/models/gemini-3-pro:generateContent", {
      headers: { "content-type": "application/json" },
      body: view,
    })
    expect(normalized.init.body).toBe(json)
  })

  it("validates OAuth destinations and supports only model-generation endpoints", () => {
    expect(isGenerativeLanguageModelPath("/v1beta/models/gemini-3-pro:generateContent")).toBe(true)
    expect(isGenerativeLanguageModelPath("/v1/models/gemini-3-pro:streamGenerateContent")).toBe(true)
    expect(isGenerativeLanguageModelPath("/upload/v1beta/files")).toBe(false)
    expect(() => getFetchDestination("not a URL")).toThrow("absolute HTTP(S) URL")
  })
})

describe("formatAuthSummary", () => {
  it("lists saved accounts before authorization without a printed fake menu", () => {
    const instructions = formatAuthSummary(
      [{ email: "one@example.com" }, { email: "two@example.com", enabled: false }],
      10,
    )
    expect(instructions).toContain("2/10")
    expect(instructions).toContain("- one@example.com")
    expect(instructions).toContain("- two@example.com (disabled)")
    expect(instructions).toContain("/antigravity")
    expect(instructions).toContain("One account per command")
    expect(instructions).toContain("Run opencode auth login again")
    expect(instructions).toContain("Ctrl+C cancels")
    expect(instructions).not.toContain("Menu:")
    expect(instructions).not.toContain("Maximum of 10")
  })

  it("marks an empty pool", () => {
    const instructions = formatAuthSummary([], 10)
    expect(instructions).toContain("0/10")
    expect(instructions).toContain("(none yet)")
  })

  it("adds the capacity message at the account limit", () => {
    const accounts = Array.from({ length: 10 }, (_, index) => ({ email: `saved-${index}@example.com` }))
    const instructions = formatAuthSummary(accounts, 10)
    expect(instructions).toContain("10/10")
    expect(instructions).toContain("Maximum of 10 Antigravity accounts reached")
  })

  it("falls back to an unnamed label for blank emails", () => {
    const instructions = formatAuthSummary([{ email: "   " }], 10)
    expect(instructions).toContain("- Unnamed account")
  })
})

describe("formatAuthInstructions", () => {
  it("only describes completing the authorization already selected", () => {
    const instructions = formatAuthInstructions([{ email: "one@example.com" }], 10)
    expect(instructions).toContain("authorization code")
    expect(instructions).not.toContain("Menu:")
    expect(instructions).not.toContain("one@example.com")
  })
})

describe("parseOAuthCallbackInput", () => {
  it("extracts the authorization code and state from the pasted redirect URL", () => {
    const expectedState = "eyJ2ZXJpZmllciI6InZlcmlmaWVyIn0"
    const redirect = `http://localhost:51121/oauth-callback?state=${expectedState}&iss=https%3A%2F%2Faccounts.google.com&code=4%2Fauth-code&scope=email`

    expect(parseOAuthCallbackInput(redirect, expectedState)).toEqual({
      code: "4/auth-code",
      state: expectedState,
    })
  })

  it("accepts the raw authorization code with the expected state", () => {
    expect(parseOAuthCallbackInput(" 4/auth-code ", "expected-state")).toEqual({
      code: "4/auth-code",
      state: "expected-state",
    })
  })

  it("rejects redirect URLs with a mismatched state", () => {
    expect(() => parseOAuthCallbackInput(
      "http://localhost:51121/oauth-callback?state=other&code=4%2Fauth-code",
      "expected-state",
    )).toThrow("OAuth state mismatch")
  })
})
