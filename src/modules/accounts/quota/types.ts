import type { AccountMetadataV3, QuotaSummaryGroup } from "../persistence/policy.js"

/** Quota family shown by account administration. */
export type AccountQuotaGroup = "claude" | "gemini-pro" | "gemini-flash"

/** Normalized fields from one available-model quota response entry. */
export interface AccountQuotaModelReading {
  remainingFraction?: number
  resetTime?: string
  displayName?: string
  modelName?: string
}

/** Aggregated quota values for one account-facing model family. */
export interface AccountQuotaGroupSummary {
  remainingFraction?: number
  resetTime?: string
  modelCount: number
}

/** Quota result retained before credential-free account presentation. */
export interface AccountQuotaSummary {
  groups: Partial<Record<AccountQuotaGroup, AccountQuotaGroupSummary>>
  modelCount: number
  error?: string
  quotaSummaryGroups?: QuotaSummaryGroup[]
  quotaSummaryStatus?: "ok" | "error" | "unknown"
}

/** Per-account quota outcome, including rotated credentials for trusted persistence only. */
export interface AccountQuotaResult {
  index: number
  email?: string
  status: "ok" | "disabled" | "error"
  error?: string
  disabled?: boolean
  quota?: AccountQuotaSummary
  updatedAccount?: AccountMetadataV3
}

/** Raw normalized results from the model and grouped account-quota probes. */
export interface AccountQuotaProbeResult {
  models?: Record<string, AccountQuotaModelReading>
  modelProbeFailed: boolean
  quotaSummaryGroups?: QuotaSummaryGroup[]
  summaryProbeFailed: boolean
  updatedAccount?: AccountMetadataV3
}
