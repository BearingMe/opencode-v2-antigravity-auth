import type { ResolvedModel, ThinkingTier, GoogleSearchConfig } from "./types"

/**
 * Thinking tier budgets by model family.
 * Claude and Gemini 2.5 Pro use numeric budgets.
 */
export const THINKING_TIER_BUDGETS = {
  claude: { low: 8192, medium: 16384, high: 32768 },
  "gemini-2.5-pro": { low: 8192, medium: 16384, high: 32768 },
  "gemini-2.5-flash": { low: 6144, medium: 12288, high: 24576 },
  default: { low: 4096, medium: 8192, high: 16384 },
} as const

/**
 * Gemini 3 uses thinkingLevel strings instead of numeric budgets.
 * Flash supports: minimal, low, medium, high
 * Pro supports: low, high (no minimal/medium)
 */
export const GEMINI_3_THINKING_LEVELS = ["minimal", "low", "medium", "high"] as const

/**
 * Model aliases - maps user-friendly names to API model names.
 *
 * Format:
 * - Gemini 3 Pro variants: gemini-3-pro-{low,medium,high}
 * - Claude thinking variants: claude-{model}-thinking-{low,medium,high}
 * - Claude non-thinking: claude-{model} (no -thinking suffix)
 */
export const MODEL_ALIASES: Record<string, string> = {
  // Gemini 3 variants - tier suffix selects Antigravity's thinking level.
  "gemini-3-pro-low": "gemini-3-pro",
  "gemini-3-pro-high": "gemini-3-pro",
  "gemini-3.1-pro-low": "gemini-3.1-pro",
  "gemini-3.1-pro-high": "gemini-3.1-pro",
  "gemini-3-flash-low": "gemini-3-flash",
  "gemini-3-flash-medium": "gemini-3-flash",
  "gemini-3-flash-high": "gemini-3-flash",

  // Claude proxy names (gemini- prefix for compatibility)
  "gemini-claude-opus-4-6-thinking-low": "claude-opus-4-6-thinking",
  "gemini-claude-opus-4-6-thinking-medium": "claude-opus-4-6-thinking",
  "gemini-claude-opus-4-6-thinking-high": "claude-opus-4-6-thinking",
  "gemini-claude-sonnet-4-6": "claude-sonnet-4-6",

  // Image generation models - only gemini-3-pro-image is available via Antigravity API
  // Note: gemini-2.5-flash-image (Nano Banana) is NOT supported by Antigravity - only Google AI API
  // Reference: Antigravity-Manager/src-tauri/src/proxy/common/model_mapping.rs
}

const TIER_REGEX = /-(minimal|low|medium|high)$/
const QUOTA_PREFIX_REGEX = /^antigravity-/i
const GEMINI_3_PRO_REGEX = /^gemini-3(?:\.\d+)?-pro/i
const GEMINI_3_FLASH_REGEX = /^gemini-3(?:\.\d+)?-flash/i

// ANTIGRAVITY_ONLY_MODELS removed - all models now default to antigravity

/**
 * Image generation models - always route to Antigravity.
 * These models don't support thinking and require imageConfig.
 */
const IMAGE_GENERATION_MODELS = /image|imagen/i

// Legacy LEGACY_ANTIGRAVITY_GEMINI3 regex removed - all Gemini models now default to antigravity

/**
 * Models that support thinking tier suffixes.
 * Only these models should have -low/-medium/-high stripped as thinking tiers.
 * GPT models like gpt-oss-120b-medium should NOT have -medium stripped.
 */
function supportsThinkingTiers(model: string): boolean {
  const lower = model.toLowerCase()
  return (
    lower.includes("gemini-3") ||
    lower.includes("gemini-2.5") ||
    (lower.includes("claude") && lower.includes("thinking"))
  )
}

/**
 * Extracts thinking tier from model name suffix.
 * Only extracts tier for models that support thinking tiers.
 */
function extractThinkingTierFromModel(model: string): ThinkingTier | undefined {
  // Only extract tier for models that support thinking tiers
  if (!supportsThinkingTiers(model)) {
    return undefined
  }
  const tierMatch = model.match(TIER_REGEX)
  return tierMatch?.[1] as ThinkingTier | undefined
}

