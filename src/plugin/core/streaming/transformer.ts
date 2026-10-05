import { processImageData } from "../../image-saver"
import {
  createStreamingTransformer as createInferenceStreamingTransformer,
  deduplicateThinkingText as deduplicateInferenceThinkingText,
  transformSseLine as transformInferenceSseLine,
  type SignatureStore,
  type StreamingCallbacks,
  type StreamingOptions,
  type ThoughtBuffer,
} from "../../../modules/inference/index.js"

export {
  createThoughtBuffer,
  transformStreamingPayload,
  cacheThinkingSignaturesFromResponse,
} from "../../../modules/inference/index.js"
export type {
  SignatureStore,
  SignedThinking,
  StreamingCallbacks,
  StreamingOptions,
  ThoughtBuffer,
} from "../../../modules/inference/index.js"

/** Preserves the previous plugin API while keeping image persistence in its adapter. */
export function createStreamingTransformer(
  signatureStore: SignatureStore,
  callbacks: StreamingCallbacks,
  options: StreamingOptions = {},
): TransformStream<Uint8Array, Uint8Array> {
  return createInferenceStreamingTransformer(
    signatureStore,
    { ...callbacks, processImageData: callbacks.processImageData ?? processImageData },
    options,
  )
}

/** Preserves image conversion for callers of the old single-line transform API. */
export function transformSseLine(
  line: string,
  signatureStore: SignatureStore,
  thoughtBuffer: ThoughtBuffer,
  sentThinkingBuffer: ThoughtBuffer,
  callbacks: StreamingCallbacks,
  options: StreamingOptions,
  debugState: { injected: boolean },
): string {
  return transformInferenceSseLine(
    line,
    signatureStore,
    thoughtBuffer,
    sentThinkingBuffer,
    { ...callbacks, processImageData: callbacks.processImageData ?? processImageData },
    options,
    debugState,
  )
}

/** Preserves image conversion for callers of the old reasoning deduplicator. */
export function deduplicateThinkingText(
  response: unknown,
  sentBuffer: ThoughtBuffer,
  displayedThinkingHashes?: Set<string>,
): unknown {
  return deduplicateInferenceThinkingText(response, sentBuffer, displayedThinkingHashes, processImageData)
}
