import { afterEach, describe, expect, it, vi } from "vitest"
import {
  AccountRefreshQueue,
  type RefreshQueueAccount,
  type RefreshQueueCredential,
  type RefreshQueueManager,
} from "./queue.js"

interface TestAccount extends RefreshQueueAccount {
  id: string
}

interface TestCredential extends RefreshQueueCredential {
  access?: string
}

/** Creates a pool implementing only the queue's declared manager contract. */
function createManager(accounts: TestAccount[]) {
  const updated: TestAccount[] = []
  return {
    updated,
    manager: {
      getAccounts: () => accounts,
      toAuthDetails: (account: TestAccount): TestCredential => ({ type: "oauth", refresh: account.id }),
      updateFromAuth: (account: TestAccount) => updated.push(account),
      saveToDisk: vi.fn(async () => undefined),
    } satisfies RefreshQueueManager<TestAccount, TestCredential>,
  }
}

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe("AccountRefreshQueue", () => {
  it("selects only enabled accounts expiring inside the proactive window", () => {
    const now = 1_000_000
    const { manager } = createManager([
      { id: "eligible", index: 0, expires: now + 10_000 },
      { id: "disabled", index: 1, expires: now + 10_000, enabled: false },
      { id: "expired", index: 2, expires: now - 1 },
      { id: "later", index: 3, expires: now + 60_000 },
      { id: "unknown", index: 4 },
    ])
    const queue = new AccountRefreshQueue<TestAccount, TestCredential>(
      {
        clock: { now: () => now },
        refresh: async (credential) => credential,
        logger: { debug: () => undefined, warn: () => undefined, error: () => undefined },
      },
      { bufferSeconds: 30, checkIntervalSeconds: 300 },
    )
    queue.setAccountManager(manager)

    expect(queue.getAccountsNeedingRefresh().map((account) => account.id)).toEqual(["eligible"])
  })

  it("refreshes accounts serially and persists each successful update", async () => {
    vi.useFakeTimers()
    const now = 1_000_000
    const { manager, updated } = createManager([
      { id: "first", index: 0, expires: now + 5_000 },
      { id: "second", index: 1, expires: now + 5_000 },
    ])
    let activeRefreshes = 0
    let maximumConcurrentRefreshes = 0
    const refresh = vi.fn(async (credential: TestCredential) => {
      activeRefreshes += 1
      maximumConcurrentRefreshes = Math.max(maximumConcurrentRefreshes, activeRefreshes)
      await Promise.resolve()
      activeRefreshes -= 1
      return { ...credential, access: `access-${credential.refresh}` }
    })
    const queue = new AccountRefreshQueue<TestAccount, TestCredential>(
      {
        clock: { now: () => now },
        refresh,
        logger: { debug: () => undefined, warn: () => undefined, error: () => undefined },
      },
      { bufferSeconds: 30, checkIntervalSeconds: 300 },
    )
    queue.setAccountManager(manager)
    queue.start()

    await vi.advanceTimersByTimeAsync(5_000)

    expect(refresh).toHaveBeenCalledTimes(2)
    expect(maximumConcurrentRefreshes).toBe(1)
    expect(updated.map((account) => account.id)).toEqual(["first", "second"])
    expect(manager.saveToDisk).toHaveBeenCalledTimes(2)
    expect(queue.getStats()).toMatchObject({ refreshCount: 2, errorCount: 0, isRunning: true })

    queue.stop()
  })

  it("does not start its delayed initial check after being stopped", async () => {
    vi.useFakeTimers()
    const now = 1_000_000
    const { manager } = createManager([{ id: "first", index: 0, expires: now + 5_000 }])
    const refresh = vi.fn(async (credential: TestCredential) => credential)
    const queue = new AccountRefreshQueue<TestAccount, TestCredential>(
      {
        clock: { now: () => now },
        refresh,
        logger: { debug: () => undefined, warn: () => undefined, error: () => undefined },
      },
      { bufferSeconds: 30, checkIntervalSeconds: 300 },
    )
    queue.setAccountManager(manager)
    queue.start()
    queue.stop()

    await vi.advanceTimersByTimeAsync(5_000)

    expect(refresh).not.toHaveBeenCalled()
    expect(queue.isRunning()).toBe(false)
  })
})
