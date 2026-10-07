# 03 — End-to-End Flows

## F1 — First login (OAuth)

Trigger: `opencode auth login` (select Antigravity; one account per command,
up to 10 saved accounts; rerun the command to add another).
Participants: V2 `antigravity` / `antigravity-oauth` pre-authorization form → `adapters/opencode/oauth.ts` →
`adapters/filesystem/account-store.ts` (via `account-service.ts`) → `project.ts` → `quota.ts`.
The method declares one required selection field (no Skip option).

1. The form shows saved pool state (`N/10`, disabled markers) and the
   `/antigravity` management hint before authorization starts. Add/reconnect
   starts OAuth; native Ctrl+C cancels before authorization without account
   writes. Missing/legacy answers cannot bypass selection. There is no Exit
   option or host-specific login metadata; stock v2.0.18 performs one attempt.
2. `authorizeAntigravity("")` → open consent URL (PKCE S256,
   `state=base64url({verifier,projectId:""})`, `prompt=consent`).
3. Manual code/redirect-URL paste via the authorize `callback`
   (validates state equality; raw code requires the expected state from the
   authorize URL). No localhost listener.
4. `exchangeAntigravity(code, state)` → validate state → token POST →
   userinfo GET → `loadCodeAssist` project discovery → packed
   `refresh|project`.
5. `persistOAuthAccount(result, "add")` (`src/plugin/account-service.ts`;
   dedupe by refresh token or case-insensitive email, cap 10,
   single-lock replace write + per-family index) → `currentAuth` set, native
   manager reset.
6. Completion: account persisted, enabled, selectable by rotation.
   Re-signing with a saved account reconnects in place (count unchanged,
   durable id preserved); a new account at 10/10 fails cleanly; cancelling
   writes nothing.

Error propagation: `failed{error}` surfaces raw token-exchange text; userinfo
failure tolerated; project failure tolerated to empty-project (deferred).

## F2 — Model request (hot path)

Trigger: SDK call to `generativelanguage.googleapis.com/v1*/models/*:
(generateContent|streamGenerateContent|countTokens)`.
Participants: V2 `antigravityFetch` → `normalizeFetchBody` → application
composition `executeAntigravityRequest` → `executeRequest`
(`src/app/execute-request.ts`, sole request path) →
`accounts → token → project → modules/inference/pipeline.ts` →
`adapters/antigravity/inference-client.ts` → inference streaming transformer.

1. V2: `requireOAuthAuth`; reject non-model GL paths; strip credentials for
   external origins and direct-fetch.
2. V2: normalize Request clone via `normalizeFetchBody`
   (method/headers/body/signal preserved without consuming original);
   re-`getAuth()`; empty pool → throw login error.
3. `while(true)` loop per §02.5: select
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

Trigger: `antigravity_accounts{check_quota|verify}` tool or automatic
post-login sweep. `checkAccountsQuota` refreshes expired tokens,
ensures project context, probes Antigravity quota, returns per-account
`{status, quota, updatedAccount}`. `verify` maps
blocked → disabled + verification fields + URL; ok → clears flags; error →
records without disabling; always persists + invalidates fetch.

## F4 — Thinking recovery

(a) In-request: `needsThinkingRecovery` → `closeToolLoopForThinking`
→ synthetic model + user turns → request proceeds without
`Invalid signature` 400s.
(b) Tool-result preflight: the provider-agnostic V2 `context` hook finds
dangling assistant tool calls and inserts cancelled `Message.tool` results in
the outgoing model history. (c) Session-error: `session.error` →
`detectErrorType` → `handleSessionRecovery` (thinking prepend/strip) → optional
`auto_resume` continue + success toast. The context repair does not persist
those synthetic tool results because V2 exposes no structured prompt-input
API.

## F5 — Auto-update check

Trigger: root `session.created` only (child `parentID` sessions ignored
without consuming the once-flag; non-created events ignored).
`findPluginEntry` → cached-or-pinned version → prerelease skip →
`getLatestVersion()` (5 s npm `dist-tags`) → equal → done; else
`autoUpdate=false` → info toast only; pinned → rewrite pin +
`invalidatePackage` + success toast; unpinned → invalidate + info toast.
All fire-and-forget (`setTimeout(0)`); toast failures swallowed; failures to
debug log. Local-dev (`file://`) → warning toast, no check.
Known limitation: the checker reads the legacy `plugin` (singular) config
key, not V2 `plugins` (plural); local-path installs stay silent.

## F6 — Teardown

V2 dispose aborts the event-subscription controller and calls
`disposeAntigravityRuntimeResources()` (stops refresh queue, disposes disk
signature cache). `activeRefreshQueue.stop()` is also called before
re-creating the queue on each loader invocation.
