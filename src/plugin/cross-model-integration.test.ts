import { describe, it, expect } from "vitest"
import { sanitizeCrossModelPayload } from "./transform/cross-model-sanitizer"

/**
 * Builds a multi-turn Gemini history payload with thinking and tool call metadata.
 */
function buildGeminiHistoryPayload(
  options: {
    thoughtSignature?: string
    toolName?: string
    additionalUserTurn?: boolean
    model?: string
  } = {},
) {
  const sig = options.thoughtSignature ?? "EsgQCsUQAXLI2nybuafAE150LGTo2r78fakesig"
  const tool = options.toolName ?? "bash"

  const contents: Array<Record<string, unknown>> = [
    {
      role: "user",
      parts: [{ text: "Check disk space. Think about which filesystems are most utilized." }],
    },
    {
      role: "model",
      parts: [
        {
          thought: true,
          text: "I need to analyze disk usage...",
          thoughtSignature: sig,
        },
        {
          functionCall: { name: tool, args: { command: "df -h" } },
          metadata: {
            google: {
              thoughtSignature: sig,
            },
          },
        },
      ],
    },
    {
      role: "function",
      parts: [
        {
          functionResponse: {
            name: tool,
            response: { output: "Filesystem Size Used Avail Use%..." },
          },
        },
      ],
    },
    {
      role: "model",
      parts: [{ text: "The root filesystem is 62% utilized..." }],
    },
  ]

  if (options.additionalUserTurn) {
    contents.push({
      role: "user",
      parts: [{ text: "Now check memory usage with free -h" }],
    })
  }

  const payload: Record<string, unknown> = { contents }
  if (options.model) {
    payload.model = options.model
  }
  return payload
}

/**
 * Builds an Anthropic Claude message payload containing thinking and tool blocks.
 */
function buildClaudeMessagesPayload(
  options: {
    signature?: string
    thinking?: string
    toolName?: string
    wrappedInExtraBody?: boolean
  } = {},
) {
  const sig = options.signature ?? "claude-signature-abc123VeryLongSignatureStringThatExceeds50Characters"
  const thinkingText = options.thinking ?? "Analyzing the request..."
  const tool = options.toolName ?? "bash"

  const messages = [
    {
      role: "assistant",
      content: [
        {
          type: "thinking",
          thinking: thinkingText,
          signature: sig,
        },
        {
          type: "tool_use",
          id: "tool_1",
          name: tool,
          input: { command: "ls" },
        },
      ],
    },
  ]

  return options.wrappedInExtraBody ? { extra_body: { messages } } : { messages }
}

