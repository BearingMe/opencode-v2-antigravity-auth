# 06 — External Contracts, Testing, Compatibility, Divergences, Unresolved

## External contracts (authoritative)

1. Thought signatures (Google). Responses MAY carry `thoughtSignature` in
   content parts; clients SHOULD echo them back exactly. Gemini 3 ENFORCES
   validation during function calling — missing signatures yield 400,
   including at `minimal` thinking level. Parallel calls carry the
   signature on the FIRST `functionCall` only, and the reply MUST order
   all calls before all responses (`FC1+sig, FC2, FR1, FR2` — interleaving
   is a 400). `skip_thought_signature_validator` in the signature field
   is an officially supported LAST-RESORT bypass (degrades model
   performance). Non-functionCall parts are recommended-but-unenforced
   (degraded quality if omitted). Gemini 3 Pro Image is lenient (no 400)
   yet still needs round-tripping for context. (Re-verified 2026-09-29:
   parallel ordering, empty-text streaming part, Gemini 3-vs-2.5 strictness
   split, and the `context_engineering_is_the_way_to_go` equivalent dummy
   all still match the live pages; validation is current-turn-only.)
   The plugin's cache → re-inject → sanitize → warmup → sentinel-escalation
   design directly implements this contract (R-SIG-PRESERVE /
   R-SIG-CLAUDE-STRIP / R-SIG-SENTINEL-LAST-RESORT; first-call-keeps,
   parallels-stripped).
   - `Thought signatures - generateContent API` (Google AI for Developers,
     https://ai.google.dev/gemini-api/docs/generate-content/thought-signatures)
   - `Thought signatures | Gemini Enterprise Agent Platform`
     (Google Cloud, https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/thinking/thought-signatures)
   - `Gemini 3 developer guide - Interactions API`
     (https://ai.google.dev/gemini-api/docs/gemini-3); `Gemini thinking -
     Interactions API` (https://ai.google.dev/gemini-api/docs/thinking)
   Relevance: justifies R-SIG-* rules (preserve/claude-strip/sentinel) and
   explains why Gemini 3 Pro Image is lenient (no 400) yet still needs
   round-tripping.
2. OAuth PKCE S256 (IETF RFC 7636). Client generates `code_verifier`,
   sends `code_challenge = BASE64URL(SHA256(verifier))` +
   `code_challenge_method=S256` with the authorize request, and sends the
   raw verifier with the code exchange; the server verifies before issuing
   tokens. Recommended for ALL authorization-code clients (RFC 7636;
   oauth.net PKCE; Auth0 PKCE docs).
   - RFC 7636 (https://datatracker.ietf.org/doc/html/rfc7636)
   - https://oauth.net/2/pkce
   Relevance: the plugin's `generatePKCE → authorize → decodeState →
   code_verifier exchange` flow is a standard application of this contract.
   Note the project additionally sends its confidential `client_secret` in
   the exchange (CLI-spoofing behavior, not the public-client PKCE norm).
3. OpenCode V2 plugin API (beta). Plugins run in-process; documented hooks
   include `ctx.aisdk.hook("sdk", cb)`, `ctx.provider/model/integration/tool/session/
   event` transforms. V2 API explicitly "may change before stable".
   - `Overview | OpenCode` (https://opencode.ai/v2/docs/build/plugins)
   - `Effect - opencode/plugin`
     (https://opencode.ai/v2/docs/build/plugins/effect)
   - `Plugins - OpenCode` (https://opencode.ai/docs/plugins)
   Relevance: the V2 bridge's reliance on `aisdk.hook("sdk")`,
   `provider.transform`, `model.transform`, `integration.transform`,
   `tool.transform`, `session.hook`, `event.subscribe` inherits beta
   instability. This codebase (pinned `@opencode/plugin` / `@opencode/schema`
   2.0.18) uses `provider.transform` / `model.transform`; treat any upstream
   naming drift as version-scoped, not a violation.

## Testing guarantees (from analysis)

- `constants.test.ts`: Gemini-CLI header pin; static CLI headers regardless
  of model; antigravity UA format / platform alignment / never-linux;
  `HeaderSet` optionality.
- `v2-plugin.test.ts`: plugin id/setup; `normalizeFetchBody` behaviors;
  destination/path validation; callback-parsing behaviors.
- `v2-plugin.accounts.test.ts`: delete-reselect, out-of-range no-write,
  list purity, blocked→disabled+URL, ok passthrough, error-without-disable.
- `v2-plugin.setup.test.ts`: full mocked V2 setup (registration, label,
  API-key passthrough, unauthenticated throw, authorize→persist, SDK route
  + `apiKey="antigravity-oauth"`, loader-missing/reject errors, decoded
  JSON body to routed fetch, per-session child tracker with duplicate-safe
  behavior at capacity).
- `plugin/*` + subdirs: colocated Vitest files covering model
  resolution, schema sanitization, cross-model sanitizer, quota fallback
  (antigravity-first), rotation/hybrid selection, recovery,
  thinking-recovery, token, storage (v1–v4, tombstones, replace semantics),
  account-service presentation, account-ui-format, cache, debug/logger —
  see `02-subsystems` and code refs (`request.test.ts`,
  `model-resolver.test.ts`, `rotation.test.ts`, `quota-fallback.test.ts`,
  `antigravity-first-fallback.test.ts`, `cross-model-integration.test.ts`).
- `src/plugin/engine.test.ts`: native-engine tests (routing decision, quota
  fallback, warmup URL, wait formatting, native-enable flag,
  unified-refresh delegation
  `refreshOAuthCredentialUnified → token.ts :: refreshAccessToken`).
- `src/plugin/verify.ts` + `verify.test.ts`:
  `verifyAccountAccess` (blocked→disabled+URL, ok passthrough,
  error-without-disable).
- `src/plugin/verification.ts` + `verification.test.ts`: shared
  verification-error helpers (URL normalization, error-detail extraction).
- No search tool or search module remains; endpoint orderings are PROD→DAILY
  load, DAILY→PROD fallback.
- `hooks/auto-update-checker`: `checker.test.ts` (config/JSONC/entry
  forms), `index.test.ts` (prerelease skip, toast-only mode,
  once-per-instance, child ignore, local-dev warning; fake timers).
- Gaps: NO tests in `src/antigravity/`; `script/` E2E is excluded from
  typecheck and live-endpoint E2E needs real quota. `src/tui.ts` pure gates
  (`isInvalidRpcResponse`, `isStaleMutate`) and the `rpc.ts` transport codec
  mirror are unit-covered (`tui-behavior.test.ts`,
  `rpc-transport.test.ts`); the full dialog/toast flow has no automated
  coverage by design. `src/plugin/account-service.ts`
  quota-presentation semantics are specified in `../dev/quota-contract.md`
  (null-vs-0, failed-refresh-keeps-cache, timeout-partial).

## Compatibility

- Platforms: darwin/win32 modeled (`{darwin|win32}/{x64|arm64}`,
  `WINDOWS|MACOS` metadata); linux is deliberately never emitted in
  antigravity UAs. OAuth completion is manual code/redirect-URL paste via
  the authorize `callback` (no localhost listener). Version fallback
  `1.18.3` when the changelog scrape fails.
- Storage format V1..V4 with forward migrations; npm `dist-tags.latest`
  contract; `bun.lock`/`package.json` installer layout coupling in the
  update checker; OpenCode V2 beta API coupling above.
- Commands referenced: `bun install/run build/typecheck/test`,
  `vitest run [-t] [--watch]`, `test:coverage`, `test:e2e:*`. TS strict +
  `verbatimModuleSyntax` (`import type`), named-only exports, no
  `any`/`ts-ignore`. Runtime (non-test) source imports MUST resolve under
  BOTH `tsconfig.json` and `tsconfig.build.json`: use `.js`-suffixed or
  extensionless relative imports — `.ts`-suffixed imports pass `typecheck`
  but fail `bun run build` with TS5097.

## Known divergences (normative for reviewers)

1. D-REFRESH-DUAL (unified):
   `src/plugin/token.ts :: refreshAccessToken`
   (skew, `invalid_grant` eviction, project-id preservation, cache store)
   is the single refresh implementation, called via
   `src/plugin/engine.ts :: refreshOAuthCredentialUnified` and the V2
   authorize-callback path. `src/v2-plugin.ts :: refreshOAuthCredential`
   remains only as a thin compatibility wrapper. Edits MUST NOT widen the
   gap again.
2. D-REFRESH-SEGMENTS: `oauth.exchangeAntigravity` writes 2-segment
   `refresh|project`; V2 authorize callback re-packs as
   `` `${result.refresh}|${result.projectId}` `` while ALSO calling
   `formatRefreshParts({refreshToken: result.refresh, ...})` for
   `currentAuth` — double-encoding hazard contained only by tolerant
   parsing. Handle both 2- and 3-segment forms on any auth-format change.
3. D-AUTH-SHADOW: an explicit non-OAuth Google connection returns
   `{type:"none"}` and shadows the saved Antigravity pool for ordinary
   Gemini (intentional precedence, but surprising — MUST be preserved or
   changed deliberately with UX sign-off).
4. D-SEARCH-MUTEX: `googleSearch + functionDeclarations` are mutually
   exclusive on Gemini — `web_search` is dropped with `console.warn` when
   functions exist. Reviewers MUST NOT "fix" this by sending both.
5. D-QUOTA-FAIL-OPEN: soft-quota gates fail OPEN on stale/missing cache
   (fail-closed only when all-over with valid resetTime). Deliberate
   availability bias; changing to fail-closed needs product decision.
6. Deprecated `ANTIGRAVITY_HEADERS / ANTIGRAVITY_VERSION / quota_fallback /
   invalidateCache` remain exported. New code MUST use
   `getAntigravityHeaders() / getAntigravityVersion() / invalidatePackage()`.
7. D-RETRY-GLOBAL (observed limitation): `ctx.session.hook("retry")` in
   `src/v2-plugin.ts` is provider-agnostic — any session whose error
   matches `detectErrorType` patterns (tool_result_missing / thinking
   errors) triggers abort + synthetic prompt + toast, including non-Google
   sessions (e.g. Codex). Auth and fetch paths are Google-scoped; only the
   recovery hook crosses that boundary. Do not assume recovery is
   Google-only; narrowing it needs product decision.
8. D-SECRET-COMMITTED (accepted risk): the Antigravity OAuth `client_secret`
   is committed in `src/constants.ts` (CLI-spoof requirement) and duplicated
   in `scripts/check-quota.mjs`. Rotation means changing both; scripts
   SHOULD import from a single source rather than re-hardcoding.
9. Header contract (Explicit): `x-goog-user-project` MUST be
   stripped for ALL header styles; content requests MUST NOT send
   `X-Goog-QuotaUser`, `X-Client-Device-Id`, `X-Goog-Api-Client`, or
   `Client-Metadata` (fingerprint contributes `User-Agent` only);
   `quota_fallback` config is deprecated/ignored (Gemini cross-pool fallback
   is always on).
10. Debug-sink split (Explicit): `debug` = file logging only,
    `debug_tui` = TUI panel only. New code MUST NOT gate file logging on
    `debug_tui` or TUI logging on `debug`.
11. Gemini tool-call signature enforcement (Explicit):
    `functionCall` parts MUST carry valid `thought_signature` behavior;
    empty/invalid `contents.parts` and `systemInstruction.parts` MUST be
    removed before forwarding; response fallback MUST clone before
    reading so recovery signaling survives without `Body already used`.

## Unresolved questions (do not invent answers)

- U1: Exact server-side quota numbers/reset semantics for the two pools
  (analysis records aggregation logic only).
- U2: Whether `loadCodeAssist` prod-first vs request daily-first ordering
  is still optimal (mirrors CLIProxy; no live probe evidence in context).
- U3: Seed-hash session-key collision probability/impact for identical
  first-user texts.
- U4: Intended behavior when `Retry-After` exceeds `max_backoff` vs
  `max_rate_limit_wait` (both caps exist; precedence unclear).
- U5: Whether V2 `getAuth` reading only `activeIndex` (vs per-family
  rotation) is intentional pre-loader staging.
- U6: `switch_on_first` + `pid_offset` interaction semantics (flags exist;
  detailed behavior not in context).

## References (repository evidence)

- Entries: `src/v2-plugin.ts`, `src/constants.ts`,
  `src/google-sdk.ts`, `src/shims.d.ts`
- OAuth: `src/antigravity/oauth.ts`
- Update: `src/hooks/auto-update-checker/{index,checker,cache,constants,
  types,logging}.ts` + `checker.test.ts`, `index.test.ts`
- Core: `src/plugin/{auth,token,cache,request,request-helpers,accounts,
  account-service,rotation,quota,storage,fingerprint,project,refresh-queue,
  recovery,thinking-recovery,errors,debug,logger,logging-utils,verify,
  verification,version,image-saver,types}.ts`
- Subdirs: `src/plugin/{cache,config,core:streaming,recovery,stores,
  transform}/*`
- Tests: `src/constants.test.ts`, `src/v2-plugin.test.ts`,
  `src/v2-plugin.accounts.test.ts`, `src/v2-plugin.setup.test.ts` +
  colocated `src/plugin/**/*.test.ts`
- Docs in repo: `README.md`, `docs/README.md` (index), `docs/user/`,
  `docs/dev/` (architecture, storage, RPC/TUI, quota contract, API,
  testing, manual checklist, maintainer ops),
  `docs/specs/` (normative rules), `CHANGELOG.md`, `AGENTS.md`
