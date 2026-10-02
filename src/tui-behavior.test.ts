import { describe, expect, it, vi } from "vitest"
import plugin, { isInvalidRpcResponse, isStaleMutate } from "./tui.js"
import type { MissingAccountDialogProps, QuotaDialogProps } from "./tui-quota-dialog.js"
import type { AccountListDialogProps } from "./tui-account-list-dialog.js"

// Host-stack tests inspect view props; real pixels/reactivity are exercised
// separately against the compiled artifact in the Bun renderer suite.
vi.mock("./tui-quota-dialog.js", () => ({
  QuotaDialogView: (props: unknown) => props,
  MissingAccountDialogView: (props: unknown) => ({ missingProps: props }),
}))
vi.mock("./tui-account-list-dialog.js", () => ({ AccountListDialogView: (props: unknown) => ({ listProps: props }) }))

describe("isInvalidRpcResponse", () => {
  it("matches the host transport-codec rejection shape", () => {
    const error = new Error('Expected JSON value at ["output"]')
    error.name = "InvalidRequestError"
    expect(isInvalidRpcResponse(error)).toBe(true)
  })

  it("matches serialized host error objects and rpc.invalid_output codes", () => {
    expect(
      isInvalidRpcResponse({
        name: "InvalidRequestError",
        message: 'Expected JSON value at ["output"]',
      }),
    ).toBe(true)
    expect(isInvalidRpcResponse({ type: "rpc.invalid_output" })).toBe(true)
    expect(isInvalidRpcResponse({ code: "rpc.invalid_output" })).toBe(true)
  })

  it("treats generic failures as unavailable, not invalid responses", () => {
    expect(isInvalidRpcResponse(new Error("validation failed"))).toBe(false)
    expect(isInvalidRpcResponse(new Error("boom"))).toBe(false)
    expect(isInvalidRpcResponse("Expected JSON value")).toBe(false)
    expect(isInvalidRpcResponse(undefined)).toBe(false)
    expect(isInvalidRpcResponse(null)).toBe(false)
  })
})

describe("isStaleMutate", () => {
  it("routes ok:false outcomes to the stale path (no success toast)", () => {
    expect(isStaleMutate({ ok: false, kind: "not-found", accountCount: 1 })).toBe(true)
  })

  it("routes success outcomes to the success toast", () => {
    expect(isStaleMutate({ op: "select", remaining: 1 })).toBe(false)
  })
})

const testAccount = {
  id: "acc-one",
  email: "one@example.com",
  enabled: true,
  active: true,
  verificationRequired: false,
}

function quotaEntry(overrides: Record<string, unknown> = {}) {
  return {
    id: "acc-one",
    email: "one@example.com",
    enabled: true,
    status: "ok",
    groups: {
      claude: { remainingFraction: 0.7, resetTime: null },
      "gemini-pro": { remainingFraction: null, resetTime: null },
      "gemini-flash": { remainingFraction: 1, resetTime: null },
    },
    checkedAt: 1_700_000_000_000,
    freshness: "stale",
    verificationRequired: false,
    coolingDown: false,
    selectedByFamily: { claude: false, gemini: false },
    ...overrides,
  }
}

