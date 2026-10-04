import { ANTIGRAVITY_PROVIDER_ID } from "../constants"
import {
  availableModelsQuotaProbe,
  groupedQuotaProbe,
  parseQuotaSummaryResponse,
  type FetchAvailableModelEntry,
} from "../adapters/antigravity/quota-client.js"
import { accessTokenExpired, formatRefreshParts, parseRefreshParts } from "./auth"
import { logQuotaFetch, logQuotaStatus } from "./debug"
import { ensureProjectContext } from "./project"
import { refreshAccessToken } from "./token"
import { getModelFamily } from "./transform/model-resolver"
import type { PluginClient, OAuthAuthDetails } from "./types"
import type { AccountMetadataV3, QuotaSummaryGroup } from "./storage"

/** Quota family names displayed by account management. */
export type QuotaGroup = "claude" | "gemini-pro" | "gemini-flash"

/** Aggregated per-family quota values from Antigravity's model endpoint. */
export interface QuotaGroupSummary {
  remainingFraction?: number
  resetTime?: string
  modelCount: number
}

/** Full account quota result before credential-free presentation. */
export interface QuotaSummary {
  groups: Partial<Record<QuotaGroup, QuotaGroupSummary>>
  modelCount: number
  error?: string
  quotaSummaryGroups?: QuotaSummaryGroup[]
  quotaSummaryStatus?: "ok" | "error" | "unknown"
}

/** Outcome of checking one account's Antigravity quota. */
export type AccountQuotaStatus = "ok" | "disabled" | "error"

/** Account-indexed quota result with any safely updateable credential metadata. */
export interface AccountQuotaResult {
  index: number
  email?: string
  status: AccountQuotaStatus
  error?: string
  disabled?: boolean
  quota?: QuotaSummary
  updatedAccount?: AccountMetadataV3
}

/** Builds the transient OAuth shape used to refresh a stored quota account. */
function buildAuthFromAccount(account: AccountMetadataV3): OAuthAuthDetails {
  return {
    type: "oauth",
    refresh: formatRefreshParts({
      refreshToken: account.refreshToken,
      projectId: account.projectId,
      managedProjectId: account.managedProjectId,
    }),
    access: undefined,
    expires: undefined,
  }
}

/** Converts a provider reset timestamp to epoch milliseconds when valid. */
function parseResetTime(resetTime?: string): number | null {
  if (!resetTime) return null
  const timestamp = Date.parse(resetTime)
  if (!Number.isFinite(timestamp)) {
    return null
  }
  return timestamp
}

/** Compatibility export for the adapter's grouped quota response parser. */
export { parseQuotaSummaryResponse }

/** Assigns supported upstream models to the quota family displayed by the plugin. */
function classifyQuotaGroup(modelName: string, displayName?: string): QuotaGroup | null {
  const combined = `${modelName} ${displayName ?? ""}`.toLowerCase()
  if (combined.includes("claude")) {
    return "claude"
  }
  const isGemini3 = combined.includes("gemini-3") || combined.includes("gemini 3")
  if (!isGemini3) {
    return null
  }
  const family = getModelFamily(modelName)
  return family === "gemini-flash" ? "gemini-flash" : "gemini-pro"
}

/** Aggregates each family's known model readings without turning unknown into zero. */
function aggregateQuota(models?: Record<string, FetchAvailableModelEntry>): QuotaSummary {
  const groups: Partial<Record<QuotaGroup, QuotaGroupSummary>> = {}
  if (!models) {
    return { groups, modelCount: 0 }
  }

  let totalCount = 0
  for (const [modelName, entry] of Object.entries(models)) {
    const group = classifyQuotaGroup(modelName, entry.displayName ?? entry.modelName)
    if (!group) {
      continue
    }
    const remainingFraction = entry.remainingFraction
    const resetTime = entry.resetTime
    const resetTimestamp = parseResetTime(resetTime)

    totalCount += 1

    const existing = groups[group]
    const nextCount = (existing?.modelCount ?? 0) + 1
    const nextRemaining =
      remainingFraction === undefined
        ? existing?.remainingFraction
        : existing?.remainingFraction === undefined
          ? remainingFraction
          : Math.min(existing.remainingFraction, remainingFraction)

    let nextResetTime = existing?.resetTime
    if (resetTimestamp !== null) {
      if (!existing?.resetTime) {
        nextResetTime = resetTime
      } else {
        const existingTimestamp = parseResetTime(existing.resetTime)
        if (existingTimestamp === null || resetTimestamp < existingTimestamp) {
          nextResetTime = resetTime
        }
      }
    }

    groups[group] = {
      remainingFraction: nextRemaining,
      resetTime: nextResetTime,
      modelCount: nextCount,
    }
  }

  return { groups, modelCount: totalCount }
}

