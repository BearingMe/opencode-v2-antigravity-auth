import { describe, expect, it } from "vitest"
import { SKIP_THOUGHT_SIGNATURE } from "./constants.js"
import { filterMessagesThinkingBlocks } from "./thinking-filter.js"

describe("Claude thinking filter", () => {
  it("keeps the exact cached provider signature when keep_thinking is enabled", () => {
    const signature = "provider-signature".padEnd(64, "x")
    const result = filterMessagesThinkingBlocks(
      [
        {
          role: "assistant",
          content: [
            { type: "thinking", thinking: "reasoning", signature },
            { type: "tool_use", id: "call-1" },
          ],
        },
      ],
      "scope",
      (_sessionId, text) => (text === "reasoning" ? signature : undefined),
      true,
      { keepThinking: true },
    )

    expect(result[0].content[0]).toEqual({ type: "thinking", thinking: "reasoning", signature })
    expect(result[0].content[1]).toMatchObject({ type: "tool_use", id: "call-1" })
  })

  it("restores the session signature for a foreign Claude signature", () => {
    const signature = "cached-signature".padEnd(64, "x")
    const result = filterMessagesThinkingBlocks(
      [
        {
          role: "assistant",
          content: [{ type: "thinking", thinking: "reasoning", signature: "foreign-signature" }],
        },
      ],
      "scope",
      () => signature,
      true,
      { keepThinking: true },
    )

    expect(result[0].content[0]).toEqual({ type: "thinking", thinking: "reasoning", signature })
  })

  it("uses the sentinel when keep_thinking is enabled but the cache misses", () => {
    const result = filterMessagesThinkingBlocks(
      [
        {
          role: "assistant",
          content: [{ type: "thinking", thinking: "reasoning", signature: "foreign-signature" }],
        },
      ],
      "scope",
      () => undefined,
      true,
      { keepThinking: true },
    )

    expect(result[0].content[0]).toEqual({
      type: "thinking",
      thinking: "reasoning",
      signature: SKIP_THOUGHT_SIGNATURE,
    })
  })

  it("strips Claude thinking by default", () => {
    const result = filterMessagesThinkingBlocks(
      [
        {
          role: "assistant",
          content: [{ type: "thinking", thinking: "reasoning", signature: "provider-signature" }],
        },
      ],
      "scope",
      () => "provider-signature".padEnd(64, "x"),
      true,
      { keepThinking: false },
    )

    expect(result[0].content).toEqual([])
  })
})
