import { ANTIGRAVITY_DEFAULT_PROJECT_ID } from "../constants"
import { antigravityManagedProjectPort } from "../adapters/antigravity/project-client.js"
import type { LoadCodeAssistPayload, ManagedProjectDiscovery } from "../adapters/antigravity/project-client.js"
import { formatRefreshParts, parseRefreshParts } from "./auth"
import { createLogger } from "./logger"
import type { OAuthAuthDetails, ProjectContextResult } from "./types"

const log = createLogger("project")

const projectContextResultCache = new Map<string, ProjectContextResult>()
const projectContextPendingCache = new Map<string, Promise<ProjectContextResult>>()

type AntigravityUserTier = NonNullable<ManagedProjectDiscovery["allowedTiers"]>[number]

/**
 * Selects the default tier ID from the allowed tiers list.
 */
function getDefaultTierId(allowedTiers?: AntigravityUserTier[]): string | undefined {
  if (!allowedTiers || allowedTiers.length === 0) {
    return undefined
  }
  for (const tier of allowedTiers) {
    if (tier?.isDefault) {
      return tier.id
    }
  }
  return allowedTiers[0]?.id
}

/**
 * Generates a cache key for project context based on refresh token.
 */
function getCacheKey(auth: OAuthAuthDetails): string | undefined {
  const refresh = auth.refresh?.trim()
  return refresh ? refresh : undefined
}

/**
 * Clears cached project context results and pending promises, globally or for a refresh key.
 */
export function invalidateProjectContextCache(refresh?: string): void {
  if (!refresh) {
    projectContextPendingCache.clear()
    projectContextResultCache.clear()
    return
  }
  projectContextPendingCache.delete(refresh)
  projectContextResultCache.delete(refresh)
}

/**
 * Loads managed project information for the given access token and optional project.
 */
export async function loadManagedProject(
  accessToken: string,
  projectId?: string,
): Promise<LoadCodeAssistPayload | null> {
  return (await antigravityManagedProjectPort.load({ accessToken, projectId, logger: log }))?.payload ?? null
}

/**
 * Onboards a managed project for the user, optionally retrying until completion.
 */
export async function onboardManagedProject(
  accessToken: string,
  tierId: string,
  projectId?: string,
  attempts = 10,
  delayMs = 5000,
): Promise<string | undefined> {
  const session = antigravityManagedProjectPort.startOnboarding({ accessToken, tierId, projectId, logger: log })
  while (true) {
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      const result = await session.attempt()
      if (result.kind === "complete") return result.projectId
      if (result.kind === "endpoint-unavailable") {
        break
      }
      await wait(delayMs)
    }
    if (!session.nextEndpoint()) return undefined
  }
}

/** Waits between provider onboarding attempts while leaving retry timing in project policy. */
function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Resolves an effective project ID for the current auth state, caching results per refresh token.
 */
export async function ensureProjectContext(auth: OAuthAuthDetails): Promise<ProjectContextResult> {
  const accessToken = auth.access
  if (!accessToken) {
    return { auth, effectiveProjectId: "" }
  }

  const cacheKey = getCacheKey(auth)
  if (cacheKey) {
    const cached = projectContextResultCache.get(cacheKey)
    if (cached) {
      return cached
    }
    const pending = projectContextPendingCache.get(cacheKey)
    if (pending) {
      return pending
    }
  }

  const resolveContext = async (): Promise<ProjectContextResult> => {
    const parts = parseRefreshParts(auth.refresh)
    if (parts.managedProjectId) {
      return { auth, effectiveProjectId: parts.managedProjectId }
    }

    const fallbackProjectId = ANTIGRAVITY_DEFAULT_PROJECT_ID
    const persistManagedProject = async (managedProjectId: string): Promise<ProjectContextResult> => {
      const updatedAuth: OAuthAuthDetails = {
        ...auth,
        refresh: formatRefreshParts({
          refreshToken: parts.refreshToken,
          projectId: parts.projectId,
          managedProjectId,
        }),
      }

      return { auth: updatedAuth, effectiveProjectId: managedProjectId }
    }

    // Try to resolve a managed project from Antigravity if possible.
    const projectDiscovery = await antigravityManagedProjectPort.load({
      accessToken,
      projectId: parts.projectId ?? fallbackProjectId,
      logger: log,
    })
    const resolvedManagedProjectId = projectDiscovery?.managedProjectId

    if (resolvedManagedProjectId) {
      return persistManagedProject(resolvedManagedProjectId)
    }

    // No managed project found - try to auto-provision one via onboarding.
    // This handles accounts that were added before managed project provisioning was required.
    const tierId = getDefaultTierId(projectDiscovery?.allowedTiers) ?? "FREE"
    log.debug("Auto-provisioning managed project", { tierId, projectId: parts.projectId })

    const provisionedProjectId = await onboardManagedProject(accessToken, tierId, parts.projectId)

    if (provisionedProjectId) {
      log.debug("Successfully provisioned managed project", { provisionedProjectId })
      return persistManagedProject(provisionedProjectId)
    }

    log.warn("Failed to provision managed project - account may not work correctly", {
      hasProjectId: !!parts.projectId,
    })

    if (parts.projectId) {
      return { auth, effectiveProjectId: parts.projectId }
    }

    // No project id present in auth; fall back to the hardcoded id for requests.
    return { auth, effectiveProjectId: fallbackProjectId }
  }

  if (!cacheKey) {
    return resolveContext()
  }

  const promise = resolveContext()
    .then((result) => {
      const nextKey = getCacheKey(result.auth) ?? cacheKey
      projectContextPendingCache.delete(cacheKey)
      projectContextResultCache.set(nextKey, result)
      if (nextKey !== cacheKey) {
        projectContextResultCache.delete(cacheKey)
      }
      return result
    })
    .catch((error) => {
      projectContextPendingCache.delete(cacheKey)
      throw error
    })

  projectContextPendingCache.set(cacheKey, promise)
  return promise
}
