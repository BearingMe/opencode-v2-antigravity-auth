import { describe, expect, it, vi } from "vitest"
import { createAccountCredentialRefreshPolicy } from "./policy.js"

interface TestCredential {
  type: "oauth"
  refresh: string
  access?: string
  expires?: number
}

/** Creates the credential policy with deterministic token and cache boundaries. */
function createPolicy(refresh: ReturnType<typeof vi.fn>) {
  const storeCachedCredential = vi.fn()
  const invalidateProjectContext = vi.fn()
  const clearCachedCredential = vi.fn()
  const warn = vi.fn()
  const error = vi.fn()
  const policy = createAccountCredentialRefreshPolicy<
    TestCredential,
    { refreshToken: string; projectId?: string; managedProjectId?: string },
    { accessToken: string; expiresIn: unknown; refreshToken?: string }
  >({
    port: { refresh },
    parseParts: (packed) => {
      const [refreshToken = "", projectId, managedProjectId] = packed.split("|")
      return { refreshToken, projectId: projectId || undefined, managedProjectId: managedProjectId || undefined }
    },
    formatParts: ({ refreshToken, projectId, managedProjectId }) =>
      `${refreshToken}|${projectId ?? ""}${managedProjectId ? `|${managedProjectId}` : ""}`,
    calculateExpiry: (startedAt, expiresIn) => startedAt + Number(expiresIn) * 1000,
    now: () => 500,
    storeCachedCredential,
    invalidateProjectContext,
    clearCachedCredential,
    parseEndpointFailure: (cause) =>
      cause instanceof Error && cause.message === "revoked"
        ? { message: "revoked", code: "invalid_grant", status: 400, statusText: "Bad Request" }
        : undefined,
    createRefreshError: (failure) => Object.assign(new Error(failure.message), { code: failure.code }),
    isRefreshError: (cause) => cause instanceof Error && "code" in cause,
    logger: { warn, error },
  })
  return { policy, storeCachedCredential, invalidateProjectContext, clearCachedCredential, warn, error }
}

describe("account credential refresh policy", () => {
  it("rotates only the refresh token while preserving project context and updating the cache", async () => {
    const { policy, storeCachedCredential, invalidateProjectContext } = createPolicy(
      vi.fn(async () => ({ accessToken: "new-access", expiresIn: 60, refreshToken: "rotated" })),
    )
    const auth: TestCredential = {
      type: "oauth",
      refresh: "original|project|managed-project",
      access: "old-access",
      expires: 0,
    }

    const refreshed = await policy.refresh(auth)

    expect(refreshed).toEqual({
      ...auth,
      access: "new-access",
      expires: 60_500,
      refresh: "rotated|project|managed-project",
    })
    expect(storeCachedCredential).toHaveBeenCalledWith(refreshed)
    expect(invalidateProjectContext).toHaveBeenCalledWith(auth.refresh)
  })

  it("clears revoked credential and project caches before returning the typed failure", async () => {
    const { policy, invalidateProjectContext, clearCachedCredential, warn } = createPolicy(
      vi.fn(async () => {
        throw new Error("revoked")
      }),
    )
    const auth: TestCredential = { type: "oauth", refresh: "revoked-token|project", access: "old", expires: 0 }

    await expect(policy.refresh(auth)).rejects.toMatchObject({ message: "revoked", code: "invalid_grant" })

    expect(invalidateProjectContext).toHaveBeenCalledWith(auth.refresh)
    expect(clearCachedCredential).toHaveBeenCalledWith(auth.refresh)
    expect(warn).toHaveBeenCalled()
  })

  it("degrades unexpected refresh errors to an unavailable credential", async () => {
    const { policy, error } = createPolicy(vi.fn(async () => Promise.reject(new Error("network unavailable"))))

    await expect(policy.refresh({ type: "oauth", refresh: "refresh|project" })).resolves.toBeUndefined()
    expect(error).toHaveBeenCalledWith("Unexpected token refresh error", { error: "Error: network unavailable" })
  })
})
