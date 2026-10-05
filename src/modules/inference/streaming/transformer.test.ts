import { describe, expect, it, vi } from "vitest"
import { createSignatureStore } from "../signature-store.js"
import { createStreamingTransformer } from "./transformer.js"

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
})
