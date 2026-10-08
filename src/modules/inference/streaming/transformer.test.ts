import { describe, expect, it, vi } from "vitest"
import { createSignatureStore } from "../signature-store.js"
import {
  createThoughtBuffer,
  createStreamingTransformer,
  deduplicateThinkingText,
  transformSseLine,
  transformStreamingPayload,
} from "./transformer.js"

/** Transforms one SSE line with isolated signature and thought state. */
function transformOneSseLine(line: string): string {
  return transformSseLine(
    line,
    createSignatureStore(),
    createThoughtBuffer(),
    createThoughtBuffer(),
    {},
    {},
    { injected: false },
  )
}

describe("inference SSE transform", () => {
  it("buffers split data lines and preserves events while normalizing reasoning", async () => {
    const transformer = createStreamingTransformer(createSignatureStore(), {
      transformThinkingParts(response) {
        const body = response as { candidates?: Array<{ content?: { parts?: unknown[] } }> }
        return { ...body, normalized: true }
      },
    })
    const writer = transformer.writable.getWriter()
    const reader = transformer.readable.getReader()
    const encoder = new TextEncoder()
    const decoder = new TextDecoder()
    const readOutput = (async () => {
      let output = ""
      while (true) {
        const { done, value } = await reader.read()
        if (done) return output
        output += decoder.decode(value)
      }
    })()

    await writer.write(encoder.encode('event: message\ndata: {"response":{"candidates":['))
    await writer.write(encoder.encode('{"content":{"parts":[{"text":"ok"}]}}]}}\n'))
    await writer.write(encoder.encode("data: [DONE]\n"))
    await writer.close()

    const output = await readOutput
    expect(output).toContain("event: message")
    expect(output).toContain('"normalized":true')
    expect(output).toContain("data: [DONE]")
    expect(output).toContain('"usageMetadata"')
  })

  it("uses injected image processing without importing filesystem behavior", async () => {
    const processImageData = vi.fn(() => "file:///tmp/generated.png")
    const transformer = createStreamingTransformer(
      createSignatureStore(),
      { processImageData },
      { cacheSignatures: false },
    )
    const writer = transformer.writable.getWriter()
    const reader = transformer.readable.getReader()
    const payload = {
      response: {
        candidates: [{ content: { parts: [{ inlineData: { mimeType: "image/png", data: "c3ludGhldGlj" } }] } }],
      },
    }
    const outputPromise = (async () => {
      const chunks: Uint8Array[] = []
      while (true) {
        const { done, value } = await reader.read()
        if (done) return chunks
        if (value) chunks.push(value)
      }
    })()

    await writer.write(new TextEncoder().encode(`data: ${JSON.stringify(payload)}\n`))
    await writer.close()
    const output = (await outputPromise).map((chunk) => new TextDecoder().decode(chunk)).join("")

    expect(processImageData).toHaveBeenCalledWith({ mimeType: "image/png", data: "c3ludGhldGlj" })
    expect(output).toContain("file:///tmp/generated.png")
  })

  it("leaves non-data lines and malformed SSE data unchanged", () => {
    expect(transformOneSseLine("")).toBe("")
    expect(transformOneSseLine(": heartbeat")).toBe(": heartbeat")
    expect(transformOneSseLine("data: [DONE]")).toBe("data: [DONE]")
    expect(transformOneSseLine("data: not-json")).toBe("data: not-json")
  })

  it("transforms valid JSON data while preserving non-thinking content", () => {
    const payload = { response: { candidates: [{ content: { parts: [{ text: "hello" }] } }] } }
    const transformed = transformOneSseLine(`data: ${JSON.stringify(payload)}`)

    expect(transformed).toContain('"text":"hello"')
  })

  it("returns non-data payload lines unchanged", () => {
    expect(transformStreamingPayload("event: ping")).toBe("event: ping")
    expect(transformStreamingPayload("event: message\ndata: [DONE]\n")).toContain("data: [DONE]")
  })

  it("transforms response payloads without changing other SSE lines", () => {
    const payload = { response: { candidates: [{ content: { parts: [{ text: "hello" }] } }] } }
    const input = `event: message\ndata: ${JSON.stringify(payload)}`
    const output = transformStreamingPayload(input, (response) => ({ response, transformed: true }))

    expect(output).toContain("event: message")
    expect(output).toContain('"transformed":true')
    expect(output.split("\n")).toHaveLength(2)
  })

  describe("thinking delta deduplication", () => {
    it("returns non-object input unchanged", () => {
      const buffer = createThoughtBuffer()
      expect(deduplicateThinkingText(null, buffer)).toBeNull()
      expect(deduplicateThinkingText(undefined, buffer)).toBeUndefined()
      expect(deduplicateThinkingText("string", buffer)).toBe("string")
    })

    it("emits only the newly accumulated Gemini thinking text", () => {
      const buffer = createThoughtBuffer()
      const first = { candidates: [{ content: { parts: [{ thought: true, text: "Hello " }] } }] }
      const second = { candidates: [{ content: { parts: [{ thought: true, text: "Hello world" }] } }] }

      expect(deduplicateThinkingText(first, buffer)).toMatchObject({
        candidates: [{ content: { parts: [{ text: "Hello " }] } }],
      })
      expect(deduplicateThinkingText(second, buffer)).toMatchObject({
        candidates: [{ content: { parts: [{ text: "world" }] } }],
      })
    })

    it("removes repeated thinking parts while preserving text and tool calls", () => {
      const buffer = createThoughtBuffer()
      const first = {
        candidates: [{ content: { parts: [{ thought: true, text: "Complete thought" }] } }],
      }
      const repeated = {
        candidates: [
          {
            content: {
              parts: [
                { thought: true, text: "Complete thought" },
                { text: "Regular text" },
                { functionCall: { name: "search" } },
              ],
            },
          },
        ],
      }
      deduplicateThinkingText(first, buffer)
      expect(deduplicateThinkingText(repeated, buffer)).toMatchObject({
        candidates: [{ content: { parts: [{ text: "Regular text" }, { functionCall: { name: "search" } }] } }],
      })
    })

    it("emits only the newly accumulated Claude thinking text", () => {
      const buffer = createThoughtBuffer()
      expect(deduplicateThinkingText({ content: [{ type: "thinking", thinking: "First " }] }, buffer)).toMatchObject({
        content: [{ thinking: "First " }],
      })
      expect(
        deduplicateThinkingText({ content: [{ type: "thinking", thinking: "First part" }] }, buffer),
      ).toMatchObject({
        content: [{ thinking: "part" }],
      })
    })

    it("starts a fresh delta when thinking text no longer has the previous prefix", () => {
      const buffer = createThoughtBuffer()
      deduplicateThinkingText(
        { candidates: [{ content: { parts: [{ thought: true, text: "Old thought" }] } }] },
        buffer,
      )

      expect(
        deduplicateThinkingText(
          { candidates: [{ content: { parts: [{ thought: true, text: "New thought" }] } }] },
          buffer,
        ),
      ).toMatchObject({ candidates: [{ content: { parts: [{ text: "New thought" }] } }] })
    })
  })
})
