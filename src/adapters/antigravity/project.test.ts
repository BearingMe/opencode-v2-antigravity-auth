import { afterEach, describe, expect, it, vi } from "vitest"

const { antigravityManagedProjectPort } = vi.hoisted(() => ({
  antigravityManagedProjectPort: {
    load: vi.fn(),
    startOnboarding: vi.fn(),
  },
}))

vi.mock("./project-client.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./project-client.js")>()),
  antigravityManagedProjectPort,
}))

import { createAntigravityProjectService } from "./project.js"

const { onboardManagedProject } = createAntigravityProjectService({ debug: vi.fn(), warn: vi.fn() })

afterEach(() => {
  vi.clearAllMocks()
  vi.useRealTimers()
})

describe("managed-project onboarding policy", () => {
  it("retries pending onboarding on the current endpoint and advances after it is unavailable", async () => {
    vi.useFakeTimers()
    const attempt = vi
      .fn()
      .mockResolvedValueOnce({ kind: "pending" as const })
      .mockResolvedValueOnce({ kind: "endpoint-unavailable" as const })
      .mockResolvedValueOnce({ kind: "complete" as const, projectId: "managed-project" })
    const nextEndpoint = vi.fn(() => true)
    antigravityManagedProjectPort.startOnboarding.mockReturnValue({ attempt, nextEndpoint })

    const pending = onboardManagedProject("synthetic-access", "FREE", "project-hint", 2, 50)
    expect(attempt).toHaveBeenCalledOnce()
    await vi.advanceTimersByTimeAsync(50)

    await expect(pending).resolves.toBe("managed-project")
    expect(attempt).toHaveBeenCalledTimes(3)
    expect(nextEndpoint).toHaveBeenCalledOnce()
  })
})
