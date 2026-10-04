import type { AccountAdministration, AccountPool, AccountSelectionInput } from "../../modules/accounts/index.js"
import type { PluginClient } from "../../plugin/types.js"
import {
  deleteAllAccounts,
  getQuotaPresentation,
  listAccounts,
  mutateAccount,
  persistOAuthAccount,
  verifyAccount,
} from "../../plugin/account-service.js"
import type { AccountManager, ManagedAccount } from "../../plugin/accounts.js"

/**
 * Exposes the existing account service through the new application contract.
 *
 * @example `createLegacyAccountAdministration(client, "antigravity")`
 */
export function createLegacyAccountAdministration(client: PluginClient, providerId: string): AccountAdministration {
  return {
    /** Lists safe account summaries from the existing service. */
    list: listAccounts,
    /** Reads or refreshes quota presentation through the host client. */
    quota: (options) => getQuotaPresentation(client, options, providerId),
    /** Verifies the requested saved account through the host client. */
    verify: (target) => verifyAccount(target, client, providerId),
    /** Applies the existing fail-closed account mutation policy. */
    mutate: (target, operation, options) => mutateAccount(target, operation, options),
    /** Removes all saved accounts using the existing transactional service. */
    deleteAll: deleteAllAccounts,
    /** Persists an OAuth result using the existing account store. */
    persistOAuth: async (input, action) => {
      await persistOAuthAccount(input, action)
    },
  } satisfies AccountAdministration
}

/**
 * Adapts the old pool selector to the explicit request-classification contract.
 *
 * @example `createLegacyAccountPool(manager).selectForRequest(input)`
 */
export function createLegacyAccountPool(manager: AccountManager): AccountPool<ManagedAccount> {
  return {
    /** Delegates selection while preserving inference's quota classification. */
    selectForRequest(input: AccountSelectionInput) {
      const { family, model, quotaGroup } = input.classification
      return manager.getCurrentOrNextForFamily(
        family,
        model,
        input.strategy,
        input.pidOffsetEnabled,
        input.softQuotaThresholdPercent,
        input.softQuotaCacheTtlMs,
        quotaGroup,
      )
    },
  }
}
