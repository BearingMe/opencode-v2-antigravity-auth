import { AccountRefreshQueue, type ProactiveRefreshConfig } from "../modules/accounts/index.js"
import { createLogger } from "./logger.js"
import type { AccountManager, ManagedAccount } from "./accounts.js"
import { refreshAccessToken } from "./token.js"
import type { OAuthAuthDetails, PluginClient } from "./types.js"

/** Re-exports the legacy queue configuration contract. */
export type { ProactiveRefreshConfig } from "../modules/accounts/index.js"
export { DEFAULT_PROACTIVE_REFRESH_CONFIG } from "../modules/accounts/index.js"

const log = createLogger("refresh-queue")

/** Host-composed compatibility queue backed by account lifecycle policy. */
export class ProactiveRefreshQueue extends AccountRefreshQueue<ManagedAccount, OAuthAuthDetails> {
  /** Creates a refresh queue using the existing unified token refresh path. */
  constructor(client: PluginClient, providerId: string, config?: Partial<ProactiveRefreshConfig>) {
    super(
      {
        clock: { now: () => Date.now() },
        refresh: (credential) => refreshAccessToken(credential, client, providerId),
        logger: log,
      },
      config,
    )
  }

  /** Attaches the plugin account manager to this queue. */
  override setAccountManager(manager: AccountManager): void {
    super.setAccountManager(manager)
  }
}

/** Creates a proactive queue while preserving the plugin-facing factory. */
export function createProactiveRefreshQueue(
  client: PluginClient,
  providerId: string,
  config?: Partial<ProactiveRefreshConfig>,
): ProactiveRefreshQueue {
  return new ProactiveRefreshQueue(client, providerId, config)
}
