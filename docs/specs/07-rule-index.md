# 07 — Normative Rule Index

How to read: each rule states a MUST/SHOULD/MAY. Status = Explicit (code,
test, or contract evidence) | Strong (repeated consistent behavior) |
Inferred (likely intent). Details live in the referenced sections.

## Routing and scope

- R-ARCH-V2-DELEGATES-V1 (Explicit, §01): V2 MUST route
  all model traffic through the native engine (`src/plugin/engine.ts`).
  No parallel router, no legacy fallback. The name is historical; the
  requirement is the current native engine.
- R-ARCH-NO-BYPASS-SDK (Explicit, §01): OAuth models MUST use
  `aisdk:<google-sdk.js>`; API-key Gemini MUST NOT receive `options.fetch`.
- R-FETCH-SCOPE (Explicit, §05): only absolute http(s) GL model paths
  (`generateContent|streamGenerateContent|countTokens`) are routed;
  non-model GL throws; external origins are stripped and direct-fetched.

## Auth and accounts

- R-STATE-PACKED-REFRESH (Explicit, §04): use `parse/formatRefreshParts`;
  accept 2- and 3-segment forms.
- R-STATE-DELETE-USES-REPLACE (Explicit, §04): deletes MUST go through
  single-lock `updateAccounts` replace-transactions (with same-transaction
  tombstoning), never merging `saveAccounts`.
- Max 10 accounts; dedupe by refresh token or case-insensitive email
  preserving `addedAt` and the durable id (Explicit, F1).
- Out-of-range/unknown account actions are messages, not writes (Explicit).
- RPC/TUI mutations address durable ids only, never indices; unknown ids
  fail closed (Explicit, §02).
- RPC outputs MUST be credential-free and MUST omit absent optionals rather
  than sending explicit `undefined` (Explicit, §02).
- Deletes MUST tombstone the removed identity in the same `updateAccounts`
  transaction; tombstones are bounded and generation-aware (Explicit,
  §02/§04).

## Quota and rotation

- Cross-style quota fallback allowed ONLY for gemini family (Explicit).
- Claude family MUST always use `antigravity` style (Explicit).
- Soft-quota default 90 %; all-over with no wait budget → protection throw;
  otherwise wait capped by `max_rate_limit_wait_seconds` (Explicit).
- `Retry-After` respected with ≥ 2 s floor (Explicit).
- `googleSearch + functionDeclarations` MUST NOT be sent together; drop
  web_search with warn (Explicit, D-SEARCH-MUTEX).
- Quota `0` means genuinely exhausted; unknown (missing, non-finite, or
  out-of-range fractions) MUST render as `null`/unknown, never `0` or
  clamped. Failed refreshes keep the last good cached reading (Explicit,
  §02/quota-contract).

## Thinking signatures (external-backed)

- R-SIG-PRESERVE (Explicit + External, §02/§06): echo received thought
  signatures back exactly; REQUIRED for Gemini 3 function calling (else 4xx,
  even at `minimal`).
- R-SIG-CLAUDE-STRIP (Explicit): strip ALL thinking blocks on Claude
  outgoing requests unless `keep_thinking` (fresh reasoning each turn).
- R-SIG-SENTINEL-LAST-RESORT (Strong): `skip_thought_signature_validator`
  MAY be used only on cache-miss/session-mismatch restart paths, never as
  the default signature.
- First functionCall keeps the signature; parallel-call extras stripped;
  replies MUST order all calls before all responses (`FC1+sig, FC2, FR1,
FR2` — interleaving is a 400) (Strong + External).

## Recovery and resilience

- `exchangeAntigravity` never throws (`failed{error}`); userinfo/project
  failures tolerated to degraded-but-continuable states (Explicit).
- `invalid_grant` MUST evict project cache + clear cached auth (Explicit;
  single unified refresh path, D-REFRESH-DUAL).
- Session recovery gated by `session_recovery`; dedup in-flight errors;
  toasts never throw; recovery-success toast honors `quiet_mode` and
  `toast_scope=root_only` with explicit session ID (Explicit).
  The `session.retry` hook is provider-agnostic: recoverable-pattern
  errors in NON-Google sessions also trigger recovery (D-RETRY-GLOBAL) —
  do not assume Google-only.
- Child tracker is duplicate-safe: re-remembering a tracked id at
  capacity MUST NOT evict a different child (Explicit).
- Fetch-path toasts are fail-open: unknown sessions classify as ROOT
  (session ID unavailable at the fetch call site), so
  `toast_scope=root_only` suppression applies to update checks and
  recovery toasts, not fetch-path toasts (Accepted exception to
  R-LIFECYCLE-ROOT-ONLY-CHILD).
- Update checks root-sessions-only; once per instance; child MUST NOT
  consume the flag; all failures silent-to-debug-log (Explicit,
  R-LIFECYCLE-ROOT-ONLY-CHILD).
- `normalizeFetchBody` MUST NOT consume the original Request (Explicit).
- OAuth callback state equality enforced (Explicit).
- Native manager reset on auth change / mutation; refresh queue stopped
  before re-creation (Strong).

## Architecture hygiene

- R-ARCH-PURE-TRANSFORM (Strong, §01): keep `transform/*` pure.
- `hooks/*` MUST NOT gain auth/quota/storage deps (SHOULD, §01).
- New code MUST use `getAntigravityHeaders()/getAntigravityVersion()/
invalidatePackage()` over deprecated exports (Explicit).
- `x-goog-user-project` MUST be stripped from OAuth requests; content
  requests MUST NOT send QuotaUser/Device-Id/Api-Client/Client-Metadata
  (Explicit, §06 items 9–10).
- `debug` gates file logging only; `debug_tui` gates TUI logging only
  (Explicit, §06 item 10).
- Gemini `functionCall` signature validity + empty-part stripping + cloned
  fallback responses are REQUIRED (Explicit, §06 item 11).
- Fire-and-forget work MUST NOT reject into session creation (Strong).
- Runtime (non-test) source imports MUST resolve under BOTH
  `tsconfig.json` and `tsconfig.build.json`: use `.js`-suffixed or
  extensionless relative imports — `.ts`-suffixed imports pass `typecheck`
  but fail `bun run build` with TS5097 (Explicit).

## What to leave unresolved

U1–U6 in §06. Do not invent quota numbers, endpoint-order optimality,
collision probabilities, cap precedence, per-family staging intent, or
`switch_on_first`/`pid_offset` semantics beyond the evidence.
