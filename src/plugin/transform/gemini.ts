/** Compatibility exports for callers of the previous Gemini transform path. */
export {
  VALID_IMAGE_ASPECT_RATIOS,
  applyGeminiTransforms,
  buildGemini25ThinkingConfig,
  buildGemini3ThinkingConfig,
  buildImageGenerationConfig,
  isGemini25Model,
  isGemini3Model,
  isGeminiModel,
  isImageGenerationModel,
  isValidImageAspectRatio,
  normalizeGeminiTools,
  toGeminiSchema,
  wrapToolsAsFunctionDeclarations,
} from "../../modules/inference/index.js"
export type {
  GeminiTransformOptions,
  GeminiTransformResult,
  ImageConfig,
  WrapToolsResult,
} from "../../modules/inference/index.js"