function createHarness(options: {
  listResponses: Array<{ accounts: Array<typeof testAccount> }>
  quotaImpl: (input: { refresh?: boolean }) => Promise<{ accounts: Array<ReturnType<typeof quotaEntry>> }>
  selectQueue: Array<unknown>
  deferListSelection?: boolean
  deferMissingAcknowledgement?: boolean
  mutateImpl?: (input: { id: string; op: string }) => Promise<unknown>
}) {
  type SetupContext = Parameters<typeof plugin.setup>[0]
  const listMock = vi.fn(async () => options.listResponses.shift() ?? { accounts: [] })
  const quotaMock = vi.fn(options.quotaImpl)
  const mutateMock = vi.fn(
    options.mutateImpl ??
      (async (input: { id: string; op: string }) => ({
        op: input.op,
        index: 0,
        nextActiveIndex: 0,
        activeIndexByFamily: { claude: 0, gemini: 0 },
        remaining: 1,
        selected: null,
      })),
  )
  const toastMock = vi.fn()
  const alerts: Array<{ title: string; message: string }> = []
  const selectCalls: Array<{ title: string; placeholder?: string }> = []
  const selectQueue = [...options.selectQueue]
  const showCalls: Array<{ render: () => unknown; onClose?: () => void }> = []
  const setCalls: Array<{ size?: string; centered?: boolean }> = []
  const listViews: Array<AccountListDialogProps> = []
  const missingViews: Array<MissingAccountDialogProps> = []
  let activeClose: (() => void) | undefined
  const dismiss = () => {
    const close = activeClose
    activeClose = undefined
    close?.()
  }
  const clearMock = vi.fn(dismiss)
  const setMock = vi.fn((opts: { size?: string; centered?: boolean }) => {
    setCalls.push(opts)
  })
  let registeredRun: ((...args: Array<never>) => unknown) | undefined

  const context = {
    location: "test-location",
    data: { location: { default: () => "test-location" } },
    client: {
      rpc: vi.fn(() => ({ list: listMock, quota: quotaMock, mutate: mutateMock })),
    },
    theme: {
      hue: { accent: { 200: "accent" } },
      background: { raised: { high: "selected" }, formfield: { focused: "inputBackground" } },
      text: {
        base: "base",
        muted: "muted",
        formfield: { focused: "inputText" },
        feedback: {
          success: { base: "success" },
          warning: { base: "warning" },
          error: { base: "error" },
        },
      },
    },
    ui: {
      toast: { show: toastMock },
      dialog: {
        select: vi.fn(async (dialogOptions: { title: string; placeholder?: string }) => {
          selectCalls.push({ title: dialogOptions.title, placeholder: dialogOptions.placeholder })
          return selectQueue.shift()
        }),
        alert: vi.fn(async (dialogOptions: { title: string; message: string }) => {
          dismiss()
          alerts.push(dialogOptions)
        }),
        confirm: vi.fn(async () => false),
        clear: clearMock,
        set: setMock,
        show: vi.fn((render: () => unknown, onClose?: () => void) => {
          dismiss()
          activeClose = onClose
          const view = render() as { listProps?: AccountListDialogProps; missingProps?: MissingAccountDialogProps }
          if (view.missingProps) {
            const props = view.missingProps
            missingViews.push(props)
            alerts.push({ title: props.email, message: "That account is no longer saved." })
            if (!options.deferMissingAcknowledgement) queueMicrotask(props.acknowledge)
            return
          }
          if (view.listProps) {
            const props = view.listProps
            listViews.push(props)
            selectCalls.push({ title: "Antigravity accounts" })
            const picked = selectQueue.shift()
            if (!options.deferListSelection)
              queueMicrotask(() => props.choose(typeof picked === "string" ? picked : undefined))
            return
          }
          showCalls.push({ render, onClose })
        }),
      },
      slot: vi.fn((slotOptions: { render: () => null }) => {
        slotOptions.render()
        return () => {}
      }),
    },
    keymap: {
      shortcuts: () => [],
      layer: vi.fn((define: () => { commands: Array<{ run: (...args: Array<never>) => unknown }> }) => {
        registeredRun = define().commands[0]?.run
      }),
    },
  } as unknown as SetupContext

  const cleanup = plugin.setup(context)
  if (!registeredRun) throw new Error("antigravity.accounts command was not registered")
  return {
    listMock,
    quotaMock,
    mutateMock,
    toastMock,
    clearMock,
    alerts,
    selectCalls,
    showCalls,
    setCalls,
    listViews,
    missingViews,
    runAccounts: registeredRun,
    dismiss,
    view: () => showCalls[0]?.render() as QuotaDialogProps,
    cleanup: () => {
      if (typeof cleanup === "function") cleanup()
    },
  }
}

