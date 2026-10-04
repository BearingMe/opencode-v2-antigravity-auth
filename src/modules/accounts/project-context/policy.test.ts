import { describe, expect, it, vi } from "vitest"
import { createProjectContextPolicy } from "./policy.js"
import type { AccountManagedProjectOnboardingSession } from "../ports.js"

interface TestCredential {
  refresh: string
  access?: string
}

/** Creates a policy with deterministic managed-project ports and credential packing. */
function createPolicy(
  overrides: {
    load?: (accessToken: string, projectId?: string) => Promise<{ managedProjectId?: string } | null>
    startOnboarding?: () => AccountManagedProjectOnboardingSession
  } = {},
) {
  const load = vi.fn(overrides.load ?? (async () => ({ managedProjectId: "managed-project" })))
  const startOnboarding = vi.fn(
    overrides.startOnboarding ??
      (() => ({ attempt: async () => ({ kind: "endpoint-unavailable" as const }), nextEndpoint: () => false })),
  )
  const wait = vi.fn(async () => undefined)
  const policy = createProjectContextPolicy<
    TestCredential,
    { refreshToken: string; projectId?: string; managedProjectId?: string },
    { managedProjectId?: string }
  >({
    port: { load, startOnboarding },
    parseParts: (refresh) => {
      const [refreshToken = "", projectId, managedProjectId] = refresh.split("|")
      return { refreshToken, projectId: projectId || undefined, managedProjectId: managedProjectId || undefined }
    },
    formatParts: ({ refreshToken, projectId, managedProjectId }) =>
      `${refreshToken}|${projectId ?? ""}|${managedProjectId ?? ""}`,
    fallbackProjectId: "fallback-project",
    logger: { debug: () => undefined, warn: () => undefined },
    wait,
  })
  return { policy, load, startOnboarding, wait }
}

describe("account project-context policy", () => {
  it("coalesces concurrent discovery and caches by packed refresh identity", async () => {
    let resolveLoad: ((value: { managedProjectId: string }) => void) | undefined
    const { policy, load } = createPolicy({
      load: () => new Promise((resolve) => (resolveLoad = resolve)),
    })
    const auth = { refresh: "refresh|project-hint", access: "access" }

    const first = policy.ensureProjectContext(auth)
    const second = policy.ensureProjectContext(auth)
    resolveLoad?.({ managedProjectId: "managed-project" })

    const firstResult = await first
    expect(firstResult).toMatchObject({ effectiveProjectId: "managed-project" })
    await expect(second).resolves.toMatchObject({ effectiveProjectId: "managed-project" })
    await policy.ensureProjectContext(firstResult.auth)

    expect(load).toHaveBeenCalledOnce()
  })

  it("keeps project hints as fallback when discovery and onboarding fail", async () => {
    const { policy, startOnboarding } = createPolicy({ load: async () => null })
    const auth = { refresh: "refresh|project-hint", access: "access" }

    const result = await policy.ensureProjectContext(auth)

    expect(result).toEqual({ auth, effectiveProjectId: "project-hint" })
    expect(startOnboarding).toHaveBeenCalledWith({ accessToken: "access", projectId: "project-hint", tierId: "FREE" })
  })

  it("retries pending onboarding before advancing an unavailable endpoint", async () => {
    const attempt = vi
      .fn()
      .mockResolvedValueOnce({ kind: "pending" as const })
      .mockResolvedValueOnce({ kind: "endpoint-unavailable" as const })
      .mockResolvedValueOnce({ kind: "complete" as const, projectId: "created-project" })
    const nextEndpoint = vi.fn(() => true)
    const { policy, wait } = createPolicy({
      startOnboarding: () => ({ attempt, nextEndpoint }),
      load: async () => null,
    })

    const result = await policy.ensureProjectContext({ refresh: "refresh|hint", access: "access" })

    expect(result.effectiveProjectId).toBe("created-project")
    expect(result.auth.refresh).toBe("refresh|hint|created-project")
    expect(attempt).toHaveBeenCalledTimes(3)
    expect(nextEndpoint).toHaveBeenCalledOnce()
    expect(wait).toHaveBeenCalledOnce()
  })

  it("returns an empty project without transport when no access token exists", async () => {
    const { policy, load } = createPolicy()
    const auth = { refresh: "refresh|hint" }

    await expect(policy.ensureProjectContext(auth)).resolves.toEqual({ auth, effectiveProjectId: "" })
    expect(load).not.toHaveBeenCalled()
  })
})
