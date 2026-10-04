import type { AccountMetadataV3 } from "../persistence/policy.js"
import { aggregateAccountQuota } from "./aggregate.js"
import type { AccountQuotaProbeResult, AccountQuotaResult, AccountQuotaSummary } from "./types.js"

/** Log callbacks retained by the host-facing account quota bridge. */
export interface AccountQuotaLogger {
  fetch(status: "start" | "complete" | "error", count?: number, details?: string): void
  status(email: string | undefined, index: number, consumedPercent: number, family: string): void
}

/** Provider boundary for per-account refresh/setup and raw quota probes. */
export interface AccountQuotaCheckDependencies {
  probe(account: AccountMetadataV3, signal?: AbortSignal): Promise<AccountQuotaProbeResult>
  isGeminiFlash(modelName: string): boolean
  logger: AccountQuotaLogger
}

/** Checks accounts serially, aggregates provider readings, and keeps failures local. */
export async function checkAccountQuotas(
  accounts: AccountMetadataV3[],
  dependencies: AccountQuotaCheckDependencies,
  signal?: AbortSignal,
): Promise<AccountQuotaResult[]> {
  const results: AccountQuotaResult[] = []
  dependencies.logger.fetch("start", accounts.length)

  for (const [index, account] of accounts.entries()) {
    const disabled = account.enabled === false
    try {
      const probe = await dependencies.probe(account, signal)
      const quota: AccountQuotaSummary = probe.modelProbeFailed
        ? { groups: {}, modelCount: 0, error: "Failed to fetch Antigravity quota" }
        : aggregateAccountQuota(probe.models, dependencies.isGeminiFlash)

      if (probe.summaryProbeFailed) {
        quota.quotaSummaryStatus = "error"
      } else {
        quota.quotaSummaryGroups = probe.quotaSummaryGroups ?? []
        quota.quotaSummaryStatus = quota.quotaSummaryGroups.length > 0 ? "ok" : "unknown"
      }

      results.push({
        index,
        email: account.email,
        status: "ok",
        disabled,
        quota,
        updatedAccount: probe.updatedAccount,
      })
      for (const [family, group] of Object.entries(quota.groups)) {
        if (group.remainingFraction === undefined) continue
        dependencies.logger.status(account.email, index, group.remainingFraction * 100, family)
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      results.push({ index, email: account.email, status: "error", disabled, error: message })
      dependencies.logger.fetch("error", undefined, `account=${account.email ?? index} error=${message}`)
    }
  }

  dependencies.logger.fetch(
    "complete",
    accounts.length,
    `ok=${results.filter((result) => result.status === "ok").length} errors=${results.filter((result) => result.status === "error").length}`,
  )
  return results
}
