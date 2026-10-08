import { randomUUID } from "node:crypto"
import { ANTIGRAVITY_PROVIDER_ID } from "../../constants.js"
import { createAccountAdmin, type AccountAdminService } from "../../modules/accounts/index.js"
import {
  fingerprintRefreshToken,
  loadAccounts,
  saveAccounts,
  saveAccountsReplace,
  updateAccounts,
} from "../filesystem/account-store.js"
import type { PluginClient } from "./types.js"
import { checkAccountsQuota } from "./quota.js"
import { verifyAccountAccess } from "./verification.js"
import { createLogger } from "./logger.js"

/** Composes account policy with persistence, quota, and verification adapters. */
export function createOpenCodeAccountAdministration(
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
