import { ANTIGRAVITY_DEFAULT_PROJECT_ID } from "../constants.js"
import { antigravityManagedProjectPort } from "../adapters/antigravity/project-client.js"
import type { LoadCodeAssistPayload, ManagedProjectDiscovery } from "../adapters/antigravity/project-client.js"
import { createProjectContextPolicy } from "../modules/accounts/index.js"
import { formatRefreshParts, parseRefreshParts } from "../modules/accounts/index.js"
import { createLogger } from "../adapters/opencode/logger.js"
import type { AccountOAuthCredential, AccountRefreshParts, ProjectContextResult } from "../modules/accounts/index.js"

const log = createLogger("project")

const projectContextPolicy = createProjectContextPolicy<
  AccountOAuthCredential,
  AccountRefreshParts,
  ManagedProjectDiscovery
>({
  port: {
    load: (accessToken, projectId) => antigravityManagedProjectPort.load({ accessToken, projectId, logger: log }),
    startOnboarding: ({ accessToken, tierId, projectId }) =>
      antigravityManagedProjectPort.startOnboarding({ accessToken, tierId, projectId, logger: log }),
  },
  parseParts: parseRefreshParts,
  formatParts: formatRefreshParts,
  fallbackProjectId: ANTIGRAVITY_DEFAULT_PROJECT_ID,
  logger: log,
  wait: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
})

/** Clears cached project context results and pending promises, globally or for a refresh key. */
export function invalidateProjectContextCache(refresh?: string): void {
  projectContextPolicy.invalidateCache(refresh)
}

/** Loads managed project information for the given access token and optional project. */
export async function loadManagedProject(
  accessToken: string,
  projectId?: string,
): Promise<LoadCodeAssistPayload | null> {
  return (await antigravityManagedProjectPort.load({ accessToken, projectId, logger: log }))?.payload ?? null
}

/** Onboards a managed project, retrying pending requests before advancing endpoints. */
export function onboardManagedProject(
  accessToken: string,
  tierId: string,
  projectId?: string,
  attempts = 10,
  delayMs = 5000,
): Promise<string | undefined> {
  return projectContextPolicy.onboardManagedProject(accessToken, tierId, projectId, attempts, delayMs)
}

/** Resolves an effective project ID for current auth, caching by refresh credential. */
export function ensureProjectContext(
  auth: AccountOAuthCredential,
): Promise<ProjectContextResult<AccountOAuthCredential>> {
  return projectContextPolicy.ensureProjectContext(auth)
}
