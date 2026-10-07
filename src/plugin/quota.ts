import { ANTIGRAVITY_PROVIDER_ID } from "../constants.js"
import { checkAccountQuotas, type AccountQuotaProbeResult, type AccountQuotaResult } from "../modules/accounts/index.js"
import { availableModelsQuotaProbe, groupedQuotaProbe } from "../adapters/antigravity/quota-client.js"
import { accessTokenExpired, formatRefreshParts, parseRefreshParts } from "../modules/accounts/index.js"
import { logQuotaFetch, logQuotaStatus } from "../adapters/opencode/debug.js"
import { ensureProjectContext } from "../adapters/opencode/project.js"
import { refreshAccessToken } from "./token"
import { getModelFamily } from "../modules/inference/index.js"
import type { PluginClient } from "../adapters/opencode/types.js"
import type { AccountOAuthCredential } from "../modules/accounts/index.js"
import type { AccountMetadataV3, QuotaSummaryGroup } from "../modules/accounts/index.js"

/** Builds the transient OAuth shape used to refresh a stored quota account. */
function buildAuthFromAccount(account: AccountMetadataV3): AccountOAuthCredential {
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

/** Copies rotated credential/project values back to a stored quota account. */
function applyAccountUpdates(account: AccountMetadataV3, auth: AccountOAuthCredential): AccountMetadataV3 | undefined {
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

/** Refreshes one account and returns normalized readings for account policy. */
async function probeAccountQuota(
  account: AccountMetadataV3,
  client: PluginClient,
  providerId: string,
  quotaSignal?: AbortSignal,
): Promise<AccountQuotaProbeResult> {
  let auth = buildAuthFromAccount(account)
  if (accessTokenExpired(auth)) {
    const refreshed = await refreshAccessToken(auth, client, providerId)
    if (!refreshed) throw new Error("Token refresh failed")
    auth = refreshed
  }

  const projectContext = await ensureProjectContext(auth)
  auth = projectContext.auth
  const updatedAccount = applyAccountUpdates(account, auth)
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

  return {
    models: modelsResult.status === "fulfilled" ? modelsResult.value.models : undefined,
    modelProbeFailed: modelsResult.status === "rejected",
    quotaSummaryGroups: summaryResult.status === "fulfilled" ? summaryResult.value : undefined,
    summaryProbeFailed: summaryResult.status === "rejected",
    updatedAccount,
  }
}

/** Checks account quotas through the accounts policy and Antigravity probe port. */
export function checkAccountsQuota(
  accounts: AccountMetadataV3[],
  client: PluginClient,
  providerId = ANTIGRAVITY_PROVIDER_ID,
  quotaSignal?: AbortSignal,
): Promise<AccountQuotaResult[]> {
  return checkAccountQuotas(
    accounts,
    {
      probe: (account, signal) => probeAccountQuota(account, client, providerId, signal),
      isGeminiFlash: (modelName) => getModelFamily(modelName) === "gemini-flash",
      logger: { fetch: logQuotaFetch, status: logQuotaStatus },
    },
    quotaSignal,
  )
}