describe("show-quota opens one quota screen", () => {
  it("keeps the replacement quota closable when two opens overlap", async () => {
    const deferred: Array<(value: { accounts: Array<ReturnType<typeof quotaEntry>> }) => void> = []
    let quotaCalls = 0
    const harness = createHarness({
      listResponses: [{ accounts: [testAccount] }, { accounts: [testAccount] }],
      quotaImpl: async () => {
        quotaCalls += 1
        if (quotaCalls % 2 === 0)
          return new Promise((resolve) => {
            deferred.push(resolve)
          })
        return { accounts: [quotaEntry()] }
      },
      selectQueue: [testAccount.id, "show-quota", testAccount.id, "show-quota"],
    })
    const first = harness.runAccounts()
    await vi.waitFor(() => expect(deferred).toHaveLength(1))
    const second = harness.runAccounts()
    await vi.waitFor(() => expect(deferred).toHaveLength(2))
    deferred[0]?.({ accounts: [quotaEntry()] })
    await vi.waitFor(() => expect(harness.showCalls).toHaveLength(1))
    deferred[1]?.({ accounts: [quotaEntry()] })
    await vi.waitFor(() => expect(harness.showCalls).toHaveLength(2))
    await first
    await second
    const secondView = harness.showCalls[1]?.render() as QuotaDialogProps
    const listsBefore = harness.listMock.mock.calls.length
    const clearsBefore = harness.clearMock.mock.calls.length
    harness.cleanup()
    expect(harness.clearMock.mock.calls.length).toBeGreaterThan(clearsBefore)
    await secondView.controller.back()
    expect(harness.listMock.mock.calls.length).toBe(listsBefore)
  })

  it.each(["replacement", "unload"])("does not navigate after missing-account notice %s", async (reason) => {
    const harness = createHarness({
      listResponses: [{ accounts: [testAccount] }],
      quotaImpl: async (input) => ({ accounts: input.refresh ? [] : [quotaEntry()] }),
      selectQueue: [testAccount.id, "show-quota"],
      deferMissingAcknowledgement: true,
    })
    await harness.runAccounts()
    const pending = harness.view().controller.refresh()
    await vi.waitFor(() => expect(harness.missingViews).toHaveLength(1))
    if (reason === "replacement") harness.dismiss()
    else harness.cleanup()
    const clears = harness.clearMock.mock.calls.length
    await pending
    harness.missingViews[0]!.acknowledge()
    harness.cleanup()
    expect(harness.listMock).toHaveBeenCalledTimes(1)
    expect(harness.clearMock).toHaveBeenCalledTimes(clears)
  })

  it("waits for explicit acknowledgement and returns to the list only once", async () => {
    const harness = createHarness({
      listResponses: [{ accounts: [testAccount] }, { accounts: [] }],
      quotaImpl: async (input) => ({ accounts: input.refresh ? [] : [quotaEntry()] }),
      selectQueue: [testAccount.id, "show-quota"],
      deferMissingAcknowledgement: true,
    })
    await harness.runAccounts()
    const pending = harness.view().controller.refresh()
    await vi.waitFor(() => expect(harness.missingViews).toHaveLength(1))
    expect(harness.listMock).toHaveBeenCalledTimes(1)
    harness.missingViews[0]!.acknowledge()
    harness.missingViews[0]!.acknowledge()
    await pending
    expect(harness.listMock).toHaveBeenCalledTimes(2)
  })
  it("settles a replaced account list without navigating or clearing its replacement", async () => {
    const harness = createHarness({
      listResponses: [{ accounts: [testAccount] }],
      quotaImpl: async () => ({ accounts: [quotaEntry()] }),
      selectQueue: [],
      deferListSelection: true,
    })
    const pending = harness.runAccounts()
    await vi.waitFor(() => expect(harness.listViews).toHaveLength(1))
    harness.dismiss()
    await pending
    harness.listViews[0]?.choose(testAccount.id)
    harness.cleanup()
    expect(harness.clearMock).not.toHaveBeenCalled()
    expect(harness.selectCalls).toHaveLength(1)
  })

  it("projects enabled state for dots without repeating emails or login hints in rows", async () => {
    const disabled = { ...testAccount, id: "acc-two", email: "two@example.com", enabled: false }
    const harness = createHarness({
      listResponses: [{ accounts: [testAccount, disabled] }],
      quotaImpl: async () => ({ accounts: [quotaEntry()] }),
      selectQueue: [undefined],
    })
    await harness.runAccounts()
    expect(harness.listViews[0]?.accounts).toEqual([
      expect.objectContaining({ id: "acc-one", enabled: true }),
      expect.objectContaining({ id: "acc-two", enabled: false, description: expect.stringContaining("[disabled]") }),
    ])
    for (const account of harness.listViews[0]?.accounts ?? []) {
      expect(account.description).not.toContain(account.email)
      expect(account.description).not.toContain("opencode auth login")
    }
  })

  it("shows the dialog once and returns to the main list on explicit Back/Esc", async () => {
    const harness = createHarness({
      listResponses: [{ accounts: [testAccount] }, { accounts: [testAccount] }],
      quotaImpl: async () => ({ accounts: [quotaEntry()] }),
      selectQueue: [testAccount.id, "show-quota", undefined],
    })

    await harness.runAccounts()

    // openList fetches cached quota for its one-liners, then openQuota fetches once more.
    expect(harness.quotaMock).toHaveBeenCalledTimes(2)
    expect(harness.quotaMock).toHaveBeenCalledWith({ refresh: false }, { location: "test-location" })
    expect(harness.showCalls).toHaveLength(1)
    expect(typeof harness.showCalls[0]?.render).toBe("function")

    // The modal's Esc command delegates to controller.back, not onClose.
    await harness.view().controller.back()
    await vi.waitFor(() => {
      expect(harness.listMock).toHaveBeenCalledTimes(2)
      expect(harness.selectCalls.filter((call) => call.title === "Antigravity accounts")).toHaveLength(2)
    })
    // The refreshed list opens for selection; dismissing it ends the flow.
    expect(harness.selectCalls.filter((call) => call.title === "Antigravity accounts")).toHaveLength(2)
  })

  it("does not reopen the list or clear another dialog after replacement", async () => {
    const harness = createHarness({
      listResponses: [{ accounts: [testAccount] }],
      quotaImpl: async () => ({ accounts: [quotaEntry()] }),
      selectQueue: [testAccount.id, "show-quota"],
    })
    await harness.runAccounts()
    const controller = harness.view().controller
    harness.dismiss()
    await Promise.resolve()
    await controller.back()
    harness.cleanup()
    expect(harness.listMock).toHaveBeenCalledTimes(1)
    expect(harness.selectCalls).toHaveLength(2)
  })

  it("uses the latest quota response's enabled state, not the earlier list", async () => {
    const harness = createHarness({
      listResponses: [{ accounts: [testAccount] }],
      quotaImpl: async () => ({ accounts: [quotaEntry({ enabled: false })] }),
      selectQueue: [testAccount.id, "show-quota"],
    })
    await harness.runAccounts()
    expect(harness.view().enabled).toBe(false)
    await harness.view().controller.refresh()
    expect(harness.quotaMock).toHaveBeenCalledTimes(2)
  })

  it("does not navigate or notify when closed during an in-flight refresh", async () => {
    let reject!: (error: Error) => void
    const harness = createHarness({
      listResponses: [{ accounts: [testAccount] }],
      quotaImpl: (input) =>
        input.refresh
          ? new Promise((_resolve, fail) => {
              reject = fail
            })
          : Promise.resolve({ accounts: [quotaEntry()] }),
      selectQueue: [testAccount.id, "show-quota"],
    })
    await harness.runAccounts()
    const pending = harness.view().controller.refresh()
    harness.cleanup()
    reject(new Error("offline"))
    await pending
    expect(harness.listMock).toHaveBeenCalledTimes(1)
    expect(harness.toastMock).not.toHaveBeenCalled()
  })

  it("shows a missing-account alert before returning to the list once", async () => {
    const harness = createHarness({
      listResponses: [{ accounts: [testAccount] }, { accounts: [] }],
      quotaImpl: async (input) => ({ accounts: input.refresh ? [] : [quotaEntry()] }),
      selectQueue: [testAccount.id, "show-quota"],
    })
    await harness.runAccounts()
    await harness.view().controller.refresh()
    expect(harness.listMock).toHaveBeenCalledTimes(2)
    expect(harness.alerts.filter((alert) => alert.message === "That account is no longer saved.")).toHaveLength(1)
    expect(harness.showCalls).toHaveLength(1)
  })
})

