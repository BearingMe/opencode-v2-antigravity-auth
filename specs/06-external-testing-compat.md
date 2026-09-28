# 06 — External Contracts, Testing, Compatibility, Divergences, Unresolved

## External contracts (authoritative)

1. Thought signatures (Google). Responses MAY carry `thoughtSignature` in
   content parts; clients SHOULD echo them back exactly. Gemini 3 ENFORCES
   validation during function calling — missing signatures yield 4xx,
   including at `minimal` thinking level. `skip_thought_signature_validator`
   in the signature field is an officially supported bypass. Non-functionCall
   parts are recommended-but-unenforced (degraded quality if omitted).
   The plugin's cache → re-inject → sanitize → warmup → sentinel-escalation
   design directly implements this contract.
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
   include `ctx.aisdk.hook("sdk", cb)` (mutable: `sdk` after inspecting
   `model/package/options`), `ctx.provider/model/integration/tool/session/
   event` transforms. V2 API explicitly "may change before stable".
   - `Overview | OpenCode` (https://opencode.ai/v2/docs/build/plugins)
   - `Effect - opencode/plugin`
     (https://opencode.ai/v2/docs/build/plugins/effect)
   - `Plugins - OpenCode` (https://opencode.ai/docs/plugins)
   Relevance: the V2 bridge's reliance on `aisdk.hook("sdk")`,
   `provider.transform`, `model.transform`, `integration.transform`,
   `tool.transform`, `session.hook`, `event.subscribe` inherits beta
   instability — Oracle MUST allow for upstream shape changes.

## Testing guarantees (from analysis)

- `constants.test.ts`: Gemini-CLI header pin; static CLI headers regardless
  of model; antigravity UA format / platform alignment / never-linux
  (50× loops); `HeaderSet` optionality.
- `v2-plugin.test.ts`: plugin id/setup; 4 `normalizeFetchBody` behaviors;
  destination/path validation; 3 callback-parsing behaviors.
- `v2-plugin.accounts.test.ts`: delete-reselect, out-of-range no-write,
  list purity, blocked→disabled+URL, ok passthrough, error-without-disable.
- `v2-plugin.setup.test.ts`: full mocked V2 setup (registration, label,
  API-key passthrough, unauthenticated throw, authorize→persist, SDK route
  + `apiKey="antigravity-oauth"`, loader-missing/reject errors, decoded
  JSON body to routed fetch).
- `plugin/*` + subdirs: 20+ colocated Vitest files covering model
  resolution, schema sanitization, cross-model sanitizer, quota fallback
  (antigravity-first), rotation/hybrid selection, recovery,
  thinking-recovery, token, storage, cache, search, debug/logger —
  see `02-subsystems` and code refs (`request.test.ts`,
  `model-resolver.test.ts`, `rotation.test.ts`, `quota-fallback.test.ts`,
  `antigravity-first-fallback.test.ts`, `cross-model-integration.test.ts`).
- `hooks/auto-update-checker`: `checker.test.ts` (config/JSONC/entry
  forms), `index.test.ts` (prerelease skip, toast-only mode,
  once-per-instance, child ignore, local-dev warning; fake timers).
- Gaps: NO tests in `src/antigravity/`; NO dedicated `src/plugin.ts`
  unit tests (only indirect coverage).

## Compatibility

- Platforms: darwin/win32 modeled (`{darwin|win32}/{x64|arm64}`,
  `WINDOWS|MACOS` metadata); linux is deliberately never emitted in
  antigravity UAs. OAuth bind adapts (override env → OrbStack 127.0.0.1 →
  WSL/SSH 0.0.0.0 → 127.0.0.1). Version fallback `1.18.3` when the
  changelog scrape fails.
- Storage format V1..V4 with forward migrations; npm `dist-tags.latest`
  contract; `bun.lock`/`package.json` installer layout coupling in the
  update checker; OpenCode V2 beta API coupling above.
- Commands referenced: `bun install/run build/typecheck/test`,
  `vitest run [-t] [--watch]`, `test:coverage`, `test:e2e:*`. TS strict +
  `verbatimModuleSyntax` (`import type`), `.ts`-suffixed relative imports,
  named-only exports, no `any`/`ts-ignore`.

## Known divergences (normative for reviewers)

1. D-REFRESH-DUAL: V1 `refreshAccessToken` (skew, `invalid_grant`
   eviction, project-id preservation, cache store) vs V2
   `refreshOAuthCredential` (plain fetch, no skew/eviction). SHOULD be
   consolidated; edits MUST NOT widen the gap silently.
2. D-REFRESH-SEGMENTS: `oauth.exchangeAntigravity` writes 2-segment
   `refresh|project`; V2 authorize callback re-packs as
   `` `${result.refresh}|${result.projectId}` `` while ALSO calling
   `formatRefreshParts({refreshToken: result.refresh, ...})` for
   `currentAuth` — double-encoding hazard contained only by tolerant
   parsing. 需要 careful handling on any auth-format change.
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

## Unresolved questions (Oracle MUST NOT invent answers)

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

- Entries: `src/plugin.ts`, `src/v2-plugin.ts`, `src/constants.ts`,
  `src/google-sdk.ts`, `src/shims.d.ts`
- OAuth: `src/antigravity/oauth.ts`
- Update: `src/hooks/auto-update-checker/{index,checker,cache,constants,
  types,logging}.ts` + `checker.test.ts`, `index.test.ts`
- Core: `src/plugin/{auth,token,cache,request,request-helpers,accounts,
  rotation,quota,storage,fingerprint,project,refresh-queue,recovery,
  thinking-recovery,errors,debug,logger,logging-utils,server,search,cli,
  version,image-saver,types}.ts`
- Subdirs: `src/plugin/{cache,config/core:streaming,recovery,stores,
  transform,ui}/*`
- Tests: `src/constants.test.ts`, `src/v2-plugin.test.ts`,
  `src/v2-plugin.accounts.test.ts`, `src/v2-plugin.setup.test.ts` + 20+
  colocated `src/plugin/**/*.test.ts`
- Docs in repo: `README.md`, `docs/ARCHITECTURE.md`,
  `docs/ANTIGRAVITY_API_SPEC.md`, `CHANGELOG.md`, `AGENTS.md`
