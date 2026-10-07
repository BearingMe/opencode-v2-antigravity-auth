import { describe, it, expect, beforeEach } from "vitest"
import { AccountManager } from "../adapters/opencode/account-pool.js"
import type { AccountOAuthCredential } from "../modules/accounts/index.js"

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
  manager.markRateLimited(account, 60000, "gemini", model)
}

describe("Model-specific Gemini quota", () => {
  let manager: AccountManager
  const auth: AccountOAuthCredential = {
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

    // Mark gemini-1.5-pro as rate limited in the active Gemini quota.
    markAntigravityRateLimited(manager, account, MODEL_PRO)

    // gemini-1.5-pro should be rate limited.
    expect(manager.isRateLimitedForFamily(account, "gemini", MODEL_PRO)).toBe(true)

    // gemini-1.5-flash should remain available.
    expect(manager.isRateLimitedForFamily(account, "gemini", MODEL_FLASH)).toBe(false)

    // General gemini (no model) should NOT be rate limited
    expect(manager.isRateLimitedForFamily(account, "gemini")).toBe(false)
  })

  it("ignores obsolete Gemini CLI cooldowns for the specific model", () => {
    const account = manager.getCurrentAccountForFamily("gemini")!

    // Mark gemini-1.5-pro as rate limited on antigravity
    markAntigravityRateLimited(manager, account, MODEL_PRO)

    account.rateLimitResetTimes[`gemini-cli:${MODEL_PRO}`] = Date.now() + 60_000
    expect(manager.isRateLimitedForFamily(account, "gemini", MODEL_PRO)).toBe(true)
    expect(manager.isRateLimitedForFamily(account, "gemini", MODEL_FLASH)).toBe(false)
  })

  it("returns null when the specific model is rate-limited on a single account", () => {
    const account = manager.getCurrentAccountForFamily("gemini")!

    markAntigravityRateLimited(manager, account, MODEL_PRO)
    account.rateLimitResetTimes[`gemini-cli:${MODEL_PRO}`] = Date.now() + 60_000

    // No other account is available, so the rate-limited model returns null.
    expect(manager.getCurrentOrNextForFamily("gemini", MODEL_PRO)).toBeNull()

    // Flash should still return the same account since it's not rate-limited
    const flashAccount = manager.getCurrentOrNextForFamily("gemini", MODEL_FLASH)
    expect(flashAccount).toBe(account)
  })

  it("base family rate limit blocks all models in that family", () => {
    const account = manager.getCurrentAccountForFamily("gemini")!

    // Mark the base Gemini quota as rate limited.
    markAntigravityRateLimited(manager, account)

    // All Gemini models should now be blocked on this account.
    expect(manager.isRateLimitedForFamily(account, "gemini", MODEL_PRO)).toBe(true)
    expect(manager.isRateLimitedForFamily(account, "gemini", MODEL_FLASH)).toBe(true)
  })
})
