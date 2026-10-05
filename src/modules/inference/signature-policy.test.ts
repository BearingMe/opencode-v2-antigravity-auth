import { afterEach, describe, expect, it } from "vitest"
import { SKIP_THOUGHT_SIGNATURE } from "./constants.js"
import { cacheSignature, clearSignatureCache } from "./signature-cache.js"
import { createSignatureStore } from "./signature-store.js"
import {
  ensureThinkingBeforeToolUseInContents,
  ensureThinkingBeforeToolUseInMessages,
  sanitizeRequestPayloadForAntigravity,
} from "./signature-policy.js"

describe("tool-turn thinking repair", () => {
  afterEach(() => {
    clearSignatureCache()
  })

  it("moves Gemini thinking ahead of calls and marks it with the accepted sentinel", () => {
    const result = ensureThinkingBeforeToolUseInContents(
      [
        {
          role: "model",
          parts: [{ text: "answer" }, { thought: true, text: "reasoning" }, { functionCall: { name: "search" } }],
        },
      ],
      "scope",
    )

    expect(result[0].parts).toEqual([
      { thought: true, text: "reasoning", thoughtSignature: SKIP_THOUGHT_SIGNATURE },
      { text: "answer" },
      { functionCall: { name: "search" } },
    ])
  })

  it("marks Gemini thinking with the sentinel on a cache miss and keeps it before the tool call", () => {
    const result = ensureThinkingBeforeToolUseInContents(
      [
        {
          role: "model",
          parts: [{ thought: true, text: "old reasoning" }, { functionCall: { name: "search" } }],
        },
      ],
      "missing-scope",
    )

    expect(result[0].parts).toEqual([
      { thought: true, text: "old reasoning", thoughtSignature: SKIP_THOUGHT_SIGNATURE },
      { functionCall: { name: "search" } },
    ])
  })

  it("preserves a received Gemini signature when the session cache has no entry", () => {
    const signature = "received-signature".padEnd(64, "x")
    const result = ensureThinkingBeforeToolUseInContents(
      [
        {
          role: "model",
          parts: [
            { thought: true, text: "received reasoning", thoughtSignature: signature },
            { functionCall: { name: "search" } },
          ],
        },
      ],
      "cache-miss",
    )

    expect(result[0].parts[0]).toEqual({
      thought: true,
      text: "received reasoning",
      thoughtSignature: signature,
    })
    expect(result[0].parts[1]).toMatchObject({ functionCall: { name: "search" } })
  })

  it("reuses the exact cached Gemini signature before function calls", () => {
    const signature = "provider-signature".padEnd(64, "x")
    cacheSignature("cached-scope", "reasoning", signature)

    const result = ensureThinkingBeforeToolUseInContents(
      [
        {
          role: "model",
          parts: [{ text: "answer" }, { thought: true, text: "reasoning" }, { functionCall: { name: "search" } }],
        },
      ],
      "cached-scope",
    )

    expect(result[0].parts[0]).toEqual({
      thought: true,
      text: "reasoning",
      thoughtSignature: signature,
    })
    expect(result[0].parts[2]).toMatchObject({ functionCall: { name: "search" } })
  })

  it("restores the exact cached Claude signature before an assistant tool turn", () => {
    const signature = "provider-signature".padEnd(64, "x")
    const signatureStore = createSignatureStore()
    signatureStore.set("scope", { text: "prior reasoning", signature })

    const result = ensureThinkingBeforeToolUseInMessages(
      [
        {
          role: "assistant",
          content: [
            { type: "text", text: "answer" },
            { type: "tool_use", id: "call-1", name: "search" },
          ],
        },
      ],
      "scope",
      { signatureStore },
    )

    expect(result[0].content[0]).toEqual({
      type: "thinking",
      thinking: "prior reasoning",
      signature,
    })
    expect(result[0].content[1]).toMatchObject({ type: "text" })
    expect(result[0].content[2]).toMatchObject({ type: "tool_use", id: "call-1" })
  })

  it("retains a Claude tool turn with a sentinel when no cached thought exists", () => {
    const result = ensureThinkingBeforeToolUseInMessages(
      [
        {
          role: "assistant",
          content: [
            { type: "thinking", thinking: "current thought" },
            { type: "tool_use", id: "call-1" },
          ],
        },
      ],
      "missing-scope",
      { signatureStore: createSignatureStore() },
    )

    expect(result[0].content[0]).toEqual({
      type: "thinking",
      thinking: "current thought",
      signature: SKIP_THOUGHT_SIGNATURE,
    })
    expect(result[0].content[1]).toMatchObject({ type: "tool_use", id: "call-1" })
  })

  it("preserves a received Claude signature when the session cache has no entry", () => {
    const signature = "received-signature".padEnd(64, "x")
    const result = ensureThinkingBeforeToolUseInMessages(
      [
        {
          role: "assistant",
          content: [
            { type: "thinking", thinking: "received reasoning", signature },
            { type: "tool_use", id: "call-2" },
          ],
        },
      ],
      "cache-miss",
      { signatureStore: createSignatureStore() },
    )

    expect(result[0].content[0]).toEqual({
      type: "thinking",
      thinking: "received reasoning",
      signature,
    })
    expect(result[0].content[1]).toMatchObject({ type: "tool_use", id: "call-2" })
  })

  it("restores the preceding cached signature onto the first Gemini function call", () => {
    const signature = "cached-signature".padEnd(64, "x")
    cacheSignature("scope", "reasoning", signature)
    const payload = {
      contents: [
        {
          role: "model",
          parts: [{ thought: true, text: "reasoning" }, { functionCall: { name: "search" } }],
        },
      ],
    }

    sanitizeRequestPayloadForAntigravity(payload, { signatureSessionKey: "scope" })

    expect(payload.contents[0]!.parts[1]!).toMatchObject({
      functionCall: { name: "search" },
      thoughtSignature: signature,
      thought_signature: signature,
    })
  })

  it("copies the received snake-case signature from the preceding thought", () => {
    const signature = "received-signature".padEnd(64, "x")
    const payload = {
      contents: [
        {
          role: "model",
          parts: [
            { thought: true, text: "reasoning", thought_signature: signature },
            { functionCall: { name: "search" } },
          ],
        },
      ],
    }

    sanitizeRequestPayloadForAntigravity(payload)

    expect(payload.contents[0]!.parts[1]!).toMatchObject({
      functionCall: { name: "search" },
      thoughtSignature: signature,
      thought_signature: signature,
    })
  })

  it("keeps signatures only on the first of parallel function calls", () => {
    const signature = "received-signature".padEnd(64, "x")
    const payload = {
      contents: [
        {
          role: "model",
          parts: [
            { functionCall: { name: "first" }, thoughtSignature: signature },
            { functionCall: { name: "second" }, thoughtSignature: signature },
          ],
        },
      ],
    }

    sanitizeRequestPayloadForAntigravity(payload)

    expect(payload.contents[0]!.parts[0]!).toMatchObject({
      functionCall: { name: "first" },
      thoughtSignature: signature,
    })
    expect(payload.contents[0]!.parts[1]).not.toHaveProperty("thoughtSignature")
    expect(payload.contents[0]!.parts[1]).not.toHaveProperty("thought_signature")
  })

  it("uses the sentinel only when the first function call has no reusable signature", () => {
    const payload = { contents: [{ role: "model", parts: [{ functionCall: { name: "search" } }] }] }

    sanitizeRequestPayloadForAntigravity(payload)

    expect(payload.contents[0]!.parts[0]!).toMatchObject({
      functionCall: { name: "search" },
      thoughtSignature: SKIP_THOUGHT_SIGNATURE,
      thought_signature: SKIP_THOUGHT_SIGNATURE,
    })
  })
})