describe("show-quota on a deleted account", () => {
  it("does not return to the list when its initial missing-account notice is replaced", async () => {
    const harness = createHarness({
      listResponses: [{ accounts: [testAccount] }],
      quotaImpl: async () => ({ accounts: [] }),
      selectQueue: [testAccount.id, "show-quota"],
      deferMissingAcknowledgement: true,
    })
    const pending = harness.runAccounts()
    await vi.waitFor(() => expect(harness.missingViews).toHaveLength(1))
    harness.dismiss()
    await pending
    harness.missingViews[0]!.acknowledge()
    harness.cleanup()
    expect(harness.listMock).toHaveBeenCalledTimes(1)
    // Clearing the account picker was the only owned clear before replacement.
    expect(harness.clearMock).toHaveBeenCalledTimes(1)
  })

  it("alerts once then returns to the refreshed list instead of stale actions", async () => {
    const harness = createHarness({
      listResponses: [{ accounts: [testAccount] }, { accounts: [] }],
      quotaImpl: async () => ({ accounts: [] }),
      selectQueue: [testAccount.id, "show-quota"],
    })

    await harness.runAccounts()

    expect(harness.alerts.some((entry) => entry.message === "That account is no longer saved.")).toBe(true)
    expect(harness.listMock).toHaveBeenCalledTimes(2)
    // openList fetches cached quota for its one-liners, then openQuota fetches once more.
    expect(harness.quotaMock).toHaveBeenCalledTimes(2)
    expect(harness.showCalls).toHaveLength(0)
    const actionDialogs = harness.selectCalls.filter((call) => call.title === testAccount.email)
    expect(actionDialogs).toHaveLength(1)
  })
})

