# 02 — Subsystem Specifications

## 2.1 OAuth authorize + exchange — compatibility facade + Antigravity adapter

- `src/adapters/opencode/oauth.ts` preserves the public `authorizeAntigravity`
  and `exchangeAntigravity` API; `src/adapters/antigravity/oauth.ts` owns the
  provider OAuth workflow. OAuth endpoint construction and wire parsing live
  in `src/adapters/antigravity/oauth-client.ts`; project discovery HTTP lives
  in `project-client.ts`.
- `authorizeAntigravity(projectId="")` builds
  `https://accounts.google.com/o/oauth2/v2/auth` with `client_id`,
  `response_type=code`, `redirect_uri=http://localhost:51121/oauth-callback`,
  5 scopes joined by space, `code_challenge` + `code_challenge_method=S256`,
  `state=base64url({verifier,projectId})`, `access_type=offline`,
  `prompt=consent`. PKCE pair from `@openauthjs/openauth/pkce ::
generatePKCE`. No I/O.
- `exchangeAntigravity(code, state)` never throws; returns
  `success{refresh,access,expires,email?,projectId} | failed{error}`.
  Sequence: `decodeState` → `Date.now()` startTime → POST
  adapter POST to `oauth2.googleapis.com/token` (form-urlencoded, Google OAuth UA) → non-ok
  yields raw-text `failed` → GET userinfo (failure tolerated → `{}`) →
  missing `refresh_token` yields `failed` → conditional
  adapter project discovery → pack `refresh|projectId` (2 segments only) →
  `expires = calculateTokenExpiry(startTime, expires_in)`.
- `fetchProjectID` POSTs `{metadata:{ideType:ANTIGRAVITY,
platform:WINDOWS|MACOS, pluginType:GEMINI}}` to deduped
  `[...ANTIGRAVITY_LOAD_ENDPOINTS, ...ANTIGRAVITY_ENDPOINT_FALLBACKS]`
  `v1internal:loadCodeAssist`, using the Google OAuth UA with Antigravity
  Client-Metadata. Accepts `cloudaicompanionProject` string or `{id}`.
  Total failure → warn + `""` (caller stores `refresh|`; resolution deferred).
- Timeouts: only `fetchProjectID` has a 10 s `AbortController`. Token and
  userinfo fetches are unbounded (risk, see §07).
- Stateless; no cache/persistence/retry except the multi-endpoint loop.

## 2.2 Token helpers + refresh — account policy + Antigravity token adapter

- `parseRefreshParts` splits `refresh|projectId|managedProjectId`;
  `formatRefreshParts` serializes. Callers MUST tolerate the 2-segment form
  written by `oauth.ts` (missing 3rd segment).
- `accessTokenExpired` uses a 60 s clock-skew buffer. `calculateTokenExpiry
(requestTimeMs, expiresInSeconds)` defaults 3600 s; NaN/≤0 → immediate
  expiry.
- `refreshAccessToken` (`src/plugin/token.ts`) is the compatibility entry into
  the single policy in `src/modules/accounts/refresh/policy.ts`, which delegates
  the POST to `adapters/antigravity/token-client.ts`, which
  sends `grant_type=refresh_token` with client id/secret and parses varied error
  shapes, throws `AntigravityTokenRefreshError{code,description,status,
statusText}` on `!ok`; `invalid_grant` invalidates project cache and clears
  cached auth; preserves project ids when the server omits `refresh_token`;
  stores cached auth + invalidates project cache on success.
- Managed-project lookup, retry timing, cache coalescing, and fallback selection
  live in `src/modules/accounts/project-context/policy.ts`;
  `adapters/antigravity/project.ts` composes the policy with its provider port,
  and `adapters/opencode/project.ts` binds the host logger while preserving the
  raw loader API.
- Refresh is unified: `src/app/composition.ts ::
refreshOAuthCredentialUnified` and the V2 authorize-callback path both go
  through `src/plugin/token.ts :: refreshAccessToken` (skew handling,
  `invalid_grant` eviction). `src/adapters/opencode/plugin.ts ::
refreshOAuthCredential` is a thin wrapper that delegates to the unified
  path and persists refresh rotation; new code MUST NOT add a parallel
  refresh implementation.