/**
 * Determines the budget family for a model.
 */
function getBudgetFamily(model: string): keyof typeof THINKING_TIER_BUDGETS {
  if (model.includes("claude")) {
    return "claude"
  }
  if (model.includes("gemini-2.5-pro")) {
    return "gemini-2.5-pro"
  }
  if (model.includes("gemini-2.5-flash")) {
    return "gemini-2.5-flash"
  }
  return "default"
}

/**
 * Checks if a model is a thinking-capable model.
 */
function isThinkingCapableModel(model: string): boolean {
  const lower = model.toLowerCase()
  return lower.includes("thinking") || lower.includes("gemini-3") || lower.includes("gemini-2.5")
}

function isGemini3ProModel(model: string): boolean {
  return GEMINI_3_PRO_REGEX.test(model)
}

function isGemini3FlashModel(model: string): boolean {
  return GEMINI_3_FLASH_REGEX.test(model)
}

/**
 * Resolves a model name with an optional tier suffix to its Antigravity API
 * model name and corresponding thinking configuration.
 *
 * Examples:
 * - "antigravity-gemini-3-pro-high" → Gemini 3 Pro at the high thinking tier
 * - "claude-opus-4-6-thinking-medium" → Claude Opus with a 16k thinking budget
 */
export function resolveModelWithTier(requestedModel: string): ResolvedModel {
  const isAntigravity = QUOTA_PREFIX_REGEX.test(requestedModel)
  const modelWithoutQuota = requestedModel.replace(QUOTA_PREFIX_REGEX, "")

  const tier = extractThinkingTierFromModel(modelWithoutQuota)
  const baseName = tier ? modelWithoutQuota.replace(TIER_REGEX, "") : modelWithoutQuota

  const isImageModel = IMAGE_GENERATION_MODELS.test(modelWithoutQuota)
  const isGemini3 = modelWithoutQuota.toLowerCase().startsWith("gemini-3")
  const skipAlias = isAntigravity && isGemini3

  // For Antigravity Gemini 3 Pro models without explicit tier, append default tier
  // Antigravity API: gemini-3-pro requires tier suffix (gemini-3-pro-low/high)
  //                  gemini-3-flash uses bare name + thinkingLevel param
  // Pro defaults to -low unless an explicit tier is provided
  const isGemini3Pro = isGemini3ProModel(modelWithoutQuota)
  const isGemini3Flash = isGemini3FlashModel(modelWithoutQuota)

  let antigravityModel = modelWithoutQuota
  if (skipAlias) {
    if (isGemini3Pro && !tier && !isImageModel) {
      antigravityModel = `${modelWithoutQuota}-low`
    } else if (isGemini3Flash && tier) {
      antigravityModel = baseName
    }
  }

  const actualModel = skipAlias
    ? antigravityModel
    : MODEL_ALIASES[modelWithoutQuota] || MODEL_ALIASES[baseName] || baseName

  const resolvedModel = actualModel

  const isThinking = isThinkingCapableModel(resolvedModel)

  // Image generation models don't support thinking - return early without thinking config
  if (isImageModel) {
    return {
      actualModel: resolvedModel,
      isThinkingModel: false,
      isImageModel: true,
    }
  }

  // Check if this is a Gemini 3 model (works for both aliased and skipAlias paths)
  const isEffectiveGemini3 = resolvedModel.toLowerCase().includes("gemini-3")
  const isClaudeThinking =
    resolvedModel.toLowerCase().includes("claude") && resolvedModel.toLowerCase().includes("thinking")

  if (!tier) {
    // Gemini 3 models without explicit tier get a default thinkingLevel
    if (isEffectiveGemini3) {
      return {
        actualModel: resolvedModel,
        thinkingLevel: "low",
        isThinkingModel: true,
      }
    }
    // Claude thinking models without explicit tier get max budget (32768)
    // Per Anthropic docs, budget_tokens is required when enabling extended thinking
    if (isClaudeThinking) {
      return {
        actualModel: resolvedModel,
        thinkingBudget: THINKING_TIER_BUDGETS.claude.high,
        isThinkingModel: true,
      }
    }
    return { actualModel: resolvedModel, isThinkingModel: isThinking }
  }

  // Gemini 3 models with tier always get thinkingLevel set
  if (isEffectiveGemini3) {
    return {
      actualModel: resolvedModel,
      thinkingLevel: tier,
      tier,
      isThinkingModel: true,
    }
  }

  const budgetFamily = getBudgetFamily(resolvedModel)
  const budgets = THINKING_TIER_BUDGETS[budgetFamily]
  const thinkingBudget = budgets[tier]

  return {
    actualModel: resolvedModel,
    thinkingBudget,
    tier,
    isThinkingModel: isThinking,
  }
}

