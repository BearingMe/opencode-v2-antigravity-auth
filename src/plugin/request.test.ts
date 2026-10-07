import { describe, it, expect, vi } from "vitest"
import { SKIP_THOUGHT_SIGNATURE } from "../constants"
import {
  prepareAntigravityRequest,
  transformAntigravityResponse,
  getPluginSessionId,
  isGenerativeLanguageRequest,
} from "./request"
import {
  buildSignatureSessionKey,
  ensureThoughtSignature,
  extractConversationSeedFromContents,
  extractConversationSeedFromMessages,
  extractTextFromContent,
  hasSignedThinkingInContents,
  hasSignedThinkingInMessages,
  hasSignedThinkingPart,
  hasToolUseInContents,
  hasToolUseInMessages,
  isGeminiThinkingPart,
  isGeminiToolUsePart,
  cacheSignature,
  clearSignatureCache,
  resolveAntigravityModel,
  resolveConversationKey,
  resolveConversationKeyFromRequests,
  resolveProjectKey,
  MIN_SIGNATURE_LENGTH,
} from "../modules/inference/index.js"
import { DEFAULT_CONFIG } from "../adapters/opencode/config/index.js"
import { initializeDebug } from "./debug"
import * as config from "../adapters/opencode/config/index.js"

/**
 * Builds a message item fixture for contents or messages arrays.
 */
function createMessage(role: string, partsOrContent: unknown) {
  if (
    Array.isArray(partsOrContent) &&
    partsOrContent.length > 0 &&
    typeof partsOrContent[0] === "object" &&
    partsOrContent[0] !== null &&
    "type" in partsOrContent[0]
  ) {
    return { role, content: partsOrContent }
  }
  return { role, parts: partsOrContent }
}

/**
 * Builds a thought part fixture with optional signature.
 */
function createThoughtPart(text: string, options: { signature?: string; thoughtSignature?: string } = {}) {
  const part: Record<string, unknown> = { thought: true, text }
  if (options.signature) {
    part.signature = options.signature
  }
  if (options.thoughtSignature) {
    part.thoughtSignature = options.thoughtSignature
  }
  return part
}

/** Runs one test with the requested keep_thinking configuration. */
function withKeepThinking<T>(enabled: boolean, fn: () => T): T {
  const keepThinkingSpy = vi.spyOn(config, "getKeepThinking").mockReturnValue(enabled)
  try {
    return fn()
  } finally {
    keepThinkingSpy.mockRestore()
  }
}