/** Copies rotated credential/project values back to a stored quota account. */
function applyAccountUpdates(account: AccountMetadataV3, auth: OAuthAuthDetails): AccountMetadataV3 | undefined {
  const parts = parseRefreshParts(auth.refresh)
  if (!parts.refreshToken) {
    return undefined
  }

  const updated: AccountMetadataV3 = {
    ...account,
    refreshToken: parts.refreshToken,
    projectId: parts.projectId ?? account.projectId,
    managedProjectId: parts.managedProjectId ?? account.managedProjectId,
  }

  const changed =
    updated.refreshToken !== account.refreshToken ||
    updated.projectId !== account.projectId ||
    updated.managedProjectId !== account.managedProjectId

  return changed ? updated : undefined
}

/** Refreshes account credentials as needed, resolves project context, then probes both quota endpoints. */
export async function checkAccountsQuota(
  accounts: AccountMetadataV3[],
  client: PluginClient,
  providerId = ANTIGRAVITY_PROVIDER_ID,
  quotaSignal?: AbortSignal,
): Promise<AccountQuotaResult[]> {
  const results: AccountQuotaResult[] = []

  logQuotaFetch("start", accounts.length)

  for (const [index, account] of accounts.entries()) {
    const disabled = account.enabled === false

    let auth = buildAuthFromAccount(account)

    try {
      if (accessTokenExpired(auth)) {
        const refreshed = await refreshAccessToken(auth, client, providerId)
        if (!refreshed) {
          throw new Error("Token refresh failed")
        }
        auth = refreshed
      }

      const projectContext = await ensureProjectContext(auth)
      auth = projectContext.auth
      const updatedAccount = applyAccountUpdates(account, auth)

      // Quota cancellation covers the Antigravity probe only; token refresh
      // and project-context resolution above are left untouched.
      const [modelsResult, summaryResult] = await Promise.allSettled([
        availableModelsQuotaProbe.check({
          accessToken: auth.access ?? "",
          projectId: projectContext.effectiveProjectId,
          signal: quotaSignal,
        }),
        groupedQuotaProbe.check({
          accessToken: auth.access ?? "",
          projectId: projectContext.effectiveProjectId,
          signal: quotaSignal,
        }),
      ])

      const quotaResult: QuotaSummary =
        modelsResult.status === "rejected"
          ? { groups: {}, modelCount: 0, error: "Failed to fetch Antigravity quota" }
          : aggregateQuota(modelsResult.value.models)

      if (summaryResult.status === "fulfilled") {
        quotaResult.quotaSummaryGroups = summaryResult.value
        quotaResult.quotaSummaryStatus = summaryResult.value.length > 0 ? "ok" : "unknown"
      } else {
        quotaResult.quotaSummaryStatus = "error"
      }

      results.push({
        index,
        email: account.email,
        status: "ok",
        disabled,
        quota: quotaResult,
        updatedAccount,
      })

      // Log quota status for each family; unknown fractions stay unlogged
      // rather than being reported as exhausted.
      for (const [family, groupQuota] of Object.entries(quotaResult.groups)) {
        if (groupQuota.remainingFraction === undefined) {
          continue
        }
        logQuotaStatus(account.email, index, groupQuota.remainingFraction * 100, family)
      }
    } catch (error) {
      results.push({
        index,
        email: account.email,
        status: "error",
        disabled,
        error: error instanceof Error ? error.message : String(error),
      })
      logQuotaFetch(
        "error",
        undefined,
        `account=${account.email ?? index} error=${error instanceof Error ? error.message : String(error)}`,
      )
    }
  }

  logQuotaFetch(
    "complete",
    accounts.length,
    `ok=${results.filter((r) => r.status === "ok").length} errors=${results.filter((r) => r.status === "error").length}`,
  )
  return results
}
