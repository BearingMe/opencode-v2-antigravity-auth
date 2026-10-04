import type { AccountRefreshParts } from "../index.js"
import type { AccountManagedProjectOnboardingSession } from "../ports.js"

/** Credential fields required to resolve a managed project. */
export interface ProjectContextCredential {
  refresh: string
  access?: string
}

/** Safe subset of project discovery consumed by account lifecycle policy. */
export interface ManagedProjectDiscovery {
  managedProjectId?: string
  allowedTiers?: Array<{ id?: string; isDefault?: boolean }>
}

/** Effective project selection paired with any updated packed credential. */
export interface ProjectContextResult<Credential extends ProjectContextCredential> {
  auth: Credential
  effectiveProjectId: string
}

/** Managed project transport operations required by account project policy. */
export interface ProjectContextPort<Discovery extends ManagedProjectDiscovery> {
  load(accessToken: string, projectId?: string): Promise<Discovery | null>
  startOnboarding(input: {
    accessToken: string
    tierId: string
    projectId?: string
  }): AccountManagedProjectOnboardingSession
}

/** Diagnostics used by project discovery and onboarding policy. */
export interface ProjectContextLogger {
  debug(message: string, context?: Record<string, unknown>): void
  warn(message: string, context?: Record<string, unknown>): void
}

/** Dependencies for managed project lookup, onboarding, and coalesced caching. */
export interface ProjectContextPolicyDependencies<
  Credential extends ProjectContextCredential,
  Parts extends AccountRefreshParts,
  Discovery extends ManagedProjectDiscovery,
> {
  port: ProjectContextPort<Discovery>
  parseParts(refresh: string): Parts
  formatParts(parts: AccountRefreshParts): string
  fallbackProjectId: string
  logger: ProjectContextLogger
  wait(ms: number): Promise<void>
}

/** Creates the cached account project-context and managed-project onboarding policy. */
export function createProjectContextPolicy<
  Credential extends ProjectContextCredential,
  Parts extends AccountRefreshParts,
  Discovery extends ManagedProjectDiscovery,
>(dependencies: ProjectContextPolicyDependencies<Credential, Parts, Discovery>) {
  const resultCache = new Map<string, ProjectContextResult<Credential>>()
  const pendingCache = new Map<string, Promise<ProjectContextResult<Credential>>>()

  /** Chooses the provider's default tier, falling back to its first listed tier. */
  function getDefaultTierId(allowedTiers?: Discovery["allowedTiers"]): string | undefined {
    if (!allowedTiers || allowedTiers.length === 0) return undefined
    for (const tier of allowedTiers) {
      if (tier?.isDefault) return tier.id
    }
    return allowedTiers[0]?.id
  }

  /** Builds a stable cache key from the packed refresh credential. */
  function getCacheKey(auth: Credential): string | undefined {
    const refresh = auth.refresh?.trim()
    return refresh ? refresh : undefined
  }

  /** Retries pending onboarding on each endpoint before advancing to the next. */
  async function onboardManagedProject(
    accessToken: string,
    tierId: string,
    projectId?: string,
    attempts = 10,
    delayMs = 5000,
  ): Promise<string | undefined> {
    const session = dependencies.port.startOnboarding({ accessToken, tierId, projectId })
    while (true) {
      for (let attempt = 0; attempt < attempts; attempt += 1) {
        const result = await session.attempt()
        if (result.kind === "complete") return result.projectId
        if (result.kind === "endpoint-unavailable") break
        await dependencies.wait(delayMs)
      }
      if (!session.nextEndpoint()) return undefined
    }
  }

  /** Clears all cached project contexts or only entries for one refresh key. */
  function invalidateCache(refresh?: string): void {
    if (!refresh) {
      pendingCache.clear()
      resultCache.clear()
      return
    }
    pendingCache.delete(refresh)
    resultCache.delete(refresh)
  }

  /** Resolves and caches a project id, coalescing simultaneous requests per credential. */
  async function ensureProjectContext(auth: Credential): Promise<ProjectContextResult<Credential>> {
    const accessToken = auth.access
    if (!accessToken) return { auth, effectiveProjectId: "" }

    const cacheKey = getCacheKey(auth)
    if (cacheKey) {
      const cached = resultCache.get(cacheKey)
      if (cached) return cached
      const pending = pendingCache.get(cacheKey)
      if (pending) return pending
    }

    /** Discovers or provisions one managed project and preserves fallback behavior. */
    const resolveContext = async (): Promise<ProjectContextResult<Credential>> => {
      const parts = dependencies.parseParts(auth.refresh)
      if (parts.managedProjectId) return { auth, effectiveProjectId: parts.managedProjectId }

      /** Packs the discovered project into a replacement credential for its caller. */
      const persistManagedProject = (managedProjectId: string): ProjectContextResult<Credential> => {
        const updatedAuth = {
          ...auth,
          refresh: dependencies.formatParts({
            refreshToken: parts.refreshToken,
            projectId: parts.projectId,
            managedProjectId,
          }),
        } as Credential
        return { auth: updatedAuth, effectiveProjectId: managedProjectId }
      }

      const discovery = await dependencies.port.load(accessToken, parts.projectId ?? dependencies.fallbackProjectId)
      if (discovery?.managedProjectId) return persistManagedProject(discovery.managedProjectId)

      const tierId = getDefaultTierId(discovery?.allowedTiers) ?? "FREE"
      dependencies.logger.debug("Auto-provisioning managed project", { tierId, projectId: parts.projectId })
      const provisionedProjectId = await onboardManagedProject(accessToken, tierId, parts.projectId)
      if (provisionedProjectId) {
        dependencies.logger.debug("Successfully provisioned managed project", { provisionedProjectId })
        return persistManagedProject(provisionedProjectId)
      }

      dependencies.logger.warn("Failed to provision managed project - account may not work correctly", {
        hasProjectId: !!parts.projectId,
      })
      return {
        auth,
        effectiveProjectId: parts.projectId ?? dependencies.fallbackProjectId,
      }
    }

    if (!cacheKey) return resolveContext()

    const promise = resolveContext()
      .then((result) => {
        const nextKey = getCacheKey(result.auth) ?? cacheKey
        pendingCache.delete(cacheKey)
        resultCache.set(nextKey, result)
        if (nextKey !== cacheKey) resultCache.delete(cacheKey)
        return result
      })
      .catch((error: unknown) => {
        pendingCache.delete(cacheKey)
        throw error
      })
    pendingCache.set(cacheKey, promise)
    return promise
  }

  return { ensureProjectContext, invalidateCache, onboardManagedProject }
}
