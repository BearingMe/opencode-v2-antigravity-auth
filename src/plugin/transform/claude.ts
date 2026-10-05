/** Compatibility exports for callers of the previous Claude transform path. */
export {
  CLAUDE_INTERLEAVED_THINKING_HINT,
  CLAUDE_THINKING_MAX_OUTPUT_TOKENS,
  appendClaudeThinkingHint,
  applyClaudeTransforms,
  buildClaudeThinkingConfig,
  configureClaudeToolConfig,
  ensureClaudeMaxOutputTokens,
  isClaudeModel,
  isClaudeThinkingModel,
  normalizeClaudeTools,
} from "../../modules/inference/index.js"
export type { ClaudeTransformOptions, ClaudeTransformResult } from "../../modules/inference/index.js"
