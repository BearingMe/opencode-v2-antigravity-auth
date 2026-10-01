import type { HeaderStyle } from "../../constants"

export type ModelFamily = "claude" | "gemini-flash" | "gemini-pro"

export type ThinkingTier = "low" | "medium" | "high"

/**
 * Context for request transformation.
 * Contains all information needed to transform a request payload.
 */
export interface TransformContext {
  projectId: string

  model: string

  requestedModel: string

  family: ModelFamily

  streaming: boolean

  requestId: string

  sessionId?: string

  thinkingTier?: ThinkingTier

  thinkingBudget?: number

  thinkingLevel?: string
}

/**
 * Result of request transformation.
 */
export interface TransformResult {
  body: string

  debugInfo: TransformDebugInfo
}

/**
 * Debug information from transformation.
 */
export interface TransformDebugInfo {
  transformer: "claude" | "gemini"

  toolCount: number

  toolsTransformed?: boolean

  thinkingTier?: string

  thinkingBudget?: number

  thinkingLevel?: string
}

/**
 * Generic request payload type.
 * The actual structure varies between Claude and Gemini.
 */
export type RequestPayload = Record<string, unknown>

/**
 * Thinking configuration normalized from various input formats.
 */
export interface ThinkingConfig {
  thinkingBudget?: number

  thinkingLevel?: string

  includeThoughts?: boolean

  include_thoughts?: boolean
}

/**
 * Google Search Grounding configuration.
 *
 * Note: The new googleSearch API for Gemini 2.0+ does not support threshold
 * configuration. The model automatically decides when to search.
 * The threshold field is kept for backward compatibility but is ignored.
 */
export interface GoogleSearchConfig {
  mode?: "auto" | "off"

  threshold?: number
}

/**
 * Model resolution result with tier information.
 */
export interface ResolvedModel {
  actualModel: string

  thinkingLevel?: string

  thinkingBudget?: number

  tier?: ThinkingTier

  isThinkingModel?: boolean

  isImageModel?: boolean

  quotaPreference?: HeaderStyle

  explicitQuota?: boolean

  configSource?: "variant" | "tier"

  googleSearch?: GoogleSearchConfig
}
