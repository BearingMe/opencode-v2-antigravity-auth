/** Compatibility exports for callers of the previous cross-model sanitizer path. */
export {
  deepSanitizeCrossModelMetadata,
  getCrossModelFamily as getModelFamily,
  sanitizeCrossModelPayload,
  sanitizeCrossModelPayloadInPlace,
  stripClaudeThinkingFields,
  stripGeminiThinkingMetadata,
} from "../../modules/inference/index.js"
export type { SanitizationResult, SanitizerOptions } from "../../modules/inference/index.js"
