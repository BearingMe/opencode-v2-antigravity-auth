import { randomUUID } from "node:crypto"
import { z } from "zod"
import { ANTIGRAVITY_PROVIDER_ID } from "../../constants.js"
import {
  createAccountAdmin,
  ensureAccountIds as ensureIds,
  LEGACY_TOOL_SELECT_UPDATES_BOTH_FAMILIES,
  MAX_SAVED_ACCOUNTS,
  toAccountList as projectAccountList,
} from "../../modules/accounts/index.js"
import type {
  AccountMetadataV3,
  AccountSummary,
  AccountStorageV4,
  AccountTarget,
  AccountMutation,
  AccountMutationOptions,
  QuotaCheckOutcome,
  QuotaPresentation,
  QuotaPresentationOptions,
} from "../../modules/accounts/index.js"
import type { PluginClient } from "./types.js"
import { checkAccountsQuota } from "./quota.js"
import { verifyAccountAccess } from "./verification.js"
import { createLogger } from "./logger.js"
import {
  fingerprintRefreshToken,
  loadAccounts,
  saveAccounts,
  saveAccountsReplace,
  updateAccounts,
} from "../filesystem/account-store.js"

const log = createLogger("account-service")

export { MAX_SAVED_ACCOUNTS }
export { LEGACY_TOOL_SELECT_UPDATES_BOTH_FAMILIES }

/** Runtime contract for the credential-free quota presentation returned to RPC. */
export const quotaPresentationSchema = z
  .object({
    activeIndexByFamily: z.object({ claude: z.number().int().nonnegative(), gemini: z.number().int().nonnegative() }),
    accounts: z.array(
      z
        .object({
          id: z.string(),
          email: z.string(),
          enabled: z.boolean(),
          status: z.enum(["ok", "error", "unknown"]),
          groups: z.record(
            z.enum(["claude", "gemini-pro", "gemini-flash"]),
            z
              .object({
                remainingFraction: z.number().min(0).max(1).nullable(),
                consumedPercent: z.number().min(0).max(100).nullable(),
                resetTime: z.number().finite().nullable(),
              })
              .strict(),
          ),
          quotaSummary: z
            .object({
              groups: z.array(
                z
                  .object({
                    displayName: z.string().max(120),
                    description: z.string().max(300).nullable(),
                    buckets: z
                      .object({
                        weekly: z
                          .object({
                            remainingFraction: z.number().min(0).max(1).nullable(),
                            resetTime: z.number().finite().nullable(),
                          })
                          .strict(),
                        "5h": z
                          .object({
                            remainingFraction: z.number().min(0).max(1).nullable(),
                            resetTime: z.number().finite().nullable(),
                          })
                          .strict(),
                      })
                      .strict(),
                  })
                  .strict(),
              ),
              checkedAt: z.number().finite().nullable(),
              freshness: z.enum(["fresh", "stale", "unchecked"]),
              status: z.enum(["ok", "error", "unknown"]),
            })
            .strict(),
          checkedAt: z.number().finite().nullable(),
          freshness: z.enum(["fresh", "stale", "unchecked"]),
          verificationRequired: z.boolean(),
          cooldownUntil: z.number().finite().nullable(),
          coolingDown: z.boolean(),
          selectedByFamily: z.object({ claude: z.boolean(), gemini: z.boolean() }).strict(),
        })
        .strict(),
    ),
  })
  .strict()

export type QuotaPresentationSchema = z.infer<typeof quotaPresentationSchema>

export type {
  AccountList,
  AccountSummary,
  AccountTarget,
  TargetResolution,
  MutationFailure,
  MutationOutcome,
  MutationOp,
  MutateOptions,
  OAuthPersistInput,
  OAuthPersistOutcome,
  QuotaCheckOutcome,
  QuotaPresentationGroup,
  RedactedQuotaResult,
  SelectedAccountCredential as SelectedAccount,
  AccountVerificationResult as VerifyOutcome,
  AccountMutationResult,
  ResolutionFailure,
  AccountRefreshParts as RefreshParts,
  QuotaPresentation,
  QuotaPresentationOptions,
  AccountQuotaResult,
} from "../../modules/accounts/index.js"
export type { AccountMetadataV3, AccountStorageV4 } from "../../modules/accounts/index.js"
export { fingerprintRefreshToken } from "../filesystem/account-store.js"

/** Verification states presented in account summaries. */
export type VerificationStatus = AccountSummary["verificationStatus"]

/** Builds the account-domain service with host and storage dependencies supplied at the edge. */
function accountAdmin(client?: PluginClient, providerId = ANTIGRAVITY_PROVIDER_ID) {
  return createAccountAdmin({
    persistence: {
      load: loadAccounts,
      save: saveAccounts,
      saveReplace: saveAccountsReplace,
      update: updateAccounts,
    },
    fingerprintRefreshToken,
    generateId: randomUUID,
    now: () => Date.now(),
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

/** Assigns stable ids to legacy accounts on the next account write. */
export function ensureAccountIds(accounts: AccountMetadataV3[]): boolean {
  return ensureIds(accounts, randomUUID)
}

/** Projects stored account state to credential-free list DTOs. */
export function toAccountList(storage: AccountStorageV4) {
  return projectAccountList(storage, fingerprintRefreshToken)
}

/** Resolves account targets with the domain's fail-closed identity rules. */
export { resolveAccountTarget } from "../../modules/accounts/index.js"

/** Lists credential-free summaries from persisted account state. */
export function listAccounts() {
  return accountAdmin().list()
}

/** Checks quota for saved accounts and persists safe token rotations. */
export function checkQuota(client: PluginClient, providerId = ANTIGRAVITY_PROVIDER_ID): Promise<QuotaCheckOutcome> {
  return accountAdmin(client, providerId).checkQuota()
}

/** Builds validated, credential-free quota presentation for the account UI. */
export async function getQuotaPresentation(
  client: PluginClient,
  options: QuotaPresentationOptions = {},
  providerId = ANTIGRAVITY_PROVIDER_ID,
): Promise<QuotaPresentation> {
  const presentation = await accountAdmin(client, providerId).quota(options)
  return quotaPresentationSchema.parse(presentation)
}

/** Verifies account access and persists the outcome against its durable identity. */
export function verifyAccount(target: AccountTarget, client: PluginClient, providerId = ANTIGRAVITY_PROVIDER_ID) {
  return accountAdmin(client, providerId).verify(target)
}

/** Applies a fail-closed account mutation in one persistence transaction. */
export function mutateAccount(target: AccountTarget, operation: AccountMutation, options: AccountMutationOptions = {}) {
  return accountAdmin().mutate(target, operation, options)
}

/** Deletes all saved accounts and writes tombstones in the same transaction. */
export function deleteAllAccounts() {
  return accountAdmin().deleteAll()
}

/** Adds or reconnects an OAuth account while enforcing identity and capacity rules. */
export function persistOAuthAccount(
  input: { refresh: string; email?: string; projectId: string },
  action: "add" | "replace",
) {
  return accountAdmin().persistOAuthAccount(input, action)
}

/** Persists a refresh-token rotation only while the previous identity still exists. */
export function persistRefreshRotation(previousRefreshToken: string, rotatedRefreshToken: string): Promise<boolean> {
  return accountAdmin().persistRefreshRotation(previousRefreshToken, rotatedRefreshToken)
}
