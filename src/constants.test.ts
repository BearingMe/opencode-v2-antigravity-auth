import { describe, it, expect } from "vitest"
import { getRandomizedHeaders, type HeaderSet } from "./constants.ts"

describe("getRandomizedHeaders", () => {
  it("returns all three Antigravity headers", () => {
    const headers = getRandomizedHeaders()
    expect(headers["User-Agent"]).toBeDefined()
    expect(headers["X-Goog-Api-Client"]).toBeDefined()
    expect(headers["Client-Metadata"]).toBeDefined()
  })

  it("returns User-Agent in Antigravity format", () => {
    const headers = getRandomizedHeaders()
    expect(headers["User-Agent"]).toMatch(/^antigravity\//)
  })

  it("aligns Client-Metadata platform with User-Agent platform", () => {
    for (let i = 0; i < 50; i++) {
      const headers = getRandomizedHeaders()
      const ua = headers["User-Agent"]!
      const metadata = JSON.parse(headers["Client-Metadata"]!)
      if (ua.includes("windows/")) {
        expect(metadata.platform).toBe("WINDOWS")
      } else {
        expect(metadata.platform).toBe("MACOS")
      }
    }
  })

  it("never produces a linux User-Agent", () => {
    for (let i = 0; i < 50; i++) {
      expect(getRandomizedHeaders()["User-Agent"]).not.toMatch(/linux\//)
    }
  })
})

describe("HeaderSet type", () => {
  it("allows omitting X-Goog-Api-Client and Client-Metadata", () => {
    const headers: HeaderSet = {
      "User-Agent": "test",
    }
    expect(headers["User-Agent"]).toBe("test")
    expect(headers["X-Goog-Api-Client"]).toBeUndefined()
    expect(headers["Client-Metadata"]).toBeUndefined()
  })

  it("allows including all three headers", () => {
    const headers: HeaderSet = {
      "User-Agent": "test",
      "X-Goog-Api-Client": "test-client",
      "Client-Metadata": "test-metadata",
    }
    expect(headers["User-Agent"]).toBe("test")
    expect(headers["X-Goog-Api-Client"]).toBe("test-client")
    expect(headers["Client-Metadata"]).toBe("test-metadata")
  })
})
