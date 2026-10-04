/** Model family used when selecting an account pool entry. */
export type ModelFamily = "claude" | "gemini"

/** Quota bucket selected for a model request. */
export type QuotaGroup = "claude" | "gemini-pro" | "gemini-flash"

/** Supported account selection policies. */
export type AccountSelectionStrategy = "sticky" | "round-robin" | "hybrid"

/** Reasons an account may be temporarily excluded from selection. */
export type CooldownReason = "auth-failure" | "network-error" | "project-error" | "validation-required"

/** Classification supplied by the inference boundary for account policy. */
export interface AccountModelClassification {
  family: ModelFamily
  model?: string
  quotaGroup?: QuotaGroup
}

/** Inputs that affect selection and the existing soft-quota gate. */
export interface AccountSelectionInput {
  classification: AccountModelClassification
  strategy: AccountSelectionStrategy
  pidOffsetEnabled: boolean
  softQuotaThresholdPercent: number
  softQuotaCacheTtlMs: number
}

/** Narrow pool operation consumed by the request execution boundary. */
export interface AccountPool<Account> {
  selectForRequest(input: AccountSelectionInput): Account | null
}

/** Safe summary of one saved account; never contains credentials. */
export interface AccountSummary {
  id: string
  index: number
  email: string
  enabled: boolean
  active: boolean
  verificationRequired: boolean
  verificationStatus: "verification_required" | "ok" | "blocked" | "error" | "not_checked"
  lastVerificationAt?: number
  cooldownUntil?: number
  quotaResetTimes?: Record<string, number | undefined>
}

/** Credential-free result returned by account listing. */
export interface AccountList {
  activeIndex: number
  activeIndexByFamily: { claude: number; gemini: number }
  accounts: AccountSummary[]
}

/** Quota values for one family/model group. */
export interface QuotaGroupPresentation {
  remainingFraction: number | null
  consumedPercent: number | null
  resetTime: number | null
}

/** A weekly or five-hour quota summary bucket. */
export interface QuotaWindowPresentation {
  remainingFraction: number | null
  resetTime: number | null
}

/** Safe grouped quota details for a single account. */
export interface QuotaSummaryPresentation {
  groups: Array<{
    displayName: string
    description: string | null
    buckets: { weekly: QuotaWindowPresentation; "5h": QuotaWindowPresentation }
  }>
  checkedAt: number | null
  freshness: "fresh" | "stale" | "unchecked"
  status: "ok" | "error" | "unknown"
}

/** Credential-free account quota result exposed to the host UI. */
export interface QuotaAccountPresentation {
  id: string
  email: string
  enabled: boolean
  status: "ok" | "error" | "unknown"
  groups: Record<QuotaGroup, QuotaGroupPresentation>
  quotaSummary: QuotaSummaryPresentation
  checkedAt: number | null
  freshness: "fresh" | "stale" | "unchecked"
  verificationRequired: boolean
  cooldownUntil: number | null
  coolingDown: boolean
  selectedByFamily: { claude: boolean; gemini: boolean }
}

/** Credential-free quota response consumed by the account UI. */
export interface QuotaPresentation {
  activeIndexByFamily: { claude: number; gemini: number }
  accounts: QuotaAccountPresentation[]
}

/** Options for an account quota presentation request. */
export interface QuotaPresentationOptions {
  refresh?: boolean
  timeoutMs?: number
  staleAfterMs?: number
}

/** Stable account reference accepted by administrative operations. */
export type AccountTarget = { id: string } | { index: number }

/** Failure when a requested account reference is stale or ambiguous. */
export interface AccountTargetFailure {
  ok: false
  kind: "invalid-index" | "not-found" | "ambiguous"
  accountCount: number
}

/** Result of checking a selected account's Antigravity access. */
export interface AccountVerificationResult {
  index: number
  email?: string
  checkedAt: number
  status: "ok" | "blocked" | "error"
  message: string
  verifyUrl?: string
}

/** Refresh-token parts needed by trusted application code after selection. */
export interface AccountRefreshParts {
  refreshToken: string
  projectId?: string
  managedProjectId?: string
}

/** Selected account credential returned only to trusted application code. */
export interface SelectedAccountCredential {
  id: string
  index: number
  email?: string
  refreshParts: AccountRefreshParts
}

/** Supported account administration operations. */
export type AccountMutation = "select" | "enable" | "disable" | "delete"

/** Optional family-scoped account selection. */
export interface AccountMutationOptions {
  family?: ModelFamily
}

/** Successful account mutation result. */
export interface AccountMutationSuccess {
  op: AccountMutation
  index: number
  nextActiveIndex: number
  activeIndexByFamily: { claude: number; gemini: number }
  remaining: number
  selected: SelectedAccountCredential | null
}

/** Account mutation result, including fail-closed target failures. */
export type AccountMutationResult =
  AccountMutationSuccess | AccountTargetFailure | { ok: false; kind: "unknown-op"; accountCount: number }

/** Input for adding or reconnecting a saved OAuth account. */
export interface OAuthAccountInput {
  refresh: string
  email?: string
  projectId: string
}

/** Application-facing account administration operations. */
export interface AccountAdministration {
  list(): Promise<AccountList>
  quota(options?: QuotaPresentationOptions): Promise<QuotaPresentation>
  verify(target: AccountTarget): Promise<AccountVerificationResult | AccountTargetFailure>
  mutate(
    target: AccountTarget,
    operation: AccountMutation,
    options?: AccountMutationOptions,
  ): Promise<AccountMutationResult>
  deleteAll(): Promise<{ remaining: 0 }>
  persistOAuth(input: OAuthAccountInput, action: "add" | "replace"): Promise<void>
}

export type {
  AccountAccessVerificationPort,
  AccountClockPort,
  AccountCredentialRefreshPort,
  AccountPersistencePort,
  AccountQuotaProbePort,
  AccountStateUpdate,
} from "./ports.js"

export * from "./persistence/policy.js"
export * from "./persistence/service.js"
export { AccountStoreUnreadableError } from "./persistence/errors.js"
export { AccountPoolManager, computeSoftQuotaCacheTtlMs, resolveQuotaGroup } from "./account-pool.js"
export type {
  AccountFingerprint,
  AccountFingerprintVersion,
  AccountPoolDependencies,
  ManagedAccount,
  PoolOAuthAuth,
  PoolQuotaGroupSummary,
  PoolRefreshParts,
} from "./account-pool.js"
export {
  addJitter,
  calculateBackoffMs,
  DEFAULT_HEALTH_SCORE_CONFIG,
  DEFAULT_TOKEN_BUCKET_CONFIG,
  getHealthTracker,
  getTokenTracker,
  HealthScoreTracker,
  initHealthTracker,
  initTokenTracker,
  parseRateLimitReason,
  randomDelay,
  selectHybridAccount,
  sortByLruWithHealth,
  TokenBucketTracker,
} from "./selection/index.js"
export type { AccountWithMetrics, HealthScoreConfig, RateLimitReason, TokenBucketConfig } from "./selection/index.js"
