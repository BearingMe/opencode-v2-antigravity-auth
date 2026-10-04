import { ANTIGRAVITY_ENDPOINT_PROD, getAntigravityHeaders } from "./constants.js"
import type { AccountQuotaProbePort } from "../../modules/accounts/index.js"
import type { QuotaSummaryBucket, QuotaSummaryGroup, QuotaSummaryWindow } from "../../modules/accounts/index.js"

const FETCH_TIMEOUT_MS = 10_000
const SUMMARY_FETCH_TIMEOUT_MS = 5_000

/** Per-model quota fields returned by fetchAvailableModels. */
export interface FetchAvailableModelEntry {
  remainingFraction?: number
  resetTime?: string
  displayName?: string
  modelName?: string
}

/** Response envelope returned by fetchAvailableModels. */
export interface FetchAvailableModelsResponse {
  models?: Record<string, FetchAvailableModelEntry>
}

/** Credentials and project data required for either Antigravity quota probe. */
export interface AntigravityQuotaProbeInput {
  accessToken: string
  projectId: string
  signal?: AbortSignal
}

interface FetchQuotaSummaryBucket {
  window?: unknown
  remainingFraction?: unknown
  resetTime?: unknown
  disabled?: unknown
}

interface FetchQuotaSummaryGroup {
  displayName?: unknown
  description?: unknown
  buckets?: unknown
}

/** Retains exhausted/full readings and omits unusable provider fractions. */
function parseRemainingFraction(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) return undefined
  return value
}

/** Retains the provider's reset-time text only when it parses as a timestamp. */
function parseModelResetTime(value: unknown): string | undefined {
  return typeof value === "string" && Number.isFinite(Date.parse(value)) ? value : undefined
}

/** Executes a quota request and parses its response within one abort scope. */
async function fetchWithTimeout<T>(
  url: string,
  options: RequestInit,
  readResponse: (response: Response) => Promise<T>,
  timeoutMs: number,
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

/** Narrows the provider response to fields consumed by account quota policy. */
export function parseAvailableModelsResponse(response: unknown): FetchAvailableModelsResponse {
  if (typeof response !== "object" || response === null || Array.isArray(response)) return {}
  const rawModels = (response as Record<string, unknown>).models
  if (typeof rawModels !== "object" || rawModels === null || Array.isArray(rawModels)) return {}

  const models: Record<string, FetchAvailableModelEntry> = {}
  for (const [modelName, rawEntry] of Object.entries(rawModels)) {
    if (typeof rawEntry !== "object" || rawEntry === null || Array.isArray(rawEntry)) continue
    const entry = rawEntry as Record<string, unknown>
    const rawQuota = entry.quotaInfo
    const quotaInfo =
      typeof rawQuota === "object" && rawQuota !== null && !Array.isArray(rawQuota)
        ? (rawQuota as Record<string, unknown>)
        : undefined
    const remainingFraction = parseRemainingFraction(quotaInfo?.remainingFraction)
    const resetTime = parseModelResetTime(quotaInfo?.resetTime)
    models[modelName] = {
      ...(typeof entry.displayName === "string" ? { displayName: entry.displayName } : {}),
      ...(typeof entry.modelName === "string" ? { modelName: entry.modelName } : {}),
      ...(remainingFraction === undefined ? {} : { remainingFraction }),
      ...(resetTime === undefined ? {} : { resetTime }),
    }
  }
  return { models }
}

/** Fetches the primary per-model quota response with its established timeout. */
export async function fetchAvailableModels(
  accessToken: string,
  projectId: string,
  quotaSignal?: AbortSignal,
): Promise<FetchAvailableModelsResponse> {
  const endpoint = ANTIGRAVITY_ENDPOINT_PROD
  const quotaUserAgent = getAntigravityHeaders()["User-Agent"] || "antigravity/windows/amd64"
  return fetchWithTimeout(
    `${endpoint}/v1internal:fetchAvailableModels`,
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
      if (response.ok) return parseAvailableModelsResponse(await response.json())
      const message = await response.text().catch(() => "")
      const snippet = message.trim().slice(0, 200)
      throw new Error(`fetchAvailableModels ${response.status} at ${endpoint}${snippet ? `: ${snippet}` : ""}`)
    },
    FETCH_TIMEOUT_MS,
    quotaSignal,
  )
}

/** Fetches and validates the supplementary grouped quota; callers may degrade if unavailable. */
export async function fetchQuotaSummary(
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

/** Account port for the primary per-model quota endpoint. */
export const availableModelsQuotaProbe: AccountQuotaProbePort<
  AntigravityQuotaProbeInput,
  FetchAvailableModelsResponse
> = {
  check: ({ accessToken, projectId, signal }) => fetchAvailableModels(accessToken, projectId, signal),
}

/** Account port for the best-effort grouped quota endpoint. */
export const groupedQuotaProbe: AccountQuotaProbePort<AntigravityQuotaProbeInput, QuotaSummaryGroup[]> = {
  check: ({ accessToken, projectId, signal }) => fetchQuotaSummary(accessToken, projectId, signal),
}

/** Keeps upstream display text bounded and safe to show in a terminal. */
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

/** Accepts only the quota windows currently returned by the summary endpoint. */
function parseSummaryWindow(value: unknown): QuotaSummaryWindow | undefined {
  return value === "weekly" || value === "5h" ? value : undefined
}

/** Accepts only finite remaining fractions in the provider's documented range. */
function normalizeRemainingFraction(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) return undefined
  return value
}

/** Accepts a reset time only when it parses as a timestamp. */
function parseResetTime(resetTime: string): boolean {
  return Number.isFinite(Date.parse(resetTime))
}

/** Parses the provider's grouped weekly and five-hour quota response. */
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
      const resetTime = rawResetTime && parseResetTime(rawResetTime) ? rawResetTime : undefined
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