## 2.3 Request preparation — `src/modules/inference/pipeline.ts`

The plugin-facing `src/plugin/request.ts` compatibility API supplies the
config, debug, fingerprint, and image-storage callbacks; request policy remains
inference-owned.

`prepareAntigravityRequest(input, init, accessToken, projectId,
endpointOverride, forceThinkingRecovery, opts)`:

1. Rejects non-generative-language URLs (`isGenerativeLanguageRequest`
   hostname check); strips `x-goog-api-key / x-api-key /
x-goog-user-project` from OAuth requests.
2. Parses `/models/([^:]+):(\w+)`; resolves via
   `resolveAntigravityModel`; builds
   `v1internal:streamGenerateContent?alt=sse` or `generateContent` with
   `Authorization: Bearer`.
3. Wrapped-body `{project, request}` vs raw Gemini path.
4. Tool normalization: Claude → `functionDeclarations` +
   `cleanJSONSchema` + `_placeholder` for empty schemas; Gemini →
   `applyGeminiTransforms`.
5. Thinking: tier/variant resolution (`thinkingLevel` for Gemini 3 else
   budget), Claude VALIDATED mode, interleaved hint, image-model branch
   (imageConfig, permissive safety, tools stripped, image system prompt),
   `cache_control` auto-caching (including optional
   `claude_prompt_auto_caching`, default off),
   `system_instruction` normalization, `cachedContent`.
   Gemini tool-call payloads enforce valid `thought_signature` behavior on
   `functionCall` parts; empty/invalid `contents.parts` and
   `systemInstruction.parts` are removed before forwarding.
6. Signature plumbing: `buildSignatureSessionKey(session:model:project:
conversation + seed-hash fallback)`, `deepFilterThinkingBlocks`,
   `ensureThinkingBeforeToolUseInContents/Messages` (sentinel
   `skip_thought_signature_validator` / `SKIP_THOUGHT_SIGNATURE`),
   `sanitizeRequestPayloadForAntigravity` (first functionCall keeps or restores
   the preceding cached signature; parallels stripped; sentinel only after
   signature recovery misses), debug/synthetic thinking inject + strip.
7. Returns `{request, init, streaming, requestedModel, effectiveModel,
projectId, endpoint, sessionId, toolDebug*, needsSignedThinkingWarmup,
thinkingRecoveryMessage}`.

## 2.4 Schema + thinking utilities — inference module and compatibility helpers

- `src/modules/inference/schema-cleaner.ts :: cleanJSONSchemaForAntigravity`
  retains the 4-phase schema cleaning: (1) `$ref`→hint, `const`→enum,
  `enum`→Allowed hint, `additionalProperties`/constraints→description;
  (2) merge `allOf`, flatten `anyOf/oneOf` (enum-merge or object>array>typed
  scoring + Accepts hint), flatten `type[]`+nullable; (3) remove unsupported
  keywords + `required` cleanup; (4) empty-object placeholder.
- `src/modules/inference/signature-policy.ts` owns tool-turn ordering and
  preserves received provider signatures, then restores a session-cached
  signature or uses the sentinel when no reusable signature remains.
  `thinking-filter.ts` owns pure thinking-block filtering; legacy
  `request-helpers.ts` supplies `keep_thinking` and logging policy.
- Thinking: `DEFAULT_THINKING_BUDGET=16000`; `resolveThinkingConfig`
  default-on for thinking models; `stripAllThinkingBlocks` is the Claude
  default unless `keep_thinking`; unsigned-block filters consult
  `isOurCachedSignature` (≥50 chars + cache match, sentinel bypass,
  last-assistant special case); `removeTrailingThinkingBlocks`.
- Response: `transformThinkingParts / transformGeminiCandidate`
  (`thought:true`/`type:thinking` → `type:reasoning` +
  `providerMetadata.anthropic.signature`; functionCall args JSON-parse with
  `{}` fallback; inlineData → `processImageData`); usage extractors;
  preview-access rewrite; `injectParameterSignatures /
injectToolHardeningInstruction`; `fixToolResponseGrouping /
validateAndFixClaudeToolPairing`; `isEmptyResponseBody /
createSyntheticErrorResponse`.