describe("standardized dialog presentation size", () => {
  it("uses medium for quota without changing account-list and notice sizes", async () => {
    const harness = createHarness({
      listResponses: [{ accounts: [testAccount] }, { accounts: [] }],
      quotaImpl: async (input) => ({ accounts: input.refresh ? [] : [quotaEntry()] }),
      selectQueue: [testAccount.id, "show-quota"],
      deferMissingAcknowledgement: true,
    })

    await harness.runAccounts()
    expect(harness.setCalls).toEqual([{ size: "large" }, { size: "medium" }])
    expect(harness.view().colors.accent).toBe("accent")

    // 2. Refresh detects missing account and triggers MissingAccountDialogView
    const pendingRefresh = harness.view().controller.refresh()
    await vi.waitFor(() => expect(harness.missingViews).toHaveLength(1))

    expect(harness.setCalls).toEqual([{ size: "large" }, { size: "medium" }, { size: "large" }])

    harness.missingViews[0]!.acknowledge()
    await pendingRefresh
    harness.cleanup()
  })
})

describe("toggle account enabled in list", () => {
  it("invokes mutate on toggle and displays success toast", async () => {
    const harness = createHarness({
      listResponses: [{ accounts: [testAccount] }],
      quotaImpl: async () => ({ accounts: [quotaEntry()] }),
      selectQueue: [],
      deferListSelection: true,
    })
    const pending = harness.runAccounts()
    await vi.waitFor(() => expect(harness.listViews).toHaveLength(1))
    const listView = harness.listViews[0]!
    expect(typeof listView.toggle).toBe("function")

    await listView.toggle!(testAccount.id)
    expect(harness.mutateMock).toHaveBeenCalledWith(
      { id: testAccount.id, op: "disable" },
      { location: "test-location" },
    )
    expect(harness.toastMock).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Antigravity accounts",
        message: `${testAccount.email} disabled.`,
        variant: "success",
      }),
    )

    // Second toggle toggles back to enable
    await listView.toggle!(testAccount.id)
    expect(harness.mutateMock).toHaveBeenCalledWith({ id: testAccount.id, op: "enable" }, { location: "test-location" })
    expect(harness.toastMock).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Antigravity accounts",
        message: `${testAccount.email} enabled.`,
        variant: "success",
      }),
    )

    harness.dismiss()
    await pending
    harness.cleanup()
  })

  it("handles stale mutate outcome by refreshing the account list", async () => {
    const harness = createHarness({
      listResponses: [{ accounts: [testAccount] }, { accounts: [] }],
      quotaImpl: async () => ({ accounts: [] }),
      selectQueue: [],
      deferListSelection: true,
      mutateImpl: async () => ({ ok: false, kind: "not-found", accountCount: 0 }),
    })
    const pending = harness.runAccounts()
    await vi.waitFor(() => expect(harness.listViews).toHaveLength(1))
    const listView = harness.listViews[0]!

    await listView.toggle!(testAccount.id)
    expect(harness.toastMock).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Antigravity accounts",
        message: "That account is no longer saved. The list will refresh.",
        variant: "warning",
      }),
    )
    expect(harness.listMock).toHaveBeenCalledTimes(2)

    harness.dismiss()
    await pending
    harness.cleanup()
  })
})
