# 07 — Normative Rule Index (Oracle quick lookup)

How to read: each rule states a MUST/SHOULD/MAY. Status = Explicit (code,
test, or contract evidence) | Strong (repeated consistent behavior) |
Inferred (likely intent). Details live in the referenced sections.

## Routing and scope

- R-ARCH-V2-DELEGATES-V1 (Explicit, §01): V2 MUST delegate all model routing
  to the V1 loader fetch. No parallel router.
- R-ARCH-NO-BYPASS-SDK (Explicit, §01): OAuth models MUST use
  `aisdk:<google-sdk.js>`; API-key Gemini MUST NOT receive `options.fetch`.
- R-FETCH-SCOPE (Explicit, §05): only absolute http(s) GL model paths
  (`generateContent|streamGenerateContent|countTokens`) are routed;
  non-model GL throws; external origins are stripped and direct-fetched.

## Auth and accounts

- R-STATE-PACKED-REFRESH (Explicit, §04): use `parse/formatRefreshParts`;
  accept 2- and 3-segment forms.
- R-STATE-DELETE-USES-REPLACE (Explicit, §04): deletes MUST use
  `saveAccountsReplace`, never merging `saveAccounts`.
- Max 10 accounts; dedupe by refresh token or case-insensitive email
  preserving `addedAt` (Explicit, F1).
- Out-of-range/unknown account actions are messages, not writes (Explicit).

## Quota and rotation

- Cross-style quota fallback allowed ONLY for gemini family (Explicit).
- Claude family MUST always use `antigravity` style (Explicit).
- Soft-quota default 90 %; all-over with no wait budget → protection throw;
  otherwise wait capped by `max_rate_limit_wait_seconds` (Explicit).
- `Retry-After` respected with ≥ 2 s floor (Explicit).
- `googleSearch + functionDeclarations` MUST NOT be sent together; drop
  web_search with warn (Explicit, D-SEARCH-MUTEX).

## Thinking signatures (external-backed)

- R-SIG-PRESERVE (Explicit + External, §02/§06): echo received thought
  signatures back exactly; REQUIRED for Gemini 3 function calling (else 4xx,
  even at `minimal`).
- R-SIG-CLAUDE-STRIP (Explicit): strip ALL thinking blocks on Claude
  outgoing requests unless `keep_thinking` (fresh reasoning each turn).
- R-SIG-SENTINEL-LAST-RESORT (Strong): `skip_thought_signature_validator`
  MAY be used only on cache-miss/session-mismatch restart paths, never as
  the default signature.
- First functionCall keeps the signature; parallel-call extras stripped
  (Strong).

## Recovery and resilience

- `exchangeAntigravity` never throws (`failed{error}`); userinfo/project
  failures tolerated to degraded-but-continuable states (Explicit).
- `invalid_grant` MUST evict project cache + clear cached auth (V1;
  Explicit). V2 gap recorded in D-REFRESH-DUAL — do not widen.
- Session recovery gated by `session_recovery`; dedup in-flight errors;
  toasts never throw (Explicit).
- Update checks root-sessions-only; once per instance; child MUST NOT
  consume the flag; all failures silent-to-debug-log (Explicit,
  R-LIFECYCLE-ROOT-ONLY-CHILD).
- `normalizeFetchBody` MUST NOT consume the original Request (Explicit).
- OAuth callback state equality enforced (Explicit).
- `initializedFetch` memo cleared on auth change / mutation / loader
  failure; refresh queue stopped before re-creation (Strong).

## Architecture hygiene

- R-ARCH-PURE-TRANSFORM (Strong, §01): keep `transform/*` pure.
- `hooks/*` MUST NOT gain auth/quota/storage deps (SHOULD, §01).
- New code MUST use `getAntigravityHeaders()/getAntigravityVersion()/
  invalidatePackage()` over deprecated exports (Explicit).
- Fire-and-forget work MUST NOT reject into session creation (Strong).

## What the Oracle MUST leave unresolved

U1–U6 in §06. Do not invent quota numbers, endpoint-order optimality,
collision probabilities, cap precedence, per-family staging intent, or
`switch_on_first`/`pid_offset` semantics beyond the evidence.