## 2.5 Account pool + selection — `modules/accounts/account-pool.ts`, `selection/`

- `selection/backoff.ts :: RateLimitReason = QUOTA_EXHAUSTED | RATE_LIMIT_EXCEEDED |
MODEL_CAPACITY_EXHAUSTED | SERVER_ERROR | UNKNOWN`.
  `parseRateLimitReason`: 529/503 → capacity, 500 → server, reason/message
  scan capacity>rate-limit>quota, 429 → UNKNOWN.
- `calculateBackoffMs`: quota `[60 s, 5 m, 30 m, 2 h]` by failure count;
  rate 30 s; capacity 45 s ± 15 s jitter; server 20 s; unknown 60 s;
  `Retry-After` respected (≥2 s floor).
- `QuotaKey = claude | gemini-antigravity[:model]`. Existing `gemini-cli`
  cooldown entries in v4 stores are obsolete and ignored, not migrated away.
- `ManagedAccount{index,email,addedAt,lastUsed,parts,access,expires,enabled,
rateLimitResetTimes,touchedForQuota,consecutiveFailures+TTL,
fingerprint+history[5],cachedQuota+updatedAt,verification*}`.
- Pool membership, family cursors, bookkeeping, and account cooldown state are
  owned by `src/modules/accounts/account-pool.ts`. Health/token-bucket scoring,
  hybrid selection, failure classification, and backoff are owned by
  `src/modules/accounts/selection/`.
- Selection: sticky / round-robin / hybrid (default hybrid) via
  `getCurrentOrNextForFamily` with Antigravity quota + soft-quota + cooldown
  filters, PID offset, cursor round-robin. Hybrid score =
  health×2 + tokens×5 + freshness×0.1 + stickiness bonus 150, switch
  threshold 100 (`selection/rotation.ts :: selectHybridAccount`,
  `HealthScoreTracker` init 70 +1/−10/−20, 2/h recovery, max 100, min-usable
  50; `TokenBucketTracker` max 50, regen 6/min).
- `src/adapters/opencode/account-pool.ts` supplies persistence, fingerprint,
  and logging dependencies to the accounts module. The request engine remains
  the sole router and continues to own retry orchestration.
- `src/app/execute-request.ts` retries capacity/server-busy responses with
  exponential 1/2/4/8 s delays (capped at 8 s, with ±10% jitter), up to three
  in-place retries per endpoint and one fingerprint refresh before fallback.
  It also retains `FIRST_RETRY 1 s / SWITCH 5 s`, dedup window 2 s, state reset
  120 s, and `MAX_CONSECUTIVE_FAILURES=5` → 30 s cooldown.

## 2.6 Quota probing — account policy + Antigravity quota adapter

`adapters/antigravity/quota-client.ts` owns `fetchAvailableModels` (10 s),
best-effort `retrieveUserQuotaSummary` (5 s), and wire parsing. Plugin quota
policy runs both probes in parallel; `classifyQuotaGroup` (claude substring; gemini-3 →
pro/flash via `getModelFamily`); per-model aggregate = min remaining + earliest
reset. Summary buckets retain explicit weekly/5h windows and group labels.
Separate per-model and grouped snapshots persist in v4 with independent
timestamps. `checkAccountsQuota` refreshes expired tokens, ensures project
context, fetches both quota endpoints, and does not let summary failure block
the per-model reading.

## 2.7 Account persistence — `modules/accounts/persistence/`

Account-owned store versions, V1→V4 migrations, email deduplication, merge and
replace policy, and tombstone matching live in
`src/modules/accounts/persistence/`. `adapters/filesystem/account-store.ts`
owns `OPENCODE_CONFIG_DIR || ~/.config/opencode/antigravity-accounts.json`
(win32 legacy `%APPDATA%` migration rename→copy; chmod 0600; gitignore
entries), `proper-lockfile` (10 s stale, 5 retries), atomic tmp→rename, and
secure file access. Runtime callers use this adapter directly for persistence;
the former `src/plugin/storage.ts` compatibility facade was removed in Step 14.

