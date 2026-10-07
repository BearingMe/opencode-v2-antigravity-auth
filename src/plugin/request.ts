import { createHash, randomUUID } from "node:crypto"
import { ANTIGRAVITY_ENDPOINT, getRandomizedHeaders } from "../constants"
import {
  createInferencePipeline,
  type InferenceRequestOptions,
  type PreparedInferenceRequest,
} from "../modules/inference/index.js"
import {
  buildFingerprintHeaders,
  getSessionFingerprint,
  type Fingerprint,
} from "../adapters/antigravity/fingerprint.js"
import { processImageData } from "../adapters/filesystem/image-saver.js"
import { getKeepThinking } from "../adapters/opencode/config/index.js"
import {
  DEBUG_MESSAGE_PREFIX,
  isDebugTuiEnabled,
  logAntigravityDebugResponse,
  logCacheStats,
  type AntigravityDebugContext,
} from "./debug"
import { createLogger } from "./logger"

const log = createLogger("request")

const inferencePipeline = createInferencePipeline<Fingerprint, AntigravityDebugContext>({
  endpoint: ANTIGRAVITY_ENDPOINT,
  debugMessagePrefix: DEBUG_MESSAGE_PREFIX,
  createRequestId: randomUUID,
  hashConversationSeed: (seed) => createHash("sha256").update(seed, "utf8").digest("hex").slice(0, 16),
  getUserAgent: (fingerprint) => {
    const randomizedUserAgent = getRandomizedHeaders()["User-Agent"]
    const activeFingerprint = fingerprint ?? getSessionFingerprint()
    return buildFingerprintHeaders(activeFingerprint)["User-Agent"] || randomizedUserAgent
  },
  keepThinking: () => getKeepThinking(),
  debugTuiEnabled: isDebugTuiEnabled,
  imageAspectRatio: () => process.env.OPENCODE_IMAGE_ASPECT_RATIO,
  processImageData,
  debug: (message, fields) => log.debug(message, fields),
  warn: (message, fields) => log.warn(message, fields),
  logResponse: logAntigravityDebugResponse,
  logCacheStats,
})

/** Options retained by the plugin-facing request compatibility API. */
export type PrepareRequestOptions = InferenceRequestOptions<Fingerprint>

/** Returns the session identifier used for inference signature caching. */
export function getPluginSessionId(): string {
  return inferencePipeline.getPluginSessionId()
}

/** Detects requests headed to the Google Generative Language API. */
export function isGenerativeLanguageRequest(input: RequestInfo): boolean {
  return inferencePipeline.isGenerativeLanguageRequest(input)
}

/** Rejects OAuth model IDs that require a Google API-key connection. */
export function assertAntigravityModelSupported(model: string): void {
  inferencePipeline.assertAntigravityModelSupported(model)
}

/** Prepares a Generative Language request for the Antigravity wire protocol. */
export function prepareAntigravityRequest(
  input: RequestInfo,
  init: RequestInit | undefined,
  accessToken: string,
  projectId: string,
  endpointOverride?: string,
  forceThinkingRecovery = false,
  options?: PrepareRequestOptions,
): PreparedInferenceRequest {
  return inferencePipeline.prepareAntigravityRequest(
    input,
    init,
    accessToken,
    projectId,
    endpointOverride,
    forceThinkingRecovery,
    options,
  )
}

/** Builds the minimal Claude request used to obtain a reusable thinking signature. */
export function buildThinkingWarmupBody(bodyText: string | undefined, isClaudeThinking: boolean): string | null {
  return inferencePipeline.buildThinkingWarmupBody(bodyText, isClaudeThinking)
}

/** Normalizes provider response bodies while preserving streaming behavior. */
export function transformAntigravityResponse(
  response: Response,
  streaming: boolean,
  debugContext?: AntigravityDebugContext | null,
  requestedModel?: string,
  projectId?: string,
  endpoint?: string,
  effectiveModel?: string,
  sessionId?: string,
  toolDebugMissing?: number,
  toolDebugSummary?: string,
  toolDebugPayload?: string,
  debugLines?: string[],
): Promise<Response> {
  return inferencePipeline.transformAntigravityResponse(
    response,
    streaming,
    debugContext,
    requestedModel,
    projectId,
    endpoint,
    effectiveModel,
    sessionId,
    toolDebugMissing,
    toolDebugSummary,
    toolDebugPayload,
    debugLines,
  )
}
