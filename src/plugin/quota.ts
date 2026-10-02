import { ANTIGRAVITY_ENDPOINT_PROD, getAntigravityHeaders, ANTIGRAVITY_PROVIDER_ID } from "../constants"
import { accessTokenExpired, formatRefreshParts, parseRefreshParts } from "./auth"
import { logQuotaFetch, logQuotaStatus } from "./debug"
import { ensureProjectContext } from "./project"
import { refreshAccessToken } from "./token"
import { getModelFamily } from "./transform/model-resolver"
import type { PluginClient, OAuthAuthDetails } from "./types"
import type { AccountMetadataV3 } from "./storage"

const FETCH_TIMEOUT_MS = 10000

export type QuotaGroup = "claude" | "gemini-pro" | "gemini-flash"

export interface QuotaGroupSummary {
  remainingFraction?: number
  resetTime?: string
  modelCount: number
}

export interface QuotaSummary {
  groups: Partial<Record<QuotaGroup, QuotaGroupSummary>>
  modelCount: number
  error?: string
}

export type AccountQuotaStatus = "ok" | "disabled" | "error"

export interface AccountQuotaResult {
  index: number
  email?: string
  status: AccountQuotaStatus
  error?: string
  disabled?: boolean
  quota?: QuotaSummary
  updatedAccount?: AccountMetadataV3
}

interface FetchAvailableModelsResponse {
  models?: Record<string, FetchAvailableModelEntry>
}

interface FetchAvailableModelEntry {
  quotaInfo?: {
    remainingFraction?: number
    resetTime?: string
  }
  displayName?: string
  modelName?: string
}

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

function normalizeRemainingFraction(value: unknown): number | undefined {
  // Missing, non-finite, or out-of-range values are unknown, not exhausted.
  // Valid 0 (exhausted) and 1 (full) pass through unchanged; nothing is clamped.
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return undefined
  }
  if (value < 0 || value > 1) {
    return undefined
  }
  return value
}

function parseResetTime(resetTime?: string): number | null {
  if (!resetTime) return null
  const timestamp = Date.parse(resetTime)
  if (!Number.isFinite(timestamp)) {
    return null
  }
  return timestamp
}

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
    const quotaInfo = entry.quotaInfo
    const remainingFraction = quotaInfo ? normalizeRemainingFraction(quotaInfo.remainingFraction) : undefined
    const resetTime = quotaInfo?.resetTime
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

async function fetchWithTimeout(
  url: string,
  options: RequestInit,
  timeoutMs = FETCH_TIMEOUT_MS,
  signal?: AbortSignal,
): Promise<Response> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  // AbortSignal.any needs Node >= 20.3 while engines allow >= 20.0: without
  // it the external signal is ignored and only the timeout applies.
  const combinedSignal =
    signal && typeof AbortSignal.any === "function" ? AbortSignal.any([controller.signal, signal]) : controller.signal
  try {
    return await fetch(url, { ...options, signal: combinedSignal })
  } finally {
    clearTimeout(timeout)
  }
}

async function fetchAvailableModels(
  accessToken: string,
  projectId: string,
  quotaSignal?: AbortSignal,
): Promise<FetchAvailableModelsResponse> {
  const endpoint = ANTIGRAVITY_ENDPOINT_PROD
  const quotaUserAgent = getAntigravityHeaders()["User-Agent"] || "antigravity/windows/amd64"
  const errors: string[] = []

  const body = projectId ? { project: projectId } : {}
  const response = await fetchWithTimeout(
    `${endpoint}/v1internal:fetchAvailableModels`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        "User-Agent": quotaUserAgent,
      },
      body: JSON.stringify(body),
    },
    FETCH_TIMEOUT_MS,
    quotaSignal,
  )

  if (response.ok) {
    return (await response.json()) as FetchAvailableModelsResponse
  }

  const message = await response.text().catch(() => "")
  const snippet = message.trim().slice(0, 200)
  errors.push(`fetchAvailableModels ${response.status} at ${endpoint}${snippet ? `: ${snippet}` : ""}`)

  throw new Error(errors.join("; ") || "fetchAvailableModels failed")
}

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
      const antigravityResponse = await fetchAvailableModels(
        auth.access ?? "",
        projectContext.effectiveProjectId,
        quotaSignal,
      ).catch((): FetchAvailableModelsResponse => ({ models: undefined }))

      const quotaResult =
        antigravityResponse.models === undefined
          ? {
              groups: {},
              modelCount: 0,
              error: "Failed to fetch Antigravity quota",
            }
          : aggregateQuota(antigravityResponse.models)

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
