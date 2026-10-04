import type { AccountQuotaGroup, AccountQuotaModelReading, AccountQuotaSummary } from "./types.js"

/** Groups Gemini model names into account-facing pro and flash quota buckets. */
export function aggregateAccountQuota(
  models: Record<string, AccountQuotaModelReading> | undefined,
  isGeminiFlash: (modelName: string) => boolean,
): AccountQuotaSummary {
  const groups: AccountQuotaSummary["groups"] = {}
  if (!models) return { groups, modelCount: 0 }

  let modelCount = 0
  for (const [modelName, entry] of Object.entries(models)) {
    const group = classifyQuotaGroup(modelName, entry.displayName ?? entry.modelName, isGeminiFlash)
    if (!group) continue
    modelCount += 1

    const existing = groups[group]
    const nextRemaining =
      entry.remainingFraction === undefined
        ? existing?.remainingFraction
        : existing?.remainingFraction === undefined
          ? entry.remainingFraction
          : Math.min(existing.remainingFraction, entry.remainingFraction)
    const nextResetTime = earliestResetTime(existing?.resetTime, entry.resetTime)
    groups[group] = {
      remainingFraction: nextRemaining,
      resetTime: nextResetTime,
      modelCount: (existing?.modelCount ?? 0) + 1,
    }
  }

  return { groups, modelCount }
}

/** Maps supported provider model names to their quota presentation group. */
function classifyQuotaGroup(
  modelName: string,
  displayName: string | undefined,
  isGeminiFlash: (modelName: string) => boolean,
): AccountQuotaGroup | null {
  const combined = `${modelName} ${displayName ?? ""}`.toLowerCase()
  if (combined.includes("claude")) return "claude"
  if (!combined.includes("gemini-3") && !combined.includes("gemini 3")) return null
  return isGeminiFlash(modelName) ? "gemini-flash" : "gemini-pro"
}

/** Keeps the earlier valid provider reset string within a quota family. */
function earliestResetTime(current?: string, candidate?: string): string | undefined {
  if (!candidate || !Number.isFinite(Date.parse(candidate))) return current
  if (!current || !Number.isFinite(Date.parse(current)) || Date.parse(candidate) < Date.parse(current)) return candidate
  return current
}
