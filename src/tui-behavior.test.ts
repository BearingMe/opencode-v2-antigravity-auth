import { describe, expect, it, vi } from "vitest"
import plugin, { isInvalidRpcResponse, isStaleMutate } from "./tui.js"

describe("isInvalidRpcResponse", () => {
  it("matches the host transport-codec rejection shape", () => {
    const error = new Error('Expected JSON value at ["output"]')
    error.name = "InvalidRequestError"
    expect(isInvalidRpcResponse(error)).toBe(true)
  })

  it("matches serialized host error objects and rpc.invalid_output codes", () => {
    expect(isInvalidRpcResponse({
      name: "InvalidRequestError",
      message: 'Expected JSON value at ["output"]',
    })).toBe(true)
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

describe("refresh-quota on a deleted account", () => {
  it("alerts once then returns to the refreshed list instead of stale actions", async () => {
    const account = {
      id: "acc-one",
      email: "one@example.com",
      enabled: true,
      active: true,
      verificationRequired: false,
    }
    const listResponses = [
      { accounts: [account] },
      { accounts: [] },
    ]
    const listMock = vi.fn(async () => listResponses.shift() ?? { accounts: [] })
    const quotaMock = vi.fn(async () => ({ accounts: [] }))
    const alerts: Array<{ title: string; message: string }> = []
    const selectCalls: Array<{ title: string; value: unknown }> = []
    const selectQueue: Array<unknown> = [account.id, "refresh-quota", undefined]
    type SetupContext = Parameters<typeof plugin.setup>[0]
    let registeredRun: (() => Promise<void>) | undefined

    const context = {
      location: "test-location",
      data: { location: { default: () => "test-location" } },
      client: {
        rpc: vi.fn(() => ({ list: listMock, quota: quotaMock })),
      },
      ui: {
        toast: { show: vi.fn() },
        dialog: {
          select: vi.fn(async (options: { title: string }) => {
            selectCalls.push({ title: options.title, value: selectQueue.length })
            return selectQueue.shift()
          }),
          alert: vi.fn(async (options: { title: string; message: string }) => {
            alerts.push(options)
          }),
          confirm: vi.fn(async () => false),
        },
        slot: vi.fn((options: { render: () => null }) => {
          const render = options.render
          render()
          return () => {}
        }),
      },
      keymap: {
        layer: vi.fn((define: () => { commands: Array<{ run: () => Promise<void> }> }) => {
          const layer = define()
          registeredRun = layer.commands[0]?.run
        }),
      },
    } as unknown as SetupContext

    plugin.setup(context)
    if (!registeredRun) throw new Error("antigravity.accounts command was not registered")
    await registeredRun()

    expect(alerts.some((entry) => entry.message === "That account is no longer saved.")).toBe(true)
    expect(listMock).toHaveBeenCalledTimes(2)
    expect(quotaMock).toHaveBeenCalledTimes(2)
    const actionDialogs = selectCalls.filter((call) => call.title === account.email)
    expect(actionDialogs).toHaveLength(1)
  })
})
