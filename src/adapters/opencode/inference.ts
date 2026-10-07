import type { InferenceApi } from "../../modules/inference/index.js"
import { getModelFamily } from "../../modules/inference/index.js"
import type { Fingerprint } from "../antigravity/fingerprint.js"
import {
  assertAntigravityModelSupported,
  buildThinkingWarmupBody,
  prepareAntigravityRequest,
  transformAntigravityResponse,
} from "../../plugin/request.js"
import type { AntigravityDebugContext } from "./debug.js"

/** Inference operations composed with the OpenCode plugin's runtime adapters. */
export const openCodeInference: InferenceApi<Fingerprint, AntigravityDebugContext> = {
  /** Classifies the model once for downstream account policy. */
  classifyModel(model) {
    const quotaGroup = getModelFamily(model)
    return {
      model,
      family: quotaGroup === "claude" ? "claude" : "gemini",
      quotaGroup,
    }
  },
  /** Rejects model IDs that are outside the configured Antigravity catalog. */
  assertModelSupported(model) {
    assertAntigravityModelSupported(model)
  },
  /** Builds the small Claude request used to prime thinking signatures. */
  buildThinkingWarmupBody(bodyText, isClaudeThinking) {
    return buildThinkingWarmupBody(bodyText, isClaudeThinking)
  },
  /** Prepares a request with the existing Antigravity transform pipeline. */
  prepareRequest(input) {
    return prepareAntigravityRequest(
      input.input,
      input.init,
      input.accessToken,
      input.projectId,
      input.endpointOverride,
      input.forceThinkingRecovery,
      input.options,
    )
  },
  /** Normalizes the response with the existing streaming-aware transform. */
  transformResponse(input) {
    return transformAntigravityResponse(
      input.response,
      input.streaming,
      input.debugContext,
      input.requestedModel,
      input.projectId,
      input.endpoint,
      input.effectiveModel,
      input.sessionId,
      input.toolDebugMissing,
      input.toolDebugSummary,
      input.toolDebugPayload,
      input.debugLines,
    )
  },
}
