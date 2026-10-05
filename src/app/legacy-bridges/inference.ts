import type { InferenceApi } from "../../modules/inference/index.js"
import { getModelFamily } from "../../modules/inference/index.js"
import type { Fingerprint } from "../../plugin/fingerprint.js"
import { prepareAntigravityRequest, transformAntigravityResponse } from "../../plugin/request.js"
import type { AntigravityDebugContext } from "../../plugin/debug.js"

/**
 * Implements the inference contract using the still-location-bound pipeline.
 *
 * @example `legacyInference.prepareRequest(request)`
 */
export const legacyInference: InferenceApi<Fingerprint, AntigravityDebugContext> = {
  /** Classifies the model once for downstream account policy. */
  classifyModel(model) {
    const quotaGroup = getModelFamily(model)
    return {
      model,
      family: quotaGroup === "claude" ? "claude" : "gemini",
      quotaGroup,
    }
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
