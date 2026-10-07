import { processImageData } from "../adapters/filesystem/image-saver.js"
import { createLogger } from "../adapters/opencode/logger.js"
import { getKeepThinking } from "../adapters/opencode/config/index.js"
import {
  applyToolPairingFixes as applyInferenceToolPairingFixes,
  deepFilterThinkingBlocks as filterInferencePayload,
  filterMessagesThinkingBlocks as filterInferenceMessages,
  filterUnsignedThinkingBlocks as filterInferenceContents,
  fixToolResponseGrouping as fixInferenceToolResponseGrouping,
  recursivelyParseJsonStrings as parseInferenceJsonStrings,
  transformThinkingParts as transformInferenceThinkingParts,
  validateAndFixClaudeToolPairing as fixInferenceClaudeToolPairing,
} from "../modules/inference/index.js"

export {
  DEFAULT_THINKING_BUDGET,
  createStreamingChunkCounter,
  createSyntheticErrorResponse,
  detectToolIdMismatches,
  extractThinkingConfig,
  extractUsageFromSsePayload,
  extractUsageMetadata,
  extractVariantThinkingConfig,
  findOrphanedToolUseIds,
  fixClaudeToolPairing,
  injectParameterSignatures,
  injectToolHardeningInstruction,
  isEmptyResponseBody,
  isMeaningfulSseLine,
  isThinkingCapableModel,
  matchResponseIdsToContents,
  normalizeThinkingConfig,
  parseAntigravityApiBody,
  resolveThinkingConfig,
  rewriteAntigravityPreviewAccessError,
  assignToolIdsToContents,
} from "../modules/inference/index.js"
export type {
  AntigravityApiBody,
  AntigravityApiError,
  AntigravityUsageMetadata,
  RequestThinkingConfig as ThinkingConfig,
  StreamingChunkCounter,
  VariantThinkingConfig,
} from "../modules/inference/index.js"
export { cleanJSONSchemaForAntigravity } from "../modules/inference/index.js"

const log = createLogger("request-helpers")

/** Adapts the inference filter to host thinking settings and plugin diagnostics. */
export function filterUnsignedThinkingBlocks(
  contents: any[],
  sessionId?: string,
  getCachedSignatureFn?: (sessionId: string, text: string) => string | undefined,
  isClaudeModel?: boolean,
): any[] {
  return filterInferenceContents(contents, sessionId, getCachedSignatureFn, isClaudeModel, {
    keepThinking: getKeepThinking(),
    onDebug: (message) => log.debug(message),
  })
}

/** Adapts the inference filter to host thinking settings and plugin diagnostics. */
export function filterMessagesThinkingBlocks(
  messages: any[],
  sessionId?: string,
  getCachedSignatureFn?: (sessionId: string, text: string) => string | undefined,
  isClaudeModel?: boolean,
): any[] {
  return filterInferenceMessages(messages, sessionId, getCachedSignatureFn, isClaudeModel, {
    keepThinking: getKeepThinking(),
    onDebug: (message) => log.debug(message),
  })
}

/** Adapts the inference filter to host thinking settings and plugin diagnostics. */
export function deepFilterThinkingBlocks(
  payload: unknown,
  sessionId?: string,
  getCachedSignatureFn?: (sessionId: string, text: string) => string | undefined,
  isClaudeModel?: boolean,
): unknown {
  return filterInferencePayload(payload, sessionId, getCachedSignatureFn, isClaudeModel, {
    keepThinking: getKeepThinking(),
    onDebug: (message) => log.debug(message),
  })
}

/** Keeps image persistence in the plugin adapter while inference transforms response parts. */
export function transformThinkingParts(response: unknown): unknown {
  return transformInferenceThinkingParts(response, {
    processImageData,
    onDebug: (message, fields) => log.debug(message, fields),
  })
}

/** Adapts malformed-tool diagnostics to the plugin logger. */
export function recursivelyParseJsonStrings(value: unknown, skipParseKeys?: Set<string>, currentKey?: string): unknown {
  return parseInferenceJsonStrings(value, skipParseKeys, currentKey, (message, fields) => log.debug(message, fields))
}

/** Adapts tool-response repair diagnostics to the plugin logger. */
export function fixToolResponseGrouping(contents: any[]): any[] {
  return fixInferenceToolResponseGrouping(contents, (message, fields) => log.debug(message, fields))
}

/** Adapts Claude tool-pairing warnings to the plugin logger. */
export function validateAndFixClaudeToolPairing(messages: any[]): any[] {
  return fixInferenceClaudeToolPairing(messages, (message, fields) => log.warn(message, fields))
}

/** Adapts tool-pairing diagnostics to the plugin logger. */
export function applyToolPairingFixes(
  payload: Record<string, unknown>,
  isClaude: boolean,
): { contentsFixed: boolean; messagesFixed: boolean } {
  return applyInferenceToolPairingFixes(payload, isClaude, {
    onDebug: (message, fields) => log.debug(message, fields),
    onWarn: (message, fields) => log.warn(message, fields),
  })
}
