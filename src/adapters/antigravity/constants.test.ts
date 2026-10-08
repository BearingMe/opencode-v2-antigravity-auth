import { afterEach, describe, expect, it, vi } from "vitest"
import { getAntigravityVersion, getRandomizedHeaders } from "./constants.ts"

afterEach(() => {
  vi.restoreAllMocks()
})

describe("getRandomizedHeaders", () => {
  it.each([
    { random: 0.1 / 3, platform: "windows/amd64", metadataPlatform: "WINDOWS" },
    { random: 1.1 / 3, platform: "darwin/arm64", metadataPlatform: "MACOS" },
    { random: 2.1 / 3, platform: "darwin/amd64", metadataPlatform: "MACOS" },
  ])("keeps $platform aligned with $metadataPlatform metadata", ({ random, platform, metadataPlatform }) => {
    vi.spyOn(Math, "random").mockReturnValueOnce(random).mockReturnValueOnce(0)

    const headers = getRandomizedHeaders()
    const metadata = JSON.parse(headers["Client-Metadata"] ?? "{}")

    expect(headers["User-Agent"]).toBe(`antigravity/${getAntigravityVersion()} ${platform}`)
    expect(metadata.platform).toBe(metadataPlatform)
    expect(headers["X-Goog-Api-Client"]).toBeDefined()
  })
})
