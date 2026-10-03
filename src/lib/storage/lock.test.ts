import { beforeEach, describe, expect, it, vi } from "vitest"
import { withFileLock } from "./lock"

const { lockMock } = vi.hoisted(() => ({
  lockMock: vi.fn(),
}))

vi.mock("proper-lockfile", () => ({
  default: { lock: lockMock },
}))

describe("withFileLock", () => {
  beforeEach(() => {
    lockMock.mockReset()
  })

  it("runs the operation with configured lock options and releases afterward", async () => {
    const release = vi.fn().mockResolvedValue(undefined)
    const operation = vi.fn().mockResolvedValue("saved")
    lockMock.mockResolvedValue(release)

    await expect(
      withFileLock("accounts.json", operation, {
        lockOptions: { stale: 10_000, retries: { retries: 5 } },
      }),
    ).resolves.toBe("saved")

    expect(lockMock).toHaveBeenCalledWith("accounts.json", { stale: 10_000, retries: { retries: 5 } })
    expect(operation).toHaveBeenCalledOnce()
    expect(release).toHaveBeenCalledOnce()
  })

  it("releases after an operation fails and keeps the operation error", async () => {
    const release = vi.fn().mockResolvedValue(undefined)
    const failure = new Error("transaction failed")
    lockMock.mockResolvedValue(release)

    await expect(withFileLock("accounts.json", async () => Promise.reject(failure))).rejects.toBe(failure)
    expect(release).toHaveBeenCalledOnce()
  })

  it("does not run the operation when lock acquisition fails", async () => {
    const operation = vi.fn()
    lockMock.mockRejectedValue(new Error("lock unavailable"))

    await expect(withFileLock("accounts.json", operation)).rejects.toThrow("lock unavailable")
    expect(operation).not.toHaveBeenCalled()
  })

  it("reports release failure without replacing the operation result", async () => {
    const release = vi.fn().mockRejectedValue(new Error("unlock failed"))
    const onReleaseError = vi.fn()
    lockMock.mockResolvedValue(release)

    await expect(withFileLock("accounts.json", async () => "saved", { onReleaseError })).resolves.toBe("saved")
    expect(onReleaseError).toHaveBeenCalledWith(expect.objectContaining({ message: "unlock failed" }))

    const operationFailure = new Error("transaction failed")
    await expect(
      withFileLock("accounts.json", async () => Promise.reject(operationFailure), { onReleaseError }),
    ).rejects.toBe(operationFailure)
    expect(onReleaseError).toHaveBeenCalledTimes(2)
  })
})
