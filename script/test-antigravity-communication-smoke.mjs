import assert from "node:assert/strict"
import rootPlugin, {
  authorizeAntigravity as publicAuthorizeAntigravity,
  exchangeAntigravity as publicExchangeAntigravity,
} from "opencode-v2-antigravity-auth"
import tuiPlugin from "opencode-v2-antigravity-auth/tui"
import { AntigravityAccounts } from "opencode-v2-antigravity-auth/rpc"
import { authorizeAntigravity, exchangeAntigravity } from "../dist/src/antigravity/oauth.js"
import { extractVerificationErrorDetails } from "../dist/src/adapters/antigravity/verification-parser.js"
import {
  createVerificationProbeRequest,
  sendVerificationProbe,
} from "../dist/src/adapters/antigravity/verification-client.js"
import { fetchAvailableModels, fetchQuotaSummary } from "../dist/src/adapters/antigravity/quota-client.js"
import { loadManagedProject } from "../dist/src/adapters/antigravity/project-client.js"
import { onboardManagedProject } from "../dist/src/plugin/project.js"
import { refreshOAuthToken } from "../dist/src/adapters/antigravity/token-client.js"
import { prepareAntigravityRequest } from "../dist/src/plugin/request.js"
import { formatRefreshParts } from "../dist/src/modules/accounts/index.js"
import { DEFAULT_CONFIG } from "../dist/src/adapters/opencode/config/schema.js"
import { executeAntigravityRequest } from "../dist/src/app/composition.js"