/**
 * Gets the model family for routing decisions.
 */
export function getModelFamily(model: string): "claude" | "gemini-flash" | "gemini-pro" {
  const lower = model.toLowerCase()
  if (lower.includes("claude")) {
    return "claude"
  }
  if (lower.includes("flash")) {
    return "gemini-flash"
  }
  return "gemini-pro"
}

/**
 * Variant config from OpenCode's providerOptions.
 */
export interface VariantConfig {
  thinkingBudget?: number
  googleSearch?: GoogleSearchConfig
}

/**
 * Maps a thinking budget to Gemini 3 thinking level.
 * ≤8192 → low, ≤16384 → medium, >16384 → high
 */
function budgetToGemini3Level(budget: number): "low" | "medium" | "high" {
  if (budget <= 8192) return "low"
  if (budget <= 16384) return "medium"
  return "high"
}

/**
 * Resolves legacy Gemini preview IDs to Antigravity model IDs.
 *
 * Existing preview IDs remain accepted for saved OpenCode configurations;
 * they are aliases only and always use Antigravity OAuth.
 */
export function resolveAntigravityModel(requestedModel: string): ResolvedModel {
  const lower = requestedModel.toLowerCase()
  const isGemini3 = lower.includes("gemini-3")

  if (!isGemini3) {
    return resolveModelWithTier(requestedModel)
  }

  let transformedModel = requestedModel
    .replace(/-preview-customtools$/i, "")
    .replace(/-preview$/i, "")
    .replace(/^antigravity-/i, "")
  // Antigravity's inventory exposes Gemini 3.8 Flash under its tiered ID.
  if (transformedModel === "gemini-3.8-flash") {
    transformedModel = "gemini-3.8-flash-tiered"
  }

  const isGemini3Pro = isGemini3ProModel(transformedModel)
  const hasTierSuffix = /-(low|medium|high)$/i.test(transformedModel)
  const isImageModel = IMAGE_GENERATION_MODELS.test(transformedModel)

  if (isGemini3Pro && !hasTierSuffix && !isImageModel) {
    transformedModel = `${transformedModel}-low`
  }

  return resolveModelWithTier(`antigravity-${transformedModel}`)
}

/**
 * Resolves model with variant config from providerOptions.
 * Variant config takes priority over tier suffix in model name.
 */
export function resolveModelWithVariant(requestedModel: string, variantConfig?: VariantConfig): ResolvedModel {
  const base = resolveModelWithTier(requestedModel)

  if (!variantConfig) {
    return base
  }

  // Apply Google Search config if present
  if (variantConfig.googleSearch) {
    base.googleSearch = variantConfig.googleSearch
    base.configSource = "variant"
  }

  if (!variantConfig.thinkingBudget) {
    return base
  }

  const budget = variantConfig.thinkingBudget
  const isGemini3 = base.actualModel.toLowerCase().includes("gemini-3")

  if (isGemini3) {
    const level = budgetToGemini3Level(budget)
    const isAntigravityGemini3Pro = isGemini3ProModel(base.actualModel)

    let actualModel = base.actualModel
    if (isAntigravityGemini3Pro) {
      const baseModel = base.actualModel.replace(/-(low|medium|high)$/, "")
      actualModel = `${baseModel}-${level}`
    }

    return {
      ...base,
      actualModel,
      thinkingLevel: level,
      thinkingBudget: undefined,
      configSource: "variant",
    }
  }

  return {
    ...base,
    thinkingBudget: budget,
    configSource: "variant",
  }
}
