import { describe, it, expect, beforeEach } from "vitest"
import { AccountManager } from "./accounts"
import type { OAuthAuthDetails } from "./types"

const MODEL_PRO = "gemini-1.5-pro"
const MODEL_FLASH = "gemini-1.5-flash"

/**
 * Marks Gemini Antigravity as rate-limited for the given model on an account.
 */
function markAntigravityRateLimited(
  manager: AccountManager,
  account: Parameters<AccountManager["markRateLimited"]>[0],
  model?: string,
) {
  manager.markRateLimited(account, 60000, "gemini", "antigravity", model)
}

describe("Model-specific Gemini quota", () => {
  let manager: AccountManager
  const auth: OAuthAuthDetails = {
    type: "oauth",
    refresh: "test-refresh",
    access: "test-access",
    expires: Date.now() + 3600000,
  }

  beforeEach(() => {
    manager = new AccountManager(auth)
  })

  it("blocks only the specific Gemini model when markRateLimited is called with a model", () => {
    const account = manager.getCurrentAccountForFamily("gemini")!

    // Mark gemini-1.5-pro as rate limited on antigravity
    markAntigravityRateLimited(manager, account, MODEL_PRO)

    // gemini-1.5-pro should be rate limited for antigravity
    expect(manager.isRateLimitedForHeaderStyle(account, "gemini", "antigravity", MODEL_PRO)).toBe(true)

    // gemini-1.5-flash should NOT be rate limited for antigravity
    expect(manager.isRateLimitedForHeaderStyle(account, "gemini", "antigravity", MODEL_FLASH)).toBe(false)

    // General gemini (no model) should NOT be rate limited
    expect(manager.isRateLimitedForHeaderStyle(account, "gemini", "antigravity")).toBe(false)
  })

  it("falls back to gemini-cli only for the specific model", () => {
    const account = manager.getCurrentAccountForFamily("gemini")!

    // Mark gemini-1.5-pro as rate limited on antigravity
    markAntigravityRateLimited(manager, account, MODEL_PRO)

    // Available header style for Pro should be gemini-cli
    expect(manager.getAvailableHeaderStyle(account, "gemini", MODEL_PRO)).toBe("gemini-cli")

    // Available header style for Flash should still be antigravity
    expect(manager.getAvailableHeaderStyle(account, "gemini", MODEL_FLASH)).toBe("antigravity")
  })

  it("returns null when all header styles are exhausted for the specific model on a single account", () => {
    const account = manager.getCurrentAccountForFamily("gemini")!

    markAntigravityRateLimited(manager, account, MODEL_PRO)
    manager.markRateLimited(account, 60000, "gemini", "gemini-cli", MODEL_PRO)

    // No other account available, so returns null for the rate-limited model
    expect(manager.getCurrentOrNextForFamily("gemini", MODEL_PRO)).toBeNull()

    // Flash should still return the same account since it's not rate-limited
    const flashAccount = manager.getCurrentOrNextForFamily("gemini", MODEL_FLASH)
    expect(flashAccount).toBe(account)
  })

  it("base family rate limit blocks all models in that family", () => {
    const account = manager.getCurrentAccountForFamily("gemini")!

    // Mark base gemini-antigravity as rate limited
    markAntigravityRateLimited(manager, account)

    // All Gemini models should now be blocked for antigravity on this account
    expect(manager.isRateLimitedForHeaderStyle(account, "gemini", "antigravity", MODEL_PRO)).toBe(true)
    expect(manager.isRateLimitedForHeaderStyle(account, "gemini", "antigravity", MODEL_FLASH)).toBe(true)
  })
})
