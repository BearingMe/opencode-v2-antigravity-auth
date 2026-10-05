import type { ThoughtBuffer } from "../core/streaming/types"

/** Compatibility exports for the inference-owned signed-thinking store. */
export { createSignatureStore, defaultSignatureStore } from "../../modules/inference/index.js"
export type { SignatureStore, SignedThinking } from "../../modules/inference/index.js"

/** Creates an isolated numeric-index buffer used while assembling streamed thoughts. */
export function createThoughtBuffer(): ThoughtBuffer {
  const buffer = new Map<number, string>()

  return {
    get: (index) => buffer.get(index),
    set: (index, text) => {
      buffer.set(index, text)
    },
    clear: () => buffer.clear(),
  }
}
