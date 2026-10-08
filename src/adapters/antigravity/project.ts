import { ANTIGRAVITY_DEFAULT_PROJECT_ID } from "./constants.js"
import { antigravityManagedProjectPort } from "./project-client.js"
import type { LoadCodeAssistPayload, ManagedProjectDiscovery } from "./project-client.js"
import { createProjectContextPolicy, formatRefreshParts, parseRefreshParts } from "../../modules/accounts/index.js"
import type { AccountOAuthCredential, AccountRefreshParts, ProjectContextResult } from "../../modules/accounts/index.js"
import type { Logger } from "../../platform/logging/index.js"

/** Project operations bound to Antigravity transport and account policy. */
export interface AntigravityProjectService {
  invalidateProjectContextCache(refresh?: string): void
  loadManagedProject(accessToken: string, projectId?: string): Promise<LoadCodeAssistPayload | null>
  onboardManagedProject(
    accessToken: string,
    tierId: string,
    projectId?: string,
    attempts?: number,
    delayMs?: number,
  ): Promise<string | undefined>
  ensureProjectContext(auth: AccountOAuthCredential): Promise<ProjectContextResult<AccountOAuthCredential>>
}

/** Composes account project policy with Antigravity transport and host logging. */
export function createAntigravityProjectService(logger: Pick<Logger, "debug" | "warn">): AntigravityProjectService {
  const projectContextPolicy = createProjectContextPolicy<
    AccountOAuthCredential,
    AccountRefreshParts,
    ManagedProjectDiscovery
  >({
    port: {
      load: (accessToken, projectId) => antigravityManagedProjectPort.load({ accessToken, projectId, logger }),
      startOnboarding: ({ accessToken, tierId, projectId }) =>
        antigravityManagedProjectPort.startOnboarding({ accessToken, tierId, projectId, logger }),
    },
    parseParts: parseRefreshParts,
    formatParts: formatRefreshParts,
    fallbackProjectId: ANTIGRAVITY_DEFAULT_PROJECT_ID,
    logger,
    wait: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  })

  /** Clears cached project-context results and pending promises. */
  function invalidateProjectContextCache(refresh?: string): void {
    projectContextPolicy.invalidateCache(refresh)
  }

  /** Loads managed project information for the given access token and optional project. */
  async function loadManagedProject(accessToken: string, projectId?: string): Promise<LoadCodeAssistPayload | null> {
    return (await antigravityManagedProjectPort.load({ accessToken, projectId, logger }))?.payload ?? null
  }

  /** Onboards a managed project, retrying pending requests before advancing endpoints. */
  function onboardManagedProject(
    accessToken: string,
    tierId: string,
    projectId?: string,
    attempts = 10,
    delayMs = 5000,
  ): Promise<string | undefined> {
    return projectContextPolicy.onboardManagedProject(accessToken, tierId, projectId, attempts, delayMs)
  }

  /** Resolves an effective project ID for current auth, caching by refresh credential. */
  function ensureProjectContext(auth: AccountOAuthCredential): Promise<ProjectContextResult<AccountOAuthCredential>> {
    return projectContextPolicy.ensureProjectContext(auth)
  }

  return {
    invalidateProjectContextCache,
    loadManagedProject,
    onboardManagedProject,
    ensureProjectContext,
  }
}
