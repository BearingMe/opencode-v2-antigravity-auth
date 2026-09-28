# 03 — End-to-End Flows

## F1 — First login (OAuth)

Trigger: `opencode auth login` or integrations authorize (V2).
Participants: V2 form → `antigravity/oauth.ts` →
`storage.ts` → `project.ts` → `quota.ts`.
(Historical V1: `cli.ts` → `server.ts` localhost listener → same tail.)

1. Prompt login mode / account action (`add` vs `replace`) + optional
   project override.
2. `authorizeAntigravity(projectId)` → open consent URL (PKCE S256,
   `state=base64url({verifier,projectId})`).
3. Manual code/redirect-URL paste via the authorize `callback`
   (V2; validates state equality). (Historical V1: localhost listener on
   port 51121 unless WSL/remote/`shouldSkipLocalServer`.)
4. `exchangeAntigravity(code, state)` → validate state → token POST →
   userinfo GET → `loadCodeAssist` project discovery → packed
   `refresh|project`.
5. V2 `persistOAuthAccount` (`src/v2-plugin.ts`; dedupe by refresh
   token or case-insensitive email, cap 10, `saveAccountsReplace` v4 +
   per-family index) → `currentAuth` set, native manager reset.
6. Post-login `verifyAccountAccess` sweep; configure-models via updater.
   Completion: account persisted, enabled, selectable by rotation.

Error propagation: `failed{error}` surfaces raw token-exchange text; userinfo
failure tolerated; project failure tolerated to empty-project (deferred).

## F2 — Model request (hot path)

Trigger: SDK call to `generativelanguage.googleapis.com/v1*/models/*:
(generateContent|streamGenerateContent|countTokens)`.
Participants: V2 `antigravityFetch` → `normalizeFetchBody` → native engine
`executeAntigravityRequest` (`src/plugin/engine.ts`, sole router since
Task 2) → `accounts → token → project → request → fetch(Antigravity) →
streaming transformer`.

1. V2: `requireOAuthAuth`; reject non-model GL paths; strip credentials for
   external origins and direct-fetch.
2. V1: normalize Request clone (method/headers/body/signal preserved without
   consuming original); re-`getAuth()`; empty pool → throw login error.
3. `while(true)` loop per §02.5: route (`resolveHeaderRoutingDecision`;
   gemini-only cross-style fallback) → select
   (`getCurrentOrNextForFamily`) → soft-quota gate (wait
   `getMinWaitTimeForSoftQuota` capped by `max_rate_limit_wait_seconds` or
   throw quota-protection) → `refreshAccessToken` (`invalid_grant` →
   evict + continue) → `ensureProjectContext` → `prepareAntigravityRequest`
   → optional one-shot thinking warmup (`buildThinkingWarmupBody`,
   `:streamGenerateContent?alt=sse`, transform-and-discard) → Antigravity
   fetch → `transformAntigravityResponse` (streaming) → success
   (`markRequestSuccess`, reset backoff/failure, log) or classify
   (`parseRateLimitReason/calculateBackoffMs`, `markRateLimitedWithReason`,
   verification handling, empty-response retries, `Retry-After`, abort
   checks) → rotate and repeat.
4. Abort checked each iteration; `quiet_mode` / `toast_scope=root_only` +
   5 s rate-toast debounce gate user-visible toasts.

Completion: transformed `Response` returned to the SDK. The loop only exits
via response, throw (quota/auth/abort), or fatal error.

## F3 — Quota refresh / verification

Trigger: `antigravity_accounts{check_quota|verify}` tool, CLI menu, or
automatic post-login sweep. `checkAccountsQuota` refreshes expired tokens,
ensures project context, probes BOTH pools in parallel, returns per-account
`{status, quota, geminiCliQuota, updatedAccount}`. `verify` maps
blocked → disabled + verification fields + URL; ok → clears flags; error →
records without disabling; always persists + invalidates fetch.

## F4 — Thinking recovery

(a) In-request: `needsThinkingRecovery` → `closeToolLoopForThinking`
→ synthetic model + user turns → request proceeds without
`Invalid signature` 400s.
(b) Session-error: `session.error` → `detectErrorType` →
`handleSessionRecovery` (tool_result inject / thinking prepend/strip) →
optional `auto_resume` continue + success toast.

## F5 — Auto-update check

Trigger: root `session.created` only (child `parentID` sessions ignored
without consuming the once-flag; non-created events ignored).
`findPluginEntry` → cached-or-pinned version → prerelease skip →
`getLatestVersion()` (5 s npm `dist-tags`) → equal → done; else
`autoUpdate=false` → info toast only; pinned → rewrite pin +
`invalidatePackage` + success toast; unpinned → invalidate + info toast.
All fire-and-forget (`setTimeout(0)`); toast failures swallowed; failures to
debug log. Local-dev (`file://`) → warning toast, no check.

## F6 — Teardown

V2 dispose aborts the event-subscription controller and calls
`disposeAntigravityRuntimeResources()` (stops refresh queue, disposes disk
signature cache). `activeRefreshQueue.stop()` is also called before
re-creating the queue on each loader invocation.
