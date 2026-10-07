import { AccountRefreshQueue, type ProactiveRefreshConfig } from "../../modules/accounts/index.js"
import { createLogger } from "./logger.js"
import type { ManagedAccount } from "../../modules/accounts/index.js"
import { refreshAccessToken } from "./token.js"
import type { AccountOAuthCredential } from "../../modules/accounts/index.js"
import type { PluginClient } from "./types.js"

const log = createLogger("refresh-queue")

/** Composes account refresh scheduling with the provider token-refresh adapter. */
export class ProactiveRefreshQueue extends AccountRefreshQueue<ManagedAccount, AccountOAuthCredential> {
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
}

/** Creates a proactive queue wired to the plugin token-refresh path. */
export function createProactiveRefreshQueue(
  client: PluginClient,
  providerId: string,
  config?: Partial<ProactiveRefreshConfig>,
): ProactiveRefreshQueue {
  return new ProactiveRefreshQueue(client, providerId, config)
}
