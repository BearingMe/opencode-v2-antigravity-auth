import { describe, expect, it } from "vitest"
import { AntigravityAccounts } from "./rpc.js"

describe("AntigravityAccounts contract", () => {
  it("exposes the six production methods with no smoke remnants", () => {
    expect(AntigravityAccounts.id).toBe("antigravity-accounts")
    expect(Object.keys(AntigravityAccounts.methods).sort()).toEqual([
      "deleteAll",
      "list",
      "mutate",
      "ping",
      "quota",
      "verify",
    ])
  })

  it("rejects index-addressed verify and mutate inputs", () => {
    expect(() => AntigravityAccounts.methods.verify.input.parse({ index: 0 })).toThrow()
    expect(() => AntigravityAccounts.methods.mutate.input.parse({ index: 0, op: "select" })).toThrow()
    expect(() => AntigravityAccounts.methods.mutate.input.parse({ id: "acc-one", op: "explode" })).toThrow()
  })

  it("accepts id-addressed verify and family-scoped mutate inputs", () => {
    expect(AntigravityAccounts.methods.verify.input.parse({ id: "acc-one" })).toEqual({ id: "acc-one" })
    expect(AntigravityAccounts.methods.mutate.input.parse({ id: "acc-one", op: "select", family: "gemini" })).toEqual({
      id: "acc-one",
      op: "select",
      family: "gemini",
    })
  })

  it("rejects token-bearing list output under strict parsing", () => {
    const polluted = {
      activeIndex: 0,
      activeIndexByFamily: { claude: 0, gemini: 0 },
      accounts: [
        {
          id: "acc-one",
          index: 0,
          email: "one@example.com",
          enabled: true,
          active: true,
          verificationRequired: false,
          verificationStatus: "not_checked",
          refreshToken: "secret-refresh-token",
        },
      ],
    }
    expect(() => AntigravityAccounts.methods.list.output.parse(polluted)).toThrow()
  })

  it("rejects mutate output carrying refreshParts", () => {
    const polluted = {
      op: "select",
      index: 0,
      nextActiveIndex: 0,
      activeIndexByFamily: { claude: 0, gemini: 0 },
      remaining: 1,
      selected: {
        id: "acc-one",
        index: 0,
        email: "one@example.com",
        refreshParts: { refreshToken: "secret-refresh-token", projectId: "p" },
      },
    }
    expect(() => AntigravityAccounts.methods.mutate.output.parse(polluted)).toThrow()
  })

  it("parses safe verify, mutate, deleteAll, and ping outputs", () => {
    expect(
      AntigravityAccounts.methods.verify.output.parse({
        index: 0,
        checkedAt: 1,
        status: "blocked",
        message: "verification required",
        verifyUrl: "https://google.test/verify",
      }),
    ).toMatchObject({ status: "blocked" })
    expect(AntigravityAccounts.methods.verify.output.parse({ ok: false, kind: "not-found", accountCount: 1 })).toEqual({
      ok: false,
      kind: "not-found",
      accountCount: 1,
    })
    expect(
      AntigravityAccounts.methods.mutate.output.parse({
        op: "delete",
        index: 0,
        nextActiveIndex: 0,
        activeIndexByFamily: { claude: 0, gemini: 0 },
        remaining: 0,
        selected: null,
      }),
    ).toMatchObject({ remaining: 0 })
    expect(AntigravityAccounts.methods.deleteAll.output.parse({ remaining: 0 })).toEqual({ remaining: 0 })
    expect(AntigravityAccounts.methods.ping.output.parse("ANTIGRAVITY_RPC_ACCOUNTS_OK")).toBe(
      "ANTIGRAVITY_RPC_ACCOUNTS_OK",
    )
  })
})