describe("request.ts", () => {
  describe("getPluginSessionId", () => {
    it("returns consistent session ID across calls", () => {
      const id1 = getPluginSessionId()
      const id2 = getPluginSessionId()
      expect(id1).toBe(id2)
      expect(id1).toBeTruthy()
    })
  })

  describe("isGenerativeLanguageRequest", () => {
    it("returns true for generativelanguage.googleapis.com URLs", () => {
      expect(isGenerativeLanguageRequest("https://generativelanguage.googleapis.com/v1/models")).toBe(true)
    })

    it("returns false for other URLs", () => {
      expect(isGenerativeLanguageRequest("https://api.anthropic.com/v1/messages")).toBe(false)
      expect(isGenerativeLanguageRequest("https://generativelanguage.googleapis.com.attacker.test/v1/models")).toBe(
        false,
      )
    })

    it("recognizes Request URLs by hostname", () => {
      expect(isGenerativeLanguageRequest({} as any)).toBe(false)
      expect(isGenerativeLanguageRequest(new Request("https://example.com"))).toBe(false)
      expect(isGenerativeLanguageRequest(new Request("https://generativelanguage.googleapis.com/v1/models"))).toBe(true)
    })
  })

  describe("signature cache scope", () => {
    it("keeps model, project, and conversation scopes distinct", () => {
      const base = buildSignatureSessionKey("s1", "claude-3", "conv-a", "project-a")

      expect(buildSignatureSessionKey("s1", "claude-4", "conv-a", "project-a")).not.toBe(base)
      expect(buildSignatureSessionKey("s1", "claude-3", "conv-b", "project-a")).not.toBe(base)
      expect(buildSignatureSessionKey("s1", "claude-3", "conv-a", "project-b")).not.toBe(base)
    })
  })

  describe("conversation cache identity", () => {
    const hashSeed = (seed: string) => `hash:${seed}`

    it("prefers a supplied conversation id", () => {
      expect(resolveConversationKey({ conversationId: "  thread-7  " }, hashSeed)).toBe("thread-7")
    })

    it("derives an identity from system and first user content", () => {
      const key = resolveConversationKey(
        {
          systemInstruction: { parts: [{ text: "system" }] },
          contents: [{ role: "user", parts: [{ text: "first turn" }] }],
        },
        hashSeed,
      )

      expect(key).toBe("seed-hash:system|first turn")
    })

    it("uses the first wrapped request with a usable identity", () => {
      expect(
        resolveConversationKeyFromRequests(
          [{ contents: [{ role: "model", parts: [{ text: "no user seed" }] }] }, { conversation_id: "thread-9" }],
          hashSeed,
        ),
      ).toBe("thread-9")
    })
  })

  describe("extractTextFromContent", () => {
    it("extracts text from string content", () => {
      expect(extractTextFromContent("hello world")).toBe("hello world")
    })

    it("extracts first text from content array with text blocks", () => {
      const content = [
        { type: "text", text: "hello" },
        { type: "text", text: "world" },
      ]
      expect(extractTextFromContent(content)).toBe("hello")
    })

    it("returns empty string for non-text blocks", () => {
      const content = [{ type: "image", source: {} }]
      expect(extractTextFromContent(content)).toBe("")
    })

    it("returns first text block only (not concatenated)", () => {
      const content = [
        { type: "text", text: "before" },
        { type: "image", source: {} },
        { type: "text", text: "after" },
      ]
      expect(extractTextFromContent(content)).toBe("before")
    })

    it("returns empty string for null/undefined", () => {
      expect(extractTextFromContent(null)).toBe("")
      expect(extractTextFromContent(undefined)).toBe("")
    })
  })

  describe("extractConversationSeedFromMessages", () => {
    it("extracts seed from first user message", () => {
      const messages = [
        { role: "user", content: "first message" },
        { role: "assistant", content: "response" },
      ]
      const seed = extractConversationSeedFromMessages(messages)
      expect(seed).toContain("first message")
    })

    it("returns empty string when no user messages", () => {
      const messages = [createMessage("assistant", [{ type: "text", text: "response" }])]
      expect(extractConversationSeedFromMessages(messages)).toBe("")
    })

    it("handles empty messages array", () => {
      expect(extractConversationSeedFromMessages([])).toBe("")
    })
  })

  describe("extractConversationSeedFromContents", () => {
    it("extracts seed from first user content", () => {
      const contents = [createMessage("user", [{ text: "hello" }]), createMessage("model", [{ text: "hi" }])]
      const seed = extractConversationSeedFromContents(contents)
      expect(seed).toContain("hello")
    })

    it("returns empty string when no user content", () => {
      const contents = [createMessage("model", [{ text: "hi" }])]
      expect(extractConversationSeedFromContents(contents)).toBe("")
    })
  })

  describe("resolveProjectKey", () => {
    it("returns candidate if it is a string", () => {
      expect(resolveProjectKey("my-project")).toBe("my-project")
    })

    it("returns fallback if candidate is not a string", () => {
      expect(resolveProjectKey(null, "fallback")).toBe("fallback")
      expect(resolveProjectKey(undefined, "fallback")).toBe("fallback")
      expect(resolveProjectKey({}, "fallback")).toBe("fallback")
    })

    it("returns undefined if no valid candidate or fallback", () => {
      expect(resolveProjectKey(null)).toBeUndefined()
      expect(resolveProjectKey(undefined)).toBeUndefined()
    })
  })

  describe("isGeminiToolUsePart", () => {
    it("returns true for functionCall parts", () => {
      expect(isGeminiToolUsePart({ functionCall: { name: "test" } })).toBe(true)
    })

    it("returns false for non-functionCall parts", () => {
      expect(isGeminiToolUsePart({ text: "hello" })).toBe(false)
      expect(isGeminiToolUsePart({ thought: true })).toBe(false)
    })

    it("returns false for null/undefined", () => {
      expect(isGeminiToolUsePart(null)).toBe(false)
      expect(isGeminiToolUsePart(undefined)).toBe(false)
    })
  })

  describe("isGeminiThinkingPart", () => {
    it("returns true for thought:true parts", () => {
      expect(isGeminiThinkingPart({ thought: true, text: "thinking..." })).toBe(true)
    })

    it("returns false for thought:false parts", () => {
      expect(isGeminiThinkingPart({ thought: false, text: "not thinking" })).toBe(false)
    })

    it("returns false for parts without thought property", () => {
      expect(isGeminiThinkingPart({ text: "hello" })).toBe(false)
    })
  })

  describe("ensureThoughtSignature", () => {
    it("adds sentinel signature when no cached signature exists", () => {
      const part = { thought: true, text: "thinking..." }
      const result = ensureThoughtSignature(part, "no-cache-session")
      // Now uses sentinel fallback to prevent API rejection
      expect(result.thoughtSignature).toBe("skip_thought_signature_validator")
    })

    it("preserves an existing provider signature on cache miss", () => {
      const existingSignature = "a".repeat(MIN_SIGNATURE_LENGTH + 10)
      const part = { thought: true, text: "thinking...", thoughtSignature: existingSignature }
      const result = ensureThoughtSignature(part, "session-key")
      expect(result.thoughtSignature).toBe(existingSignature)
    })

    it("does not modify non-thinking parts", () => {
      const part = { text: "regular text" }
      const result = ensureThoughtSignature(part, "session-key")
      expect(result.thoughtSignature).toBeUndefined()
    })

    it("returns null/undefined inputs unchanged", () => {
      expect(ensureThoughtSignature(null, "key")).toBeNull()
      expect(ensureThoughtSignature(undefined, "key")).toBeUndefined()
    })

    it("returns non-object inputs unchanged", () => {
      expect(ensureThoughtSignature("string", "key")).toBe("string")
      expect(ensureThoughtSignature(123, "key")).toBe(123)
    })
  })

  describe("hasSignedThinkingPart", () => {
    it("returns true for part with valid thoughtSignature", () => {
      const part = { thought: true, thoughtSignature: "a".repeat(MIN_SIGNATURE_LENGTH) }
      expect(hasSignedThinkingPart(part)).toBe(true)
    })

    it("returns true for type:thinking with valid signature field", () => {
      const part = { type: "thinking", thinking: "...", signature: "a".repeat(MIN_SIGNATURE_LENGTH) }
      expect(hasSignedThinkingPart(part)).toBe(true)
    })

    it("returns true for type:reasoning with valid signature field", () => {
      const part = { type: "reasoning", signature: "a".repeat(MIN_SIGNATURE_LENGTH) }
      expect(hasSignedThinkingPart(part)).toBe(true)
    })

    it("returns false for part with short signature", () => {
      const part = { thought: true, thoughtSignature: "short" }
      expect(hasSignedThinkingPart(part)).toBe(false)
    })

    it("returns false for part without signature", () => {
      const part = { thought: true, text: "no signature" }
      expect(hasSignedThinkingPart(part)).toBe(false)
    })
  })

  describe("hasToolUseInContents", () => {
    it("returns true when contents have functionCall", () => {
      const contents = [{ role: "model", parts: [{ functionCall: { name: "test" } }] }]
      expect(hasToolUseInContents(contents)).toBe(true)
    })

    it("returns false when no functionCall present", () => {
      const contents = [{ role: "model", parts: [{ text: "hello" }] }]
      expect(hasToolUseInContents(contents)).toBe(false)
    })

    it("handles empty contents", () => {
      expect(hasToolUseInContents([])).toBe(false)
    })
  })

  describe("hasSignedThinkingInContents", () => {
    it("returns true when contents have signed thinking", () => {
      const contents = [
        createMessage("model", [createThoughtPart("", { thoughtSignature: "a".repeat(MIN_SIGNATURE_LENGTH) })]),
      ]
      expect(hasSignedThinkingInContents(contents)).toBe(true)
    })

    it("returns false when no signed thinking present", () => {
      const contents = [createMessage("model", [createThoughtPart("unsigned")])]
      expect(hasSignedThinkingInContents(contents)).toBe(false)
    })
  })

  describe("hasToolUseInMessages", () => {
    it("returns true when messages have tool_use blocks", () => {
      const messages = [{ role: "assistant", content: [{ type: "tool_use", id: "123", name: "test" }] }]
      expect(hasToolUseInMessages(messages)).toBe(true)
    })

    it("returns false when no tool_use blocks", () => {
      const messages = [{ role: "assistant", content: [{ type: "text", text: "hello" }] }]
      expect(hasToolUseInMessages(messages)).toBe(false)
    })

    it("handles string content", () => {
      const messages = [{ role: "assistant", content: "just text" }]
      expect(hasToolUseInMessages(messages)).toBe(false)
    })
  })

  describe("hasSignedThinkingInMessages", () => {
    it("returns true when messages have signed thinking blocks", () => {
      const messages = [
        {
          role: "assistant",
          content: [{ type: "thinking", thinking: "...", signature: "a".repeat(MIN_SIGNATURE_LENGTH) }],
        },
      ]
      expect(hasSignedThinkingInMessages(messages)).toBe(true)
    })

    it("returns false when thinking blocks are unsigned", () => {
      const messages = [{ role: "assistant", content: [{ type: "thinking", thinking: "no sig" }] }]
      expect(hasSignedThinkingInMessages(messages)).toBe(false)
    })
  })

  describe("prepareAntigravityRequest", () => {
    const mockAccessToken = "test-token"
    const mockProjectId = "test-project"

    it("returns unchanged request for non-generative-language URLs", () => {
      const result = prepareAntigravityRequest(
        "https://example.com/api",
        { method: "POST" },
        mockAccessToken,
        mockProjectId,
      )
      expect(result.streaming).toBe(false)
      expect(result.request).toBe("https://example.com/api")
    })

    it("returns unchanged request for URLs without model pattern", () => {
      const result = prepareAntigravityRequest(
        "https://generativelanguage.googleapis.com/v1/models",
        { method: "POST" },
        mockAccessToken,
        mockProjectId,
      )
      expect(result.streaming).toBe(false)
    })

    it("detects streaming from generateStreamContent action", () => {
      const result = prepareAntigravityRequest(
        "https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:streamGenerateContent",
        { method: "POST", body: JSON.stringify({ contents: [] }) },
        mockAccessToken,
        mockProjectId,
      )
      expect(result.streaming).toBe(true)
    })

    it("detects non-streaming from generateContent action", () => {
      const result = prepareAntigravityRequest(
        "https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent",
        { method: "POST", body: JSON.stringify({ contents: [] }) },
        mockAccessToken,
        mockProjectId,
      )
      expect(result.streaming).toBe(false)
    })

    it("sets Authorization header with Bearer token", () => {
      const result = prepareAntigravityRequest(
        "https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent",
        { method: "POST", body: JSON.stringify({ contents: [] }) },
        mockAccessToken,
        mockProjectId,
      )
      const headers = result.init.headers as Headers
      expect(headers.get("Authorization")).toBe("Bearer test-token")
    })

    it("removes x-api-key header", () => {
      const result = prepareAntigravityRequest(
        "https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent",
        { method: "POST", body: JSON.stringify({ contents: [] }), headers: { "x-api-key": "old-key" } },
        mockAccessToken,
        mockProjectId,
      )
      const headers = result.init.headers as Headers
      expect(headers.get("x-api-key")).toBeNull()
    })

    it("removes the Google SDK API-key header from OAuth requests", () => {
      const result = prepareAntigravityRequest(
        "https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent",
        {
          method: "POST",
          body: JSON.stringify({ contents: [] }),
          headers: { "x-goog-api-key": "placeholder-api-key" },
        },
        mockAccessToken,
        mockProjectId,
      )
      const headers = result.init.headers as Headers
      expect(headers.get("x-goog-api-key")).toBeNull()
      expect(headers.get("Authorization")).toBe("Bearer test-token")
    })

    it("removes x-goog-user-project header for OAuth requests", () => {
      const result = prepareAntigravityRequest(
        "https://generativelanguage.googleapis.com/v1beta/models/claude-opus-4-6-thinking:generateContent",
        { method: "POST", body: JSON.stringify({ contents: [] }), headers: { "x-goog-user-project": "my-project" } },
        mockAccessToken,
        mockProjectId,
      )
      const headers = result.init.headers as Headers
      expect(headers.get("x-goog-user-project")).toBeNull()
    })

    it("identifies Claude models correctly", () => {
      const result = prepareAntigravityRequest(
        "https://generativelanguage.googleapis.com/v1beta/models/claude-sonnet-4-20250514:generateContent",
        { method: "POST", body: JSON.stringify({ contents: [] }) },
        mockAccessToken,
        mockProjectId,
      )
      expect(result.effectiveModel).toContain("claude")
    })

    it("identifies Gemini models correctly", () => {
      const result = prepareAntigravityRequest(
        "https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash:generateContent",
        { method: "POST", body: JSON.stringify({ contents: [] }) },
        mockAccessToken,
        mockProjectId,
      )
      expect(result.effectiveModel).toContain("gemini")
    })

    it.each([
      "gemini-2.5-flash",
      "gemini-2.5-pro",
      "gemini-2.5-flash-image",
      "antigravity-gemini-2.5-flash",
      "gemini-2.5-pro-high",
      "antigravity-gemini-2.5-flash-low",
    ])("gives migration guidance for CLI-only model %s", (model) => {
      expect(() =>
        prepareAntigravityRequest(
          `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
          { method: "POST", body: JSON.stringify({ contents: [] }) },
          mockAccessToken,
          mockProjectId,
        ),
      ).toThrow(/supported antigravity-gemini-\* model or a Google API-key connection/)
    })

    it("uses custom endpoint override", () => {
      const customEndpoint = "https://custom.api.com"
      const result = prepareAntigravityRequest(
        "https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent",
        { method: "POST", body: JSON.stringify({ contents: [] }) },
        mockAccessToken,
        mockProjectId,
        customEndpoint,
      )
      expect(result.endpoint).toContain(customEndpoint)
    })

    it("handles wrapped Antigravity body format", () => {
      const wrappedBody = {
        project: "my-project",
        request: { contents: [{ parts: [{ text: "Hello" }] }] },
      }
      const result = prepareAntigravityRequest(
        "https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent",
        { method: "POST", body: JSON.stringify(wrappedBody) },
        mockAccessToken,
        mockProjectId,
      )
      expect(result.streaming).toBe(false)
    })

    it("handles unwrapped body format", () => {
      const unwrappedBody = {
        contents: [{ parts: [{ text: "Hello" }] }],
      }
      const result = prepareAntigravityRequest(
        "https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent",
        { method: "POST", body: JSON.stringify(unwrappedBody) },
        mockAccessToken,
        mockProjectId,
      )
      expect(result.streaming).toBe(false)
    })

    it("does not add Claude auto-caching to wrapped request by default", () => {
      const wrappedBody = {
        project: "my-project",
        request: { messages: [{ role: "user", content: [{ type: "text", text: "Hello" }] }] },
      }
      const result = prepareAntigravityRequest(
        "https://generativelanguage.googleapis.com/v1beta/models/claude-3-7-sonnet:generateContent",
        { method: "POST", body: JSON.stringify(wrappedBody) },
        mockAccessToken,
        mockProjectId,
      )

      const wrapped = JSON.parse(result.init.body as string)
      expect(wrapped.request.cache_control).toBeUndefined()
    })

    it("does not add Claude auto-caching to unwrapped request by default", () => {
      const unwrappedBody = {
        messages: [{ role: "user", content: [{ type: "text", text: "Hello" }] }],
      }
      const result = prepareAntigravityRequest(
        "https://generativelanguage.googleapis.com/v1beta/models/claude-3-7-sonnet:generateContent",
        { method: "POST", body: JSON.stringify(unwrappedBody) },
        mockAccessToken,
        mockProjectId,
      )

      const wrapped = JSON.parse(result.init.body as string)
      expect(wrapped.request.cache_control).toBeUndefined()
    })

    it("adds Claude auto-caching when enabled", () => {
      const unwrappedBody = {
        messages: [{ role: "user", content: [{ type: "text", text: "Hello" }] }],
      }
      const result = prepareAntigravityRequest(
        "https://generativelanguage.googleapis.com/v1beta/models/claude-3-7-sonnet:generateContent",
        { method: "POST", body: JSON.stringify(unwrappedBody) },
        mockAccessToken,
        mockProjectId,
        undefined,
        false,
        { claudePromptAutoCaching: true },
      )

      const wrapped = JSON.parse(result.init.body as string)
      expect(wrapped.request.cache_control).toEqual({ type: "ephemeral" })
    })

    it("strips Claude thinking blocks when keep_thinking is false (unwrapped)", () => {
      const result = withKeepThinking(false, () =>
        prepareAntigravityRequest(
          "https://generativelanguage.googleapis.com/v1beta/models/claude-opus-4-6-thinking:generateContent",
          {
            method: "POST",
            body: JSON.stringify({
              contents: [
                {
                  role: "model",
                  parts: [
                    {
                      thought: true,
                      text: "foreign-thought-unwrapped",
                      thoughtSignature: "f".repeat(MIN_SIGNATURE_LENGTH + 8),
                    },
                    { functionCall: { name: "weather", args: {} } },
                  ],
                },
              ],
            }),
          },
          mockAccessToken,
          mockProjectId,
        ),
      )

      const wrapped = JSON.parse(result.init.body as string)
      const parts = wrapped.request.contents[0].parts as Array<Record<string, unknown>>
      const thinkingParts = parts.filter(
        (part) =>
          part.thought === true ||
          part.type === "thinking" ||
          part.type === "redacted_thinking" ||
          part.type === "reasoning",
      )

      expect(thinkingParts).toHaveLength(0)
      expect(result.needsSignedThinkingWarmup).toBe(false)
    })

    it("strips Claude thinking blocks when keep_thinking is false (wrapped)", () => {
      const result = withKeepThinking(false, () =>
        prepareAntigravityRequest(
          "https://generativelanguage.googleapis.com/v1beta/models/claude-opus-4-6-thinking:generateContent",
          {
            method: "POST",
            body: JSON.stringify({
              project: "my-project",
              request: {
                contents: [
                  {
                    role: "model",
                    parts: [
                      {
                        thought: true,
                        text: "foreign-thought-wrapped",
                        thoughtSignature: "w".repeat(MIN_SIGNATURE_LENGTH + 8),
                      },
                      { functionCall: { name: "weather", args: {} } },
                    ],
                  },
                ],
              },
            }),
          },
          mockAccessToken,
          mockProjectId,
        ),
      )

      const wrapped = JSON.parse(result.init.body as string)
      const parts = wrapped.request.contents[0].parts as Array<Record<string, unknown>>
      const thinkingParts = parts.filter(
        (part) =>
          part.thought === true ||
          part.type === "thinking" ||
          part.type === "redacted_thinking" ||
          part.type === "reasoning",
      )

      expect(thinkingParts).toHaveLength(0)
      expect(result.needsSignedThinkingWarmup).toBe(false)
    })

    it("does not trust foreign Gemini thoughtSignature when keep_thinking is true", () => {
      const foreignSignature = "x".repeat(MIN_SIGNATURE_LENGTH + 8)
      const result = withKeepThinking(true, () =>
        prepareAntigravityRequest(
          "https://generativelanguage.googleapis.com/v1beta/models/claude-opus-4-6-thinking:generateContent",
          {
            method: "POST",
            body: JSON.stringify({
              contents: [
                {
                  role: "model",
                  parts: [
                    {
                      thought: true,
                      text: "foreign-thought-keep-true",
                      thoughtSignature: foreignSignature,
                    },
                    { functionCall: { name: "weather", args: {} } },
                  ],
                },
              ],
            }),
          },
          mockAccessToken,
          mockProjectId,
        ),
      )

      const wrapped = JSON.parse(result.init.body as string)
      const parts = wrapped.request.contents[0].parts as Array<Record<string, unknown>>
      const thinkingBlock = parts.find(
        (part) => part.thought === true || part.type === "thinking" || part.type === "redacted_thinking",
      )
      const signature =
        typeof thinkingBlock?.signature === "string" ? thinkingBlock.signature : thinkingBlock?.thoughtSignature

      expect(JSON.stringify(wrapped)).not.toContain(foreignSignature)
      if (thinkingBlock) {
        expect(signature).toBe(SKIP_THOUGHT_SIGNATURE)
      }
    })

    it("replaces foreign Claude signatures with sentinel when keep_thinking is true", () => {
      const foreignSignature = "y".repeat(MIN_SIGNATURE_LENGTH + 8)
      const result = withKeepThinking(true, () =>
        prepareAntigravityRequest(
          "https://generativelanguage.googleapis.com/v1beta/models/claude-opus-4-6-thinking:generateContent",
          {
            method: "POST",
            body: JSON.stringify({
              messages: [
                {
                  role: "assistant",
                  content: [
                    {
                      type: "thinking",
                      thinking: "foreign-message-thinking",
                      signature: foreignSignature,
                    },
                    {
                      type: "tool_use",
                      id: "tool-1",
                      name: "weather",
                      input: {},
                    },
                  ],
                },
              ],
            }),
          },
          mockAccessToken,
          mockProjectId,
        ),
      )

      const wrapped = JSON.parse(result.init.body as string)
      const content = wrapped.request.messages[0].content as Array<Record<string, unknown>>
      const thinkingBlock = content.find((block) => block.type === "thinking" || block.type === "redacted_thinking")

      expect(thinkingBlock).toBeTruthy()
      expect(thinkingBlock?.signature).toBe(SKIP_THOUGHT_SIGNATURE)
      expect(JSON.stringify(content)).not.toContain(foreignSignature)
      expect(result.needsSignedThinkingWarmup).toBe(false)
    })

    it("preserves cached Claude thinking when keep_thinking is enabled", () => {
      const effectiveModel = resolveAntigravityModel("claude-opus-4-6-thinking").actualModel
      const signatureSessionKey = buildSignatureSessionKey(
        getPluginSessionId(),
        effectiveModel,
        "thread-with-cached-claude-thinking",
        mockProjectId,
      )
      const signature = "cached-claude-signature".padEnd(64, "x")
      clearSignatureCache(signatureSessionKey)
      cacheSignature(signatureSessionKey, "cached Claude reasoning", signature)

      try {
        const result = withKeepThinking(true, () =>
          prepareAntigravityRequest(
            "https://generativelanguage.googleapis.com/v1beta/models/claude-opus-4-6-thinking:generateContent",
            {
              method: "POST",
              body: JSON.stringify({
                conversationId: "thread-with-cached-claude-thinking",
                messages: [
                  {
                    role: "assistant",
                    content: [
                      { type: "thinking", thinking: "cached Claude reasoning", signature },
                      { type: "tool_use", id: "tool-call-1", name: "weather", input: {} },
                    ],
                  },
                ],
              }),
            },
            mockAccessToken,
            mockProjectId,
          ),
        )

        const wrapped = JSON.parse(result.init.body as string)
        const thinking = wrapped.request.messages[0].content[0]
        expect(thinking.signature).toBe(signature)
        expect(result.needsSignedThinkingWarmup).toBe(false)
      } finally {
        clearSignatureCache(signatureSessionKey)
      }
    })

    it("restores a cached thought signature onto the first Gemini function call", () => {
      const effectiveModel = resolveAntigravityModel("gemini-3-flash").actualModel
      const signatureSessionKey = buildSignatureSessionKey(
        getPluginSessionId(),
        effectiveModel,
        "thread-with-cached-signature",
        mockProjectId,
      )
      const signature = "cached-provider-signature".padEnd(64, "x")
      clearSignatureCache(signatureSessionKey)
      cacheSignature(signatureSessionKey, "cached reasoning", signature)

      try {
        const result = prepareAntigravityRequest(
          "https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash:generateContent",
          {
            method: "POST",
            body: JSON.stringify({
              conversationId: "thread-with-cached-signature",
              contents: [
                { role: "user", parts: [{ text: "check the weather" }] },
                {
                  role: "model",
                  parts: [{ thought: true, text: "cached reasoning" }, { functionCall: { name: "weather" } }],
                },
              ],
            }),
          },
          mockAccessToken,
          mockProjectId,
        )

        const wrapped = JSON.parse(result.init.body as string)
        const functionCall = wrapped.request.contents[1].parts[1]
        expect(functionCall.thoughtSignature).toBe(signature)
        expect(functionCall.thought_signature).toBe(signature)
      } finally {
        clearSignatureCache(signatureSessionKey)
      }
    })

    it("returns requestedModel matching URL model", () => {
      const result = prepareAntigravityRequest(
        "https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash:generateContent",
        { method: "POST", body: JSON.stringify({ contents: [] }) },
        mockAccessToken,
        mockProjectId,
      )
      expect(result.requestedModel).toBe("gemini-3-flash")
    })

    it("handles empty body gracefully", () => {
      const result = prepareAntigravityRequest(
        "https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent",
        { method: "POST", body: JSON.stringify({}) },
        mockAccessToken,
        mockProjectId,
      )
      expect(result.streaming).toBe(false)
    })

    it("handles minimal valid JSON body", () => {
      const result = prepareAntigravityRequest(
        "https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent",
        { method: "POST", body: JSON.stringify({ contents: [] }) },
        mockAccessToken,
        mockProjectId,
      )
      expect(result.streaming).toBe(false)
    })

    it("removes contents entries with empty or invalid parts", () => {
      const result = prepareAntigravityRequest(
        "https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash:generateContent",
        {
          method: "POST",
          body: JSON.stringify({
            contents: [
              { role: "user", parts: [] },
              { role: "model", parts: [null, { text: "kept" }] },
              { role: "user", parts: null },
            ],
            systemInstruction: {
              role: "user",
              parts: [null, { text: "system kept" }],
            },
          }),
        },
        mockAccessToken,
        mockProjectId,
      )

      const wrapped = JSON.parse(result.init.body as string)
      expect(wrapped.request.contents).toHaveLength(1)
      expect(wrapped.request.contents[0]).toEqual({
        role: "model",
        parts: [{ text: "kept" }],
      })
      expect(wrapped.request.systemInstruction.parts[0].text).toContain("system kept")
    })

    it("replaces invalid systemInstruction with the Antigravity instruction", () => {
      const result = prepareAntigravityRequest(
        "https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash:generateContent",
        {
          method: "POST",
          body: JSON.stringify({
            contents: [{ role: "user", parts: [{ text: "hi" }] }],
            systemInstruction: {
              role: "user",
              parts: [null],
            },
          }),
        },
        mockAccessToken,
        mockProjectId,
      )

      const wrapped = JSON.parse(result.init.body as string)
      expect(wrapped.request.systemInstruction.parts[0].text).toContain("You are Antigravity")
    })

    describe("Antigravity model name resolution", () => {
      it("transforms gemini-3-flash-preview to gemini-3-flash", () => {
        const result = prepareAntigravityRequest(
          "https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent",
          { method: "POST", body: JSON.stringify({ contents: [] }) },
          mockAccessToken,
          mockProjectId,
        )
        expect(result.effectiveModel).toBe("gemini-3-flash")
      })

      it("transforms gemini-3-pro-preview to gemini-3-pro-low", () => {
        const result = prepareAntigravityRequest(
          "https://generativelanguage.googleapis.com/v1beta/models/gemini-3-pro-preview:generateContent",
          { method: "POST", body: JSON.stringify({ contents: [] }) },
          mockAccessToken,
          mockProjectId,
        )
        expect(result.effectiveModel).toBe("gemini-3-pro-low")
      })

      it("transforms gemini-3.1-pro-preview to gemini-3.1-pro-low", () => {
        const result = prepareAntigravityRequest(
          "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-pro-preview:generateContent",
          { method: "POST", body: JSON.stringify({ contents: [] }) },
          mockAccessToken,
          mockProjectId,
        )
        expect(result.effectiveModel).toBe("gemini-3.1-pro-low")
      })

      it("transforms gemini-3.1-pro-preview-customtools to gemini-3.1-pro-low", () => {
        const result = prepareAntigravityRequest(
          "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-pro-preview-customtools:generateContent",
          { method: "POST", body: JSON.stringify({ contents: [] }) },
          mockAccessToken,
          mockProjectId,
        )
        expect(result.effectiveModel).toBe("gemini-3.1-pro-low")
      })

      it("sends Claude Sonnet 4.6 thinking under its base ID with a valid thinking budget", () => {
        const result = prepareAntigravityRequest(
          "https://generativelanguage.googleapis.com/v1beta/models/antigravity-claude-sonnet-4-6-thinking:generateContent",
          { method: "POST", body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: "hello" }] }] }) },
          mockAccessToken,
          mockProjectId,
        )
        const wrapped = JSON.parse(result.init.body as string)

        expect(result.effectiveModel).toBe("claude-sonnet-4-6")
        expect(wrapped.request.generationConfig).toMatchObject({
          thinkingConfig: { include_thoughts: true, thinking_budget: 32768 },
          maxOutputTokens: 64000,
        })
      })

      it("requests a Sonnet thinking signature warmup for an unsigned tool turn", () => {
        const result = withKeepThinking(true, () =>
          prepareAntigravityRequest(
            "https://generativelanguage.googleapis.com/v1beta/models/antigravity-claude-sonnet-4-6-thinking:generateContent",
            {
              method: "POST",
              body: JSON.stringify({
                contents: [
                  { role: "user", parts: [{ text: "sonnet warmup regression conversation" }] },
                  { role: "model", parts: [{ functionCall: { name: "lookup", args: {} } }] },
                ],
              }),
            },
            mockAccessToken,
            "sonnet-warmup-test-project",
          ),
        )

        expect(result.effectiveModel).toBe("claude-sonnet-4-6")
        expect(result.needsSignedThinkingWarmup).toBe(true)
      })

      it("keeps supported non-Gemini-3 models unchanged", () => {
        const result = prepareAntigravityRequest(
          "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent",
          { method: "POST", body: JSON.stringify({ contents: [] }) },
          mockAccessToken,
          mockProjectId,
        )
        expect(result.effectiveModel).toBe("gemini-2.0-flash")
      })
    })
  })

  describe("transformAntigravityResponse", () => {
    it("injects [ThinkingResolution] details when debug_tui is enabled", async () => {
      initializeDebug({
        ...DEFAULT_CONFIG,
        debug: false,
        debug_tui: true,
      })

      const response = new Response(
        JSON.stringify({
          error: {
            code: 500,
            message: "Upstream error",
            status: "INTERNAL",
          },
        }),
        {
          status: 500,
          headers: { "content-type": "application/json" },
        },
      )

      const transformed = await transformAntigravityResponse(
        response,
        false,
        undefined,
        "gemini-3-pro",
        "test-project",
        "https://daily-cloudcode-pa.sandbox.googleapis.com/v1internal:generateContent",
        "gemini-3-pro",
        "session-1",
        0,
        "summary",
        undefined,
        [
          "status=500 INTERNAL",
          "endpoint=https://daily-cloudcode-pa.sandbox.googleapis.com/v1internal:generateContent",
          "account=test@example.com",
        ],
      )

      const bodyText = await transformed.text()
      expect(bodyText).toContain("[ThinkingResolution]")
      expect(bodyText).toContain("status=500 INTERNAL")
      expect(bodyText).toContain(
        "endpoint=https://daily-cloudcode-pa.sandbox.googleapis.com/v1internal:generateContent",
      )
      expect(bodyText).toContain("account=test@example.com")

      initializeDebug(DEFAULT_CONFIG)
    })

    it("does not misclassify generic INVALID_ARGUMENT as thinking recovery from debug metadata", async () => {
      const response = new Response(
        JSON.stringify({
          error: {
            code: 400,
            message: "Request contains an invalid argument.",
            status: "INVALID_ARGUMENT",
          },
        }),
        {
          status: 400,
          headers: { "content-type": "application/json" },
        },
      )

      const transformed = await transformAntigravityResponse(
        response,
        true,
        undefined,
        "antigravity-claude-opus-4-6-thinking",
        "test-project",
        "https://daily-cloudcode-pa.sandbox.googleapis.com/v1internal:streamGenerateContent?alt=sse",
        "claude-opus-4-6-thinking",
        "session-1",
        0,
        "expected=1 found=0",
      )

      await expect(transformed.text()).resolves.toContain("Request contains an invalid argument.")
    })

    it("rethrows THINKING_RECOVERY_NEEDED for outer retry handling", async () => {
      const response = new Response(
        JSON.stringify({
          error: {
            code: 400,
            message: "Thinking must start with a thinking block before tool use.",
            status: "INVALID_ARGUMENT",
          },
        }),
        {
          status: 400,
          headers: { "content-type": "application/json" },
        },
      )

      await expect(
        transformAntigravityResponse(
          response,
          true,
          undefined,
          "antigravity-claude-opus-4-6-thinking",
          "test-project",
          "https://daily-cloudcode-pa.sandbox.googleapis.com/v1internal:streamGenerateContent?alt=sse",
          "claude-opus-4-6-thinking",
          "session-1",
        ),
      ).rejects.toMatchObject({ message: "THINKING_RECOVERY_NEEDED" })
    })
  })
})