`loadAccounts` migrates+saves, validates refreshToken, dedupes by email (newest
lastUsed/addedAt), and clamps `activeIndex`. Service writes MUST use the
single-lock `updateAccounts` transaction. `saveAccounts` merges by refreshToken
(preserving project ids/rate limits/max lastUsed) and is reserved for
token-rotation snapshots — never use it for deletion. `saveAccountsReplace`
retains on-disk tombstones unless `{ clearTombstones: true }` explicitly
requests a full reset; that reset can replace an unreadable file. Tombstones
prevent stale saves from restoring deleted account generations.

## 2.8 Fingerprints — `src/plugin/fingerprint.ts`

Per-account `{deviceId UUID, sessionToken 16 B hex, userAgent
antigravity/{ver} {darwin|win32}/{x64|arm64}, apiClient, clientMetadata
{ideType: ANTIGRAVITY, platform: WINDOWS|MACOS, pluginType: GEMINI},
createdAt}`; history max 5 with
`{initial|regenerated|restored}` reasons. Client metadata is reduced:
`osVersion`,
`arch`, `sqmId` are not sent; `buildFingerprintHeaders`
composes ONLY `User-Agent` (applied on the antigravity path in
`request.ts`; `X-Goog-QuotaUser`, `X-Client-Device-Id`,
`X-Goog-Api-Client`, `Client-Metadata` no longer sent on content
requests). `getRandomizedHeaders("antigravity")` never emits linux
(Linux masquerades as macOS).

## 2.9 Managed projects — policy in `src/modules/accounts/project-context/policy.ts`,

transport in `src/adapters/antigravity/project-client.ts`, composition in
`src/adapters/antigravity/project.ts`, with the host logger facade in
`src/adapters/opencode/project.ts`

`loadManagedProject` (`loadCodeAssist` + duetProject across LOAD+FALLBACK,
nodejs UA + Client-Metadata), adapter onboarding sessions (one `onboardUser`
attempt per current endpoint, each request/body read bounded at 10 s),
`adapters/antigravity/project.ts :: onboardManagedProject` (10×5 s retries per endpoint),
`ensureProjectContext` (empty without token; refresh-keyed cache + pending
dedup; managed short-circuit; else load→onboard FREE→fallback
`projectId`→`ANTIGRAVITY_DEFAULT_PROJECT_ID`; caches under new key).
`invalidateProjectContextCache` on `invalid_grant`/rotation. Verification
HTTP/body parsing is owned by `adapters/antigravity/verification-client.ts`
and `verification-parser.ts`; `plugin/verify.ts` retains account outcome policy.

## 2.10 Streaming — `src/modules/inference/streaming/transformer.ts`

`createStreamingTransformer(store, callbacks, options)`: TextDecoder
line-buffered TransformStream; per-line `transformSseLine` (per-candidate
thought accumulation, Claude index 0, fullText+signature store,
delta-only dedup via sentBuffer+displayedHashes DJB2, one-shot debug
inject, `transformThinkingParts`); usageMetadata detection + synthetic
zero-usage injection on flush. `transformStreamingPayload` is the
non-streaming variant.

## 2.11 Recovery (two layers)

- In-request turn repair (`modules/session-recovery/turn-repair.ts`):
  `analyzeConversationState`, `closeToolLoopForThinking` (strip thinking,
  append synthetic model `[Processing|completed|N]` + user `[Continue]`),
  `needsThinkingRecovery = inToolLoop && !turnHasThinking`, compacted-turn
  detectors.
- Session-error policy (`modules/session-recovery/detection.ts` and
  `repair.ts`): classifies `tool_result_missing | thinking_block_order |
thinking_disabled_violation`; gated by `session_recovery` and deduplicates
  in-flight session-error repairs. Dangling tool calls are repaired by the
  provider-agnostic V2 `context` hook, which adds canonical cancelled
  `Message.tool` results to outgoing model history; it does not rewrite stored
  history because V2's public prompt API accepts text only. Thinking-order
  repair prepends synthetic thinking (`prt_0000000000_thinking`) or strips
  thinking through the filesystem storage port. Optional `auto_resume`
  continues a successful thinking repair. The OpenCode adapter composes
  filesystem storage and OpenCode session ports; the `session.retry` hook stays
  provider-agnostic.

## 2.12 Images, accounts service, RPC/TUI, version, logging

