import { ANTIGRAVITY_ENDPOINT_PROD, getAntigravityHeaders, ANTIGRAVITY_PROVIDER_ID } from "../constants"
import { accessTokenExpired, formatRefreshParts, parseRefreshParts } from "./auth"
import { logQuotaFetch, logQuotaStatus } from "./debug"
import { ensureProjectContext } from "./project"
import { refreshAccessToken } from "./token"
import { getModelFamily } from "./transform/model-resolver"
import type { PluginClient, OAuthAuthDetails } from "./types"
import type { AccountMetadataV3, QuotaSummaryBucket, QuotaSummaryGroup, QuotaSummaryWindow } from "./storage"

const FETCH_TIMEOUT_MS = 10000
const SUMMARY_FETCH_TIMEOUT_MS = 5_000

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
  quotaSummaryGroups?: QuotaSummaryGroup[]
  quotaSummaryStatus?: "ok" | "error" | "unknown"
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

/** Untrusted bucket fields returned by retrieveUserQuotaSummary. */
interface FetchQuotaSummaryBucket {
  window?: unknown
  remainingFraction?: unknown
  resetTime?: unknown
  disabled?: unknown
}

/** Untrusted group fields returned by retrieveUserQuotaSummary. */
interface FetchQuotaSummaryGroup {
  displayName?: unknown
  description?: unknown
  buckets?: unknown
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

/** Keeps text copied from upstream quota metadata bounded and terminal-safe. */
function safeSummaryText(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== "string") return undefined
  const text = Array.from(value)
    .filter((character) => {
      const codePoint = character.codePointAt(0) ?? 0
      return codePoint >= 0x20 && (codePoint < 0x7f || codePoint > 0x9f)
    })
    .join("")
    .trim()
    .slice(0, maxLength)
  return text || undefined
}

/** Accept only the two quota windows returned by the summary endpoint. */
function parseSummaryWindow(value: unknown): QuotaSummaryWindow | undefined {
  return value === "weekly" || value === "5h" ? value : undefined
}

/**
 * Parses Antigravity's grouped weekly and five-hour quota response.
 * Invalid windows and unusable bucket values stay absent instead of implying a full quota.
 */
export function parseQuotaSummaryResponse(response: unknown): QuotaSummaryGroup[] | undefined {
  if (typeof response !== "object" || response === null || Array.isArray(response)) return undefined
  const root = response as Record<string, unknown>
  const summary = typeof root.quotaSummary === "object" && root.quotaSummary !== null ? root.quotaSummary : undefined
  const rawGroups = Array.isArray(root.groups)
    ? root.groups
    : summary && typeof summary === "object" && Array.isArray((summary as Record<string, unknown>).groups)
      ? ((summary as Record<string, unknown>).groups as unknown[])
      : undefined
  if (!rawGroups) return undefined

  const groups: QuotaSummaryGroup[] = []
  for (const rawGroup of rawGroups.slice(0, 10)) {
    if (typeof rawGroup !== "object" || rawGroup === null || Array.isArray(rawGroup)) continue
    const group = rawGroup as FetchQuotaSummaryGroup
    const displayName = safeSummaryText(group.displayName, 120)
    if (!displayName || !Array.isArray(group.buckets)) continue

    const buckets: Partial<Record<QuotaSummaryWindow, QuotaSummaryBucket>> = {}
    for (const rawBucket of group.buckets) {
      if (typeof rawBucket !== "object" || rawBucket === null || Array.isArray(rawBucket)) continue
      const bucket = rawBucket as FetchQuotaSummaryBucket
      const window = parseSummaryWindow(bucket.window)
      if (!window || bucket.disabled === true || buckets[window]) continue

      const remainingFraction = normalizeRemainingFraction(bucket.remainingFraction)
      const rawResetTime = safeSummaryText(bucket.resetTime, 80)
      const resetTime = rawResetTime && parseResetTime(rawResetTime) !== null ? rawResetTime : undefined
      if (remainingFraction === undefined && resetTime === undefined) continue

      buckets[window] = {
        ...(remainingFraction === undefined ? {} : { remainingFraction }),
        ...(resetTime === undefined ? {} : { resetTime }),
      }
    }

    if (Object.keys(buckets).length === 0) continue
    const description = safeSummaryText(group.description, 300)
    groups.push({ displayName, ...(description ? { description } : {}), buckets })
  }
  return groups
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

/** Fetches and consumes an Antigravity response within one timeout/cancellation scope. */
async function fetchWithTimeout<T>(
  url: string,
  options: RequestInit,
  readResponse: (response: Response) => Promise<T>,
  timeoutMs = FETCH_TIMEOUT_MS,
  signal?: AbortSignal,
): Promise<T> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  const abort = () => controller.abort(signal?.reason)
  signal?.addEventListener("abort", abort, { once: true })
  if (signal?.aborted) abort()
  try {
    const response = await fetch(url, { ...options, signal: controller.signal })
    return await readResponse(response)
  } finally {
    clearTimeout(timeout)
    signal?.removeEventListener("abort", abort)
  }
}

async function fetchAvailableModels(
  accessToken: string,
  projectId: string,
  quotaSignal?: AbortSignal,
): Promise<FetchAvailableModelsResponse> {
  const endpoint = ANTIGRAVITY_ENDPOINT_PROD
  const quotaUserAgent = getAntigravityHeaders()["User-Agent"] || "antigravity/windows/amd64"

  const body = projectId ? { project: projectId } : {}
  return fetchWithTimeout(
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
    async (response) => {
      if (response.ok) return (await response.json()) as FetchAvailableModelsResponse

      const message = await response.text().catch(() => "")
      const snippet = message.trim().slice(0, 200)
      throw new Error(`fetchAvailableModels ${response.status} at ${endpoint}${snippet ? `: ${snippet}` : ""}`)
    },
    FETCH_TIMEOUT_MS,
    quotaSignal,
  )
}

/** Retrieves the supplementary grouped quota; callers may degrade if it is unavailable. */
async function fetchQuotaSummary(
  accessToken: string,
  projectId: string,
  quotaSignal?: AbortSignal,
): Promise<QuotaSummaryGroup[]> {
  const quotaUserAgent = getAntigravityHeaders()["User-Agent"] || "antigravity/windows/amd64"
  return fetchWithTimeout(
    `${ANTIGRAVITY_ENDPOINT_PROD}/v1internal:retrieveUserQuotaSummary`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        "User-Agent": quotaUserAgent,
      },
      body: JSON.stringify(projectId ? { project: projectId } : {}),
    },
    async (response) => {
      if (!response.ok) throw new Error(`retrieveUserQuotaSummary returned ${response.status}`)

      const groups = parseQuotaSummaryResponse(await response.json())
      if (!groups) throw new Error("Invalid retrieveUserQuotaSummary response")
      return groups
    },
    SUMMARY_FETCH_TIMEOUT_MS,
    quotaSignal,
  )
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
      const [modelsResult, summaryResult] = await Promise.allSettled([
        fetchAvailableModels(auth.access ?? "", projectContext.effectiveProjectId, quotaSignal),
        fetchQuotaSummary(auth.access ?? "", projectContext.effectiveProjectId, quotaSignal),
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