/** Exercises built Antigravity clients using synthetic OAuth data and mocked HTTP. */
async function main() {
  assert.equal(rootPlugin.id, "opencode-v2-antigravity-auth")
  assert.equal(tuiPlugin.id, "antigravity-accounts-tui")
  assert.equal(AntigravityAccounts.id, "antigravity-accounts")
  assert.equal(typeof publicAuthorizeAntigravity, "function")
  assert.equal(typeof publicExchangeAntigravity, "function")
  const sdkUrl = new URL("./google-sdk.js", new URL("../dist/src/adapters/opencode/plugin.js", import.meta.url))
  assert.equal(typeof (await import(sdkUrl.href)).createGoogle, "function")

  const originalFetch = globalThis.fetch
  const requests = []
  globalThis.fetch = async (input, init) => {
    const url = String(input)
    requests.push({ url, init })

    if (url === "https://oauth2.googleapis.com/token") {
      assert.equal(init?.method, "POST")
      assert.match(new Headers(init?.headers).get("content-type") ?? "", /application\/x-www-form-urlencoded/)
      const form = new URLSearchParams(String(init?.body))
      if (form.get("grant_type") === "authorization_code") {
        assert.equal(form.get("code"), "synthetic-code")
        assert.ok(form.get("code_verifier"))
        assert.ok(form.get("client_id"))
        assert.equal(form.get("redirect_uri"), "http://localhost:51121/oauth-callback")
        return Response.json({
          access_token: "synthetic-access",
          expires_in: 3600,
          refresh_token: "synthetic-refresh",
        })
      }
      assert.equal(form.get("grant_type"), "refresh_token")
      assert.equal(form.get("refresh_token"), "synthetic-refresh")
      return Response.json({ access_token: "refreshed-access", expires_in: 900 })
    }
    if (url === "https://www.googleapis.com/oauth2/v1/userinfo?alt=json") {
      assert.equal(new Headers(init?.headers).get("authorization"), "Bearer synthetic-access")
      return Response.json({ email: "synthetic@example.com" })
    }
    if (url.includes("v1internal:loadCodeAssist")) {
      assert.ok(
        url === "https://cloudcode-pa.googleapis.com/v1internal:loadCodeAssist" ||
          url === "https://daily-cloudcode-pa.sandbox.googleapis.com/v1internal:loadCodeAssist",
      )
      assert.equal(init?.method, "POST")
      assert.equal(new Headers(init?.headers).get("authorization"), "Bearer synthetic-access")
      const metadata = JSON.parse(String(init?.body)).metadata
      assert.equal(metadata.ideType, "ANTIGRAVITY")
      assert.equal(metadata.pluginType, "GEMINI")
      assert.ok(new Headers(init?.headers).get("client-metadata"))
      return Response.json({ cloudaicompanionProject: "synthetic-project" })
    }
    if (url.includes("v1internal:onboardUser")) {
      assert.equal(url, "https://daily-cloudcode-pa.sandbox.googleapis.com/v1internal:onboardUser")
      assert.equal(init?.method, "POST")
      assert.equal(new Headers(init?.headers).get("authorization"), "Bearer synthetic-access")
      assert.equal(JSON.parse(String(init?.body)).tierId, "FREE")
      return Response.json({ done: true, response: { cloudaicompanionProject: { id: "onboarded-project" } } })
    }
    if (url.includes("v1internal:fetchAvailableModels")) {
      assert.equal(url, "https://cloudcode-pa.googleapis.com/v1internal:fetchAvailableModels")
      assert.equal(init?.method, "POST")
      assert.equal(new Headers(init?.headers).get("authorization"), "Bearer synthetic-access")
      assert.deepEqual(JSON.parse(String(init?.body)), { project: "synthetic-project" })
      return Response.json({ models: { "gemini-3.1-pro": { quotaInfo: { remainingFraction: 0 } } } })
    }
    if (url.includes("v1internal:retrieveUserQuotaSummary")) {
      assert.equal(url, "https://cloudcode-pa.googleapis.com/v1internal:retrieveUserQuotaSummary")
      assert.equal(init?.method, "POST")
      assert.equal(new Headers(init?.headers).get("authorization"), "Bearer synthetic-access")
      assert.deepEqual(JSON.parse(String(init?.body)), { project: "synthetic-project" })
      return Response.json({
        groups: [{ displayName: "Gemini", buckets: [{ window: "weekly", remainingFraction: 0 }] }],
      })
    }
    if (url.includes("v1internal:streamGenerateContent")) {
      assert.equal(init?.method, "POST")
      assert.equal(new Headers(init?.headers).get("authorization"), "Bearer synthetic-access")
      const envelope = JSON.parse(String(init?.body))
      assert.equal(envelope.project, "synthetic-project")
      assert.equal(envelope.requestType, "agent")
      assert.equal(envelope.request.contents[0].parts[0].text, "Reply OK")
      return new Response(
        `data: ${JSON.stringify({ response: { candidates: [{ content: { parts: [{ text: "Smoke OK" }] } }] } })}\n\ndata: [DONE]\n\n`,
        { status: 200, headers: { "content-type": "text/event-stream" } },
      )
    }
    if (url === "https://daily-cloudcode-pa.sandbox.googleapis.com/v1internal:generateContent") {
      assert.equal(init?.method, "POST")
      assert.ok(init?.signal instanceof AbortSignal)
      assert.equal(new Headers(init?.headers).get("authorization"), "Bearer synthetic-access")
      const body = JSON.parse(String(init?.body))
      assert.equal(body.project, "synthetic-project")
      assert.equal(body.requestType, "agent")
      assert.equal(body.request.contents[0].parts[0].text, "Reply OK")
      return new Response("verification probe passed", { status: 200 })
    }
    throw new Error(`Unexpected mocked HTTP request: ${url}`)
  }

  try {
    const authorization = await authorizeAntigravity()
    const state = new URL(authorization.url).searchParams.get("state")
    assert.ok(state)

    const exchange = await exchangeAntigravity("synthetic-code", state)
    assert.equal(exchange.type, "success")
    if (exchange.type !== "success") throw new Error("Synthetic OAuth exchange failed")
    assert.equal(exchange.refresh, "synthetic-refresh|synthetic-project")
    assert.equal(exchange.email, "synthetic@example.com")

    const refreshed = await refreshOAuthToken("synthetic-refresh")
    assert.equal(refreshed.accessToken, "refreshed-access")
    const project = await loadManagedProject("synthetic-access")
    assert.equal(project?.payload.cloudaicompanionProject, "synthetic-project")
    assert.equal(project?.managedProjectId, "synthetic-project")
    assert.equal(await onboardManagedProject("synthetic-access", "FREE", undefined, 1, 0), "onboarded-project")

    const available = await fetchAvailableModels("synthetic-access", "synthetic-project")
    const grouped = await fetchQuotaSummary("synthetic-access", "synthetic-project")
    assert.equal(available.models?.["gemini-3.1-pro"]?.remainingFraction, 0)
    assert.equal(grouped[0]?.buckets.weekly?.remainingFraction, 0)

    const verificationRequest = createVerificationProbeRequest(new AbortController().signal)
    const preparedVerification = prepareAntigravityRequest(
      verificationRequest.request,
      verificationRequest.init,
      "synthetic-access",
      "synthetic-project",
    )
    const probe = await sendVerificationProbe(preparedVerification.request, preparedVerification.init)
    assert.equal(probe.body, "verification probe passed")
    assert.equal(
      extractVerificationErrorDetails('{"error":{"message":"validation_required"}}').validationRequired,
      true,
    )

    const requestAccount = { index: 0, consecutiveFailures: 0 }
    const accountManager = {
      getAccountCount: () => 1,
      selectForRequest: () => requestAccount,
      requestSaveToDisk: () => undefined,
      toAuthDetails: () => ({
        type: "oauth",
        access: "synthetic-access",
        expires: Date.now() + 3600_000,
        refresh: formatRefreshParts({
          refreshToken: "synthetic-refresh",
          projectId: "synthetic-project",
          managedProjectId: "synthetic-project",
        }),
      }),
      isRateLimitedForFamily: () => false,
      markAccountUsed: () => undefined,
    }
    const response = await executeAntigravityRequest(
      "https://generativelanguage.googleapis.com/v1beta/models/antigravity-gemini-3.1-pro:streamGenerateContent?alt=sse",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: "Reply OK" }] }] }),
      },
      {
        client: { auth: { set: async () => undefined }, tui: { showToast: async () => undefined } },
        providerId: "antigravity",
        config: { ...DEFAULT_CONFIG },
        accountManager,
      },
    )
    assert.equal(response.status, 200)
    assert.match(await response.text(), /Smoke OK/)

    assert.equal(requests.length, 10)
    console.log("Antigravity built-package request smoke passed (synthetic credentials; mocked HTTP).")
  } finally {
    globalThis.fetch = originalFetch
  }
}

await main()
