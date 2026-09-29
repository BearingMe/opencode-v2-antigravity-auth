import { describe, expect, it } from "vitest"
import { isInvalidRpcResponse, isStaleMutate } from "./tui.js"

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
