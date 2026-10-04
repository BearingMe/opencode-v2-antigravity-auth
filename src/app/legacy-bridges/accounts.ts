import { randomUUID } from "node:crypto"
import { ANTIGRAVITY_PROVIDER_ID } from "../../constants.js"
import {
  createAccountAdmin,
  type AccountAdminService,
  type AccountPool,
  type AccountSelectionInput,
} from "../../modules/accounts/index.js"
import {
  fingerprintRefreshToken,
  loadAccounts,
  saveAccounts,
  saveAccountsReplace,
  updateAccounts,
} from "../../plugin/storage.js"
import type { PluginClient } from "../../plugin/types.js"
import { checkAccountsQuota } from "../../plugin/quota.js"
import { verifyAccountAccess } from "../../plugin/verify.js"
import { createLogger } from "../../plugin/logger.js"
import type { AccountManager, ManagedAccount } from "../../plugin/accounts.js"

/**
 * Exposes the existing account service through the new application contract.
 *
 * @example `createLegacyAccountAdministration(client, "antigravity")`
 */
export function createLegacyAccountAdministration(
  client?: PluginClient,
  providerId = ANTIGRAVITY_PROVIDER_ID,
): AccountAdminService {
  const log = createLogger("account-service")
  return createAccountAdmin({
    persistence: {
      load: loadAccounts,
      save: saveAccounts,
      saveReplace: saveAccountsReplace,
      update: updateAccounts,
    },
    fingerprintRefreshToken,
    generateId: randomUUID,
    now: Date.now,
    checkQuota: (accounts, signal) => {
      if (!client) throw new Error("An OpenCode client is required for quota checks")
      return checkAccountsQuota(accounts, client, providerId, signal)
    },
    verifyAccount: (account) => {
      if (!client) throw new Error("An OpenCode client is required for account verification")
      return verifyAccountAccess(account, client, providerId)
    },
    warn: (message) => log.warn(message),
  })
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
