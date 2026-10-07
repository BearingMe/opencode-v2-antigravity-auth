import { describe, expect, it, vi } from "vitest"
import { createQuotaDialogController, type QuotaDialogDeps } from "./quota-controller.js"
import type { QuotaDetailSnapshot, QuotaRefreshOutcome } from "./account-ui-format.js"

/** Builds a stale quota snapshot with the requested Claude fraction. */
function snapshot(claudeFraction: number | null = 0.7): QuotaDetailSnapshot {
  return {
    groups: {
      claude: { remainingFraction: claudeFraction, resetTime: null },
      "gemini-pro": { remainingFraction: null, resetTime: null },
      "gemini-flash": { remainingFraction: 1, resetTime: null },
    },
    checkedAt: 1_700_000_000_000,
    freshness: "stale",
    status: "ok",
  }
}

/** Supplies controller dependencies with optional behavior overrides. */
function createDeps(overrides: Partial<QuotaDialogDeps> = {}) {
  const deps: QuotaDialogDeps = {
    initial: snapshot(),
    refreshQuota: vi.fn(async (): Promise<QuotaRefreshOutcome> => ({ ok: true, entry: snapshot(0.2) })),
    notifyRefreshFailed: vi.fn(),
    showMissingThenList: vi.fn(async () => undefined),
    goList: vi.fn(async () => undefined),
    ...overrides,
  }
  return deps
}

