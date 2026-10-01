# 05 — Public Contracts, Error Handling, Concurrency

## Public contracts

- Plugin entrypoints: V2 default plugin +
  `normalizeFetchBody`, `getFetchDestination`,
  `isGenerativeLanguageModelPath`, `parseOAuthCallbackInput`,
  `manageAccounts` (`src/v2-plugin.ts`); `executeAntigravityRequest`,
  `refreshOAuthCredentialUnified`, `disposeAntigravityRuntimeResources`
  (`src/plugin/engine.ts`); `verifyAccountAccess` (`src/plugin/verify.ts`).
- Fetch scope rule (R-FETCH-SCOPE): the interceptor MUST only route
  absolute http(s) URLs on `generativelanguage.googleapis.com` matching
  `^/v1(beta)?/models/[^/]+:(generateContent|streamGenerateContent|
  countTokens)$`. Non-model GL paths throw
  `Unsupported Google Generative Language endpoint`; external origins are
  direct-fetched with `x-goog-api-key` and `authorization` removed.
  Evidence: `v2-plugin.ts :: antigravityFetch`; `v2-plugin.test.ts` ::
  validates destinations, rejects `/upload/v1beta/files`, requires absolute
  URL.
- OAuth callback rule: input is either a full localhost redirect URL
  (code+state extracted, state equality enforced against the authorize URL)
  or a raw code (requires non-empty expected state). Empty code, missing
  code/state in URL, or mismatch throws. Evidence: `parseOAuthCallbackInput`
  + tests (redirect extract, raw-code accept, mismatch reject, trim).
- `normalizeFetchBody` MUST NOT consume the original `Request`
  (clone-then-read), MUST preserve method/headers/signal/cache/credentials/
  integrity/keepalive/mode/redirect/referrer/policy, MUST decode JSON bytes
  (honoring typed-array byteOffset/length) to string when content-type is
  JSON, and MUST pass binary/empty bodies through. Evidence:
  `v2-plugin.test.ts` (4 normalize cases incl. abort-signal liveness).
- Tools: `antigravity_accounts{action, index?}` with `list|check_quota|verify|
  enable|disable|select|delete|delete_all` (see F3; out-of-range index is a
  message, not a write — `v2-plugin.accounts.test.ts`).
  No search tool is registered. Model-declared `web_search` /
  `google_search` names are still recognized and sanitized by the
  D-SEARCH-MUTEX guard in `transform/gemini.ts`.
- Events consumed: `session.created` (child tracking + update check),
  `session.error` (recovery), V2 `session.retry` (forward). V2 `aisdk.hook
  ("sdk")` is beta and MAY change upstream (see §06).

## Error handling

- `exchangeAntigravity` never throws (`failed{error}` with raw server text).
- Token refresh is unified: `src/plugin/token.ts :: refreshAccessToken` is
  the single implementation, reached via
  `src/plugin/engine.ts :: refreshOAuthCredentialUnified` and via
  `src/v2-plugin.ts :: refreshOAuthCredential` (thin wrapper preserving the
  credential shape). `invalid_grant` → evict account + clear project/auth
  caches + rotate; all-invalid → login error. Do not reintroduce a parallel
  refresh path (see D-REFRESH-DUAL).
- Rate-limit handling: classify → backoff (`Retry-After` ≥ 2 s respected)
  → `markRateLimitedWithReason` → rotate; all-blocked → wait (capped) or
  quota-protection throw; capacity uses tiered `[5..60 s]` delays.
- Verification-required: toast `needs verification…`, persist
  `verificationRequired*` fields, disable on blocked; error status records
  without disabling.
- Empty responses: per-key attempts → `EmptyResponseError` → synthetic
  error response or retry per config.
- Recovery: `tool_result_missing` → inject cancelled result + continue;
  `thinking_block_order` → prepend synthetic thinking; `disabled_violation`
  → strip thinking. All toast failures swallowed (`.catch(()=>{})`) by
  design; debug log is the record.
- Update checker: ALL failures → `null`/`false`/no-throw; npm fetch has a
  5 s abort; config parse errors `continue`.
- `manageAccounts` unknown actions and bad indices return message strings;
  `delete_all` resets auth to empty OAuth and invalidates fetch.

## Concurrency and async

- Execution is single-threaded async with a per-request `while(true)`
  rotation loop; cross-request state is in module-level Maps/Sets keyed by
  account/quota/session. AbortSignal is checked each iteration; `sleep`
  takes the signal.
- `proper-lockfile` guards `accounts.json` RMW; the update checker cache
  invalidation (`bun.lock`/`package.json` RMW) has NO locking — concurrent
  OpenCode instances can race (risk).
- Refresh queue is serial (`runRefreshCheck` skips disabled/expired).
  Project-context has pending-request dedup. Rate-limit dedup window is 2 s.
- Order-sensitive: the native manager MUST be reset (`resetNativeManager()`)
  on auth change and account mutation (else stale routing or stuck
  rejection). Refresh queue MUST be stopped before re-creation.
- Fire-and-forget (`setTimeout(0)`, `void` event loop) MUST never reject
  into session creation; failures go to debug log / console only.