describe("Cross-Model Session Integration", () => {
  describe("Gemini → Claude model switch with tool calls", () => {
    it("sanitizes Gemini thinking metadata when preparing Claude request", () => {
      const payload = buildGeminiHistoryPayload({
        model: "claude-opus-4-6-thinking-medium",
        additionalUserTurn: true,
      })

      const result = sanitizeCrossModelPayload(payload, {
        targetModel: "claude-opus-4-6-thinking-medium",
      })

      const sanitized = result.payload as typeof payload
      const modelParts = (sanitized.contents as Array<{ parts: Array<Record<string, unknown>> }>)[1]!.parts

      expect(modelParts[0]!.thoughtSignature).toBeUndefined()
      expect(modelParts[1]!.metadata).toBeUndefined()
      expect((modelParts[1]!.functionCall as { name: string }).name).toBe("bash")

      expect(result.modified).toBe(true)
      expect(result.signaturesStripped).toBeGreaterThan(0)
    })

    it("preserves non-signature metadata", () => {
      const payload = {
        contents: [
          {
            role: "model",
            parts: [
              {
                functionCall: { name: "read", args: { path: "/etc/passwd" } },
                metadata: {
                  google: {
                    thoughtSignature: "should-be-stripped",
                    groundingMetadata: { searchQueries: ["test"] },
                    searchEntryPoint: { renderedContent: "test" },
                  },
                  cache_control: { type: "ephemeral" },
                },
              },
            ],
          },
        ],
      }

      const result = sanitizeCrossModelPayload(payload, {
        targetModel: "claude-sonnet-4",
        preserveNonSignatureMetadata: true,
      })

      const sanitized = result.payload as typeof payload
      const partMeta = (sanitized.contents[0]!.parts![0] as Record<string, unknown>).metadata as Record<string, unknown>
      const googleMeta = partMeta.google as Record<string, unknown>

      expect(googleMeta.thoughtSignature).toBeUndefined()
      expect(googleMeta.groundingMetadata).toEqual({ searchQueries: ["test"] })
      expect(googleMeta.searchEntryPoint).toEqual({ renderedContent: "test" })
      expect((partMeta.cache_control as Record<string, unknown>).type).toBe("ephemeral")
    })

    it("handles the exact bug reproduction scenario from issue", () => {
      const longSig = "EsgQCsUQAXLI2nybuafAE150LGTo2r78VeryLongSignatureStringThatExceeds50Characters"
      const payload = {
        model: "claude-opus-4-6-thinking-medium",
        contents: [
          {
            role: "user",
            parts: [
              {
                text: "Check how much disk space is available using df -h. Think about which filesystems are most utilized.",
              },
            ],
          },
          {
            role: "model",
            parts: [
              {
                thought: true,
                text: "Let me analyze the disk space request. The user wants to see disk usage and understand filesystem utilization patterns...",
                thoughtSignature: longSig,
              },
              {
                functionCall: {
                  name: "Bash",
                  args: {
                    command: "df -h",
                    description: "Check disk space availability",
                  },
                },
                metadata: {
                  google: {
                    thoughtSignature: longSig,
                  },
                },
              },
            ],
          },
          {
            role: "function",
            parts: [
              {
                functionResponse: {
                  name: "Bash",
                  response: {
                    output:
                      "Filesystem      Size  Used Avail Use% Mounted on\noverlay          59G   37G   20G  65% /\ntmpfs            64M     0   64M   0% /dev\n",
                  },
                },
              },
            ],
          },
          {
            role: "model",
            parts: [
              {
                text: "Based on the disk space analysis, the root overlay filesystem is 65% utilized with 37G used out of 59G total.",
              },
            ],
          },
          {
            role: "user",
            parts: [{ text: "Now check memory usage with free -h" }],
          },
        ],
      }

      const result = sanitizeCrossModelPayload(payload, {
        targetModel: "claude-opus-4-6-thinking-medium",
      })

      const sanitized = result.payload as typeof payload

      const thinkingPart = sanitized.contents[1]!.parts![0] as Record<string, unknown>
      expect(thinkingPart.thoughtSignature).toBeUndefined()
      expect(thinkingPart.thought).toBe(true)
      expect(thinkingPart.text).toContain("analyze the disk space")

      const toolPart = sanitized.contents[1]!.parts![1] as Record<string, unknown>
      expect(toolPart.metadata).toBeUndefined()
      expect((toolPart.functionCall as Record<string, unknown>).name).toBe("Bash")

      expect(result.signaturesStripped).toBe(2)
    })
  })

  describe("Claude → Gemini model switch", () => {
    it("sanitizes Claude thinking blocks when preparing Gemini request", () => {
      const payload = buildClaudeMessagesPayload({ wrappedInExtraBody: true })

      const result = sanitizeCrossModelPayload(payload, {
        targetModel: "gemini-3-pro-low",
      })

      const sanitized = result.payload as typeof payload
      const content = sanitized.extra_body!.messages![0]!.content
      const thinkingBlock = content.find((c: Record<string, unknown>) => c.type === "thinking") as Record<
        string,
        unknown
      >

      expect(thinkingBlock.signature).toBeUndefined()
      expect(thinkingBlock.thinking).toBe("Analyzing the request...")

      const toolBlock = content.find((c: Record<string, unknown>) => c.type === "tool_use") as Record<string, unknown>
      expect(toolBlock.name).toBe("bash")
    })

    it("strips redacted_thinking blocks", () => {
      const payload = {
        messages: [
          {
            role: "assistant",
            content: [
              {
                type: "redacted_thinking",
                data: "encrypted_data_here",
                signature: "redacted-sig-VeryLongSignatureStringThatExceeds50Characters",
              },
              { type: "text", text: "Here is my response" },
            ],
          },
        ],
      }

      const result = sanitizeCrossModelPayload(payload, {
        targetModel: "gemini-3-flash",
      })

      const sanitized = result.payload as typeof payload
      const redactedBlock = sanitized.messages![0]!.content![0] as Record<string, unknown>

      expect(redactedBlock.signature).toBeUndefined()
      expect(redactedBlock.type).toBe("redacted_thinking")
    })
  })

  describe("Same model family - no sanitization needed", () => {
    it("preserves Gemini signatures when staying on Gemini", () => {
      const payload = {
        contents: [
          {
            role: "model",
            parts: [
              {
                thought: true,
                text: "thinking...",
                thoughtSignature: "valid-gemini-sig",
              },
            ],
          },
        ],
      }

      const result = sanitizeCrossModelPayload(payload, {
        targetModel: "gemini-3-flash",
      })

      const sanitized = result.payload as typeof payload
      expect((sanitized.contents![0]!.parts![0] as Record<string, unknown>).thoughtSignature).toBe("valid-gemini-sig")
      expect(result.modified).toBe(false)
    })

    it("preserves Claude signatures when staying on Claude", () => {
      const payload = {
        messages: [
          {
            role: "assistant",
            content: [
              {
                type: "thinking",
                thinking: "analyzing...",
                signature: "valid-claude-sig",
              },
            ],
          },
        ],
      }

      const result = sanitizeCrossModelPayload(payload, {
        targetModel: "claude-opus-4-6-thinking-low",
      })

      const sanitized = result.payload as typeof payload
      expect((sanitized.messages![0]!.content![0] as Record<string, unknown>).signature).toBe("valid-claude-sig")
      expect(result.modified).toBe(false)
    })
  })

  describe("Edge cases", () => {
    it("handles empty payloads", () => {
      const result = sanitizeCrossModelPayload({}, { targetModel: "claude-sonnet-4" })
      expect(result.modified).toBe(false)
      expect(result.signaturesStripped).toBe(0)
    })

    it("handles null/undefined parts gracefully", () => {
      const payload = {
        contents: [{ role: "user", parts: null }, { role: "model", parts: undefined }, { role: "model" }],
      }

      const result = sanitizeCrossModelPayload(payload, {
        targetModel: "claude-sonnet-4",
      })

      expect(result.modified).toBe(false)
    })

    it("handles wrapped requests array (batch format)", () => {
      const payload = {
        requests: [
          {
            contents: [
              {
                role: "model",
                parts: [
                  {
                    thoughtSignature: "sig1",
                    thought: true,
                    text: "thinking",
                  },
                ],
              },
            ],
          },
          {
            contents: [
              {
                role: "model",
                parts: [
                  {
                    metadata: { google: { thoughtSignature: "sig2" } },
                    functionCall: { name: "test" },
                  },
                ],
              },
            ],
          },
        ],
      }

      const result = sanitizeCrossModelPayload(payload, {
        targetModel: "claude-sonnet-4-6",
      })

      const sanitized = result.payload as typeof payload

      expect(
        (sanitized.requests![0]!.contents![0]!.parts![0] as Record<string, unknown>).thoughtSignature,
      ).toBeUndefined()
      expect((sanitized.requests![1]!.contents![0]!.parts![0] as Record<string, unknown>).metadata).toBeUndefined()
      expect(result.signaturesStripped).toBe(2)
    })

    it("handles unknown target model by skipping sanitization", () => {
      const payload = {
        contents: [
          {
            role: "model",
            parts: [{ thoughtSignature: "sig", thought: true, text: "hi" }],
          },
        ],
      }

      const result = sanitizeCrossModelPayload(payload, {
        targetModel: "gpt-4-turbo",
      })

      const sanitized = result.payload as typeof payload
      expect((sanitized.contents![0]!.parts![0] as Record<string, unknown>).thoughtSignature).toBe("sig")
      expect(result.modified).toBe(false)
    })
  })
})
