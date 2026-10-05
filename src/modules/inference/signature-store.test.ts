import { afterEach, describe, expect, it } from "vitest"
import { createSignatureStore, defaultSignatureStore } from "./signature-store.js"

describe("signed thinking store", () => {
  afterEach(() => {
    defaultSignatureStore.delete("test-scope")
  })

  it("keeps independently created stores isolated and supports replacement/removal", () => {
    const first = createSignatureStore()
    const second = createSignatureStore()
    first.set("scope", { text: "first", signature: "sig-1" })
    first.set("scope", { text: "updated", signature: "sig-2" })

    expect(first.has("scope")).toBe(true)
    expect(first.get("scope")).toEqual({ text: "updated", signature: "sig-2" })
    expect(second.has("scope")).toBe(false)

    first.delete("scope")
    expect(first.has("scope")).toBe(false)
  })

  it("retains the latest signed thought in the shared store until its scope is cleared", () => {
    defaultSignatureStore.set("test-scope", { text: "thinking", signature: "signature" })

    expect(defaultSignatureStore.get("test-scope")).toEqual({ text: "thinking", signature: "signature" })
    expect(defaultSignatureStore.has("test-scope")).toBe(true)
  })
})