describe("createQuotaDialogController", () => {
  it("starts from the cached entry with no flags", () => {
    const controller = createQuotaDialogController(createDeps())
    expect(controller.snapshot()).toEqual({ entry: snapshot(), refreshing: false, failed: false })
  })

  it("refreshes the entry and notifies subscribers on each transition", async () => {
    let resolveRefresh!: (outcome: QuotaRefreshOutcome) => void
    const deps = createDeps({
      refreshQuota: vi.fn(
        () =>
          new Promise<QuotaRefreshOutcome>((resolve) => {
            resolveRefresh = resolve
          }),
      ),
    })
    const controller = createQuotaDialogController(deps)
    const seen: Array<boolean> = []
    controller.subscribe(() => {
      seen.push(controller.snapshot().refreshing)
    })
    const pending = controller.refresh()
    expect(controller.snapshot().refreshing).toBe(true)
    resolveRefresh({ ok: true, entry: snapshot(0.2) })
    await pending
    expect(controller.snapshot()).toEqual({ entry: snapshot(0.2), refreshing: false, failed: false })
    expect(seen).toEqual([true, false])
    expect(deps.goList).not.toHaveBeenCalled()
  })

  it("ignores overlapping refresh requests", async () => {
    let resolveRefresh!: (outcome: QuotaRefreshOutcome) => void
    const refreshQuota = vi.fn(
      () =>
        new Promise<QuotaRefreshOutcome>((resolve) => {
          resolveRefresh = resolve
        }),
    )
    const controller = createQuotaDialogController(createDeps({ refreshQuota }))
    const first = controller.refresh()
    await controller.refresh()
    expect(refreshQuota).toHaveBeenCalledTimes(1)
    resolveRefresh({ ok: true, entry: snapshot(0.2) })
    await first
    expect(controller.snapshot().entry).toEqual(snapshot(0.2))
  })

  it("keeps cached values and notifies when refresh fails", async () => {
    const deps = createDeps({
      refreshQuota: vi.fn(async (): Promise<QuotaRefreshOutcome> => ({
        ok: false,
        reason: "failed",
        invalidResponse: true,
      })),
    })
    const controller = createQuotaDialogController(deps)
    await controller.refresh()
    expect(controller.snapshot()).toEqual({ entry: snapshot(), refreshing: false, failed: true })
    expect(deps.notifyRefreshFailed).toHaveBeenCalledWith(true)
    expect(deps.showMissingThenList).not.toHaveBeenCalled()
  })

  it("routes a deleted account to the missing path, never a zeroed view", async () => {
    const deps = createDeps({
      refreshQuota: vi.fn(async (): Promise<QuotaRefreshOutcome> => ({
        ok: false,
        reason: "missing",
        invalidResponse: false,
      })),
    })
    const controller = createQuotaDialogController(deps)
    await controller.refresh()
    expect(deps.showMissingThenList).toHaveBeenCalledOnce()
    expect(deps.notifyRefreshFailed).not.toHaveBeenCalled()
    expect(controller.snapshot().entry).toEqual(snapshot())
  })

  it("treats returned error status as a failed check, not a successful RPC", async () => {
    const deps = createDeps({ refreshQuota: async () => ({ ok: true, entry: { ...snapshot(0), status: "error" } }) })
    const controller = createQuotaDialogController(deps)
    await controller.refresh()
    expect(controller.snapshot()).toEqual({ entry: snapshot(), refreshing: false, failed: true })
    expect(deps.notifyRefreshFailed).toHaveBeenCalledWith(false, true)
  })

  it("accepts a fresh grouped result when the per-model probe fails", async () => {
    const cachedSummary = {
      groups: [
        {
          displayName: "Gemini Models",
          description: "Cached quota",
          buckets: {
            weekly: { remainingFraction: 0.5, resetTime: null },
            "5h": { remainingFraction: 0.5, resetTime: null },
          },
        },
      ],
      checkedAt: 1_700_000_000_000,
      freshness: "stale" as const,
      status: "ok" as const,
    }
    const freshSummary = {
      ...cachedSummary,
      groups: [
        {
          ...cachedSummary.groups[0]!,
          description: "Fresh quota",
          buckets: {
            weekly: { remainingFraction: 0.7, resetTime: null },
            "5h": { remainingFraction: 1, resetTime: null },
          },
        },
      ],
      checkedAt: 1_800_000_000_000,
      freshness: "fresh" as const,
    }
    const controller = createQuotaDialogController(
      createDeps({
        initial: { ...snapshot(), quotaSummary: cachedSummary },
        refreshQuota: async () => ({
          ok: true,
          entry: { ...snapshot(), status: "error", quotaSummary: freshSummary },
        }),
      }),
    )

    await controller.refresh()

    expect(controller.snapshot()).toMatchObject({
      failed: true,
      entry: {
        groups: snapshot().groups,
        quotaSummary: { status: "ok", freshness: "fresh", groups: [{ description: "Fresh quota" }] },
      },
    })
  })

  it("recovers from unexpected rejection and allows retry", async () => {
    const deps = createDeps({
      refreshQuota: vi
        .fn()
        .mockRejectedValueOnce(new Error("offline"))
        .mockResolvedValueOnce({ ok: true, entry: snapshot(0.2) }),
    })
    const controller = createQuotaDialogController(deps)
    await controller.refresh()
    expect(controller.snapshot().refreshing).toBe(false)
    expect(controller.snapshot().failed).toBe(true)
    await controller.refresh()
    expect(controller.snapshot().entry).toEqual(snapshot(0.2))
    expect(controller.snapshot().failed).toBe(false)
  })

  it("ignores late results and notifications after disposal", async () => {
    let resolve!: (result: QuotaRefreshOutcome) => void
    const deps = createDeps({
      refreshQuota: () =>
        new Promise((done) => {
          resolve = done
        }),
    })
    const controller = createQuotaDialogController(deps)
    const listener = vi.fn()
    controller.subscribe(listener)
    const pending = controller.refresh()
    controller.dispose()
    listener.mockClear()
    resolve({ ok: false, reason: "missing", invalidResponse: false })
    await pending
    expect(listener).not.toHaveBeenCalled()
    expect(deps.showMissingThenList).not.toHaveBeenCalled()
  })

  it("retains a concurrent disable and blocks subsequent refresh", async () => {
    const refreshQuota = vi.fn(async (): Promise<QuotaRefreshOutcome> => ({
      ok: true,
      entry: { ...snapshot(0.2), enabled: false },
    }))
    const controller = createQuotaDialogController(
      createDeps({ initial: { ...snapshot(), enabled: true }, refreshQuota }),
    )
    await controller.refresh()
    expect(controller.snapshot().entry.enabled).toBe(false)
    await controller.refresh()
    expect(refreshQuota).toHaveBeenCalledTimes(1)
  })

  it("keeps last-good bars but applies a disabled state from an error response", async () => {
    const controller = createQuotaDialogController(
      createDeps({
        initial: { ...snapshot(), enabled: true },
        refreshQuota: async () => ({ ok: true, entry: { ...snapshot(0), enabled: false, status: "error" } }),
      }),
    )
    await controller.refresh()
    expect(controller.snapshot().entry).toEqual({ ...snapshot(), enabled: false })
  })

  it("backs to the account list without touching quota state", async () => {
    const deps = createDeps()
    const controller = createQuotaDialogController(deps)
    await controller.back()
    expect(deps.goList).toHaveBeenCalledOnce()
    expect(deps.refreshQuota).not.toHaveBeenCalled()
  })

  it("supports unsubscribe and ignores input after dispose", async () => {
    const deps = createDeps()
    const controller = createQuotaDialogController(deps)
    const listener = vi.fn()
    const stop = controller.subscribe(listener)
    await controller.refresh()
    expect(listener).toHaveBeenCalled()
    listener.mockClear()
    stop()
    deps.refreshQuota = vi.fn(async (): Promise<QuotaRefreshOutcome> => ({ ok: true, entry: snapshot(0.1) }))
    await controller.refresh()
    expect(listener).not.toHaveBeenCalled()
    controller.dispose()
    await controller.refresh()
    await controller.back()
    expect(deps.goList).not.toHaveBeenCalled()
  })
})
