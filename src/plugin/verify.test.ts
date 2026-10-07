import { beforeEach, describe, expect, it, vi } from "vitest"
import { AntigravityTokenRefreshError } from "./token.ts"
import type { PluginClient } from "../adapters/opencode/types.ts"

const { mockRefreshAccessToken, mockEnsureProjectContext } = vi.hoisted(() => ({
  mockRefreshAccessToken: vi.fn(),
  mockEnsureProjectContext: vi.fn(),
}))

vi.mock("./token.ts", async (importOriginal) => {
  const orig = await importOriginal<typeof import("./token.ts")>()
  return { ...orig, refreshAccessToken: mockRefreshAccessToken }
})

vi.mock("../adapters/opencode/project.js", async (importOriginal) => {
  const orig = await importOriginal<typeof import("../adapters/opencode/project.js")>()
  return { ...orig, ensureProjectContext: mockEnsureProjectContext }
})

import { verifyAccountAccess } from "./verify.ts"

/** Creates the minimal OpenCode client needed by account verification tests. */
function makeClient(): PluginClient {
  return {
    tui: { showToast: vi.fn(async () => ({ data: undefined })) },
    auth: { set: vi.fn(async () => ({ data: undefined })) },
  } as unknown as PluginClient
}

describe("verifyAccountAccess", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.unstubAllGlobals()
    mockEnsureProjectContext.mockResolvedValue({
      auth: { type: "oauth", refresh: "rt|proj", access: "at" },
      effectiveProjectId: "test-project",
    })
  })

  it("reports missing refresh tokens without network calls", async () => {
    const fetchSpy = vi.fn()
    vi.stubGlobal("fetch", fetchSpy)
    const result = await verifyAccountAccess({ refreshToken: "" }, makeClient(), "antigravity")
    expect(result).toMatchObject({ status: "error", message: "Missing refresh token for selected account." })
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it("surfaces token refresh failures", async () => {
    mockRefreshAccessToken.mockRejectedValueOnce(
      new AntigravityTokenRefreshError({
        message: "Antigravity token refresh failed (400 Bad Request) - invalid_grant",
        code: "invalid_grant",
        status: 400,
        statusText: "Bad Request",
      }),
    )
    const result = await verifyAccountAccess({ refreshToken: "rt" }, makeClient(), "antigravity")
    expect(result.status).toBe("error")
    expect(result.message).toContain("invalid_grant")
  })

  it("passes when the probe request succeeds", async () => {
    mockRefreshAccessToken.mockResolvedValueOnce({
      type: "oauth",
      refresh: "rt|proj",
      access: "probe-access",
      expires: Date.now() + 3600_000,
    })
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response("{}", {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
      ),
    )
    const result = await verifyAccountAccess({ refreshToken: "rt" }, makeClient(), "antigravity")
    expect(result).toMatchObject({ status: "ok" })
  })

  it("flags accounts blocked by Google validation", async () => {
    mockRefreshAccessToken.mockResolvedValueOnce({
      type: "oauth",
      refresh: "rt|proj",
      access: "probe-access",
      expires: Date.now() + 3600_000,
    })
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              error: {
                message:
                  "validation_required: verify your account at https://accounts.google.com/signin/continue?plt=1",
              },
            }),
            { status: 403, headers: { "content-type": "application/json" } },
          ),
      ),
    )
    const result = await verifyAccountAccess({ refreshToken: "rt" }, makeClient(), "antigravity")
    expect(result.status).toBe("blocked")
    expect(result.verifyUrl).toContain("accounts.google.com")
  })
})