- No search tool is registered. The
  D-SEARCH-MUTEX guard (drop `web_search` with warn when function
  declarations exist) lives in `modules/inference/transforms/gemini.ts`; the
  request boundary emits the warning for SDK-supplied search tools.
- `image-saver.ts`: `saveImageToDisk`
  (`~/.opencode/generated-images/image-{ts}-{rand}.{ext}`, `""` on fail) →
  markdown `![...](path)` else data URL.
- `modules/accounts/account-admin.ts`: account policy behind the
  `antigravity_accounts` tool and `/antigravity` TUI. Owns credential-free list
  and verification results, target resolution
  (id-vs-index, fail-closed on unknown ids/token values), single-lock
  `updateAccounts` mutations (`select|enable|disable|delete`, family cursor
  repair), OAuth dedupe/cap enforcement, and refresh-rotation persistence.
- `modules/accounts/quota/`: quota aggregation/check policy, redacted internal
  results, cache snapshots, per-account timeout and credential-free quota
  presentation. The plugin compatibility façade validates the host RPC quota
  schema separately. Cache writes remain matched to the checked account
  generation and retain newer/last-good readings.
- `modules/accounts/verification/` persists verification outcomes; Antigravity
  request and response behavior remains in its adapter.
- `modules/accounts/refresh/` owns unified credential refresh and proactive
  queue scheduling. `v2-plugin.ts` still stops/replaces the queue and manager
  on account/auth changes.
- `plugin/account-service.ts`: compatibility façade for existing imports.
  It no longer owns admin policy. The module service returns credential-free
  results separately from RPC/TUI schemas and presentation.
- `AccountSummary` and `QuotaPresentation` remain credential-free contracts;
  list/quota/verify/enable/disable/select/delete/delete-all behavior is
  unchanged.
- `tui.ts` / `rpc.ts`: production `/antigravity` dialog + credential-free
  `AntigravityAccounts` RPC (`list/quota/verify/mutate/deleteAll/ping`),
  sharing account-admin use cases with the legacy
  `antigravity_accounts` tool. Transport rule: omit absent optionals, never
  send explicit `undefined` (host JSON codec rejects it); stale mutation
  targets fail closed. Quota controller and built native rendering have
  automated coverage; installed host input/auth/stack integration needs
  `../dev/manual-testing.md`.
- `adapters/antigravity/version.ts` owns version discovery and the fallback
  (changelog scrape 5 k chars → fallback; regex `\d+\.\d+\.\d+`; 5 s;
  `setAntigravityVersion` write-once); `adapters/opencode/version.ts` binds
  `initAntigravityVersion` to host logging.
- `platform/logging/` owns structured log events, neutral formatting, and
  independent file/TUI flag policy. `adapters/opencode/logging.ts` delivers
  host-panel and optional console events; `adapters/filesystem/debug-log.ts`
  owns file paths, timestamps, and 25-file retention. The
  `adapters/opencode/debug.ts` keeps Antigravity request/account trace formatting and
  Authorization masking (12 k preview). `debug` controls file logging only;
  `debug_tui` independently controls the TUI panel
  (`OPENCODE_ANTIGRAVITY_DEBUG` vs `OPENCODE_ANTIGRAVITY_DEBUG_TUI`).
- `adapters/opencode/config/`: Zod `AntigravityConfigSchema` + `DEFAULT_CONFIG`
  (`schema.ts`), user-then-project load with signature_cache deep-merge
  (`loader.ts`), `OPENCODE_MODEL_DEFINITIONS` (`models.ts`), opencode.json
  injector (`updater.ts`).
- `modules/inference/signature-cache.ts` owns the 1 h in-memory cache, 100-entry
  per-scope cap, expiry-then-oldest-quarter eviction, and disk-port promotion.
  `modules/inference/signature-store.ts` owns the signed-thinking store;
  streaming thought buffers remain with the inference streaming pipeline.
- `adapters/filesystem/signature-cache-store.ts` owns the version-1 disk file,
  48 h TTL, 60 s batched writes, atomic merge/write, and 30 min memory cleanup.
  Disk keys retain the composite signature scope plus the 16-hex SHA-256 text key.
