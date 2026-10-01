# Antigravity API (observed)

Reference for the upstream wire format the plugin mirrors. The plugin does
not implement the backend — endpoint order, quota semantics, and signature
validation are inherited from Google. Dated observations below; re-verify
against live traffic before treating any field as stable.

## Endpoints

| Environment        | URL                                                    | Status (last observed 2025-12-13)                                           |
| ------------------ | ------------------------------------------------------ | --------------------------------------------------------------------------- |
| Daily (sandbox)    | `https://daily-cloudcode-pa.sandbox.googleapis.com`    | Active                                                                      |
| Production         | `https://cloudcode-pa.googleapis.com`                  | Active                                                                      |
| Autopush (sandbox) | `https://autopush-cloudcode-pa.sandbox.googleapis.com` | Unavailable — removed from the plugin; do not restore without live evidence |

Request fallback order is daily → prod. `loadCodeAssist` project discovery
probes load endpoints plus fallbacks.

| Action           | Path                                        |
| ---------------- | ------------------------------------------- |
| Generate content | `/v1internal:generateContent`               |
| Stream generate  | `/v1internal:streamGenerateContent?alt=sse` |
| Load code assist | `/v1internal:loadCodeAssist`                |
| Onboard user     | `/v1internal:onboardUser`                   |

## Auth

OAuth 2.0 PKCE (S256) via `https://accounts.google.com/o/oauth2/v2/auth`
and `https://oauth2.googleapis.com/token`, with the confidential client
secret sent at exchange (CLI-spoofing behavior, not the public-client PKCE
norm). Scopes: `cloud-platform`, `userinfo.email`, `userinfo.profile`,
`cclog`, `experimentsandconfigs`. The plugin secret is committed in
`src/constants.ts` and duplicated in `scripts/check-quota.mjs` (accepted
risk — rotate both; scripts should one day import from a single source).

## Request envelope

```json
{
  "project": "{project_id}",
  "model": "{model_id}",
  "request": {
    "contents": [...],
    "generationConfig": {},
    "systemInstruction": { "parts": [{ "text": "..." }] },
    "tools": [{ "functionDeclarations": [...] }]
  },
  "userAgent": "antigravity",
  "requestId": "{unique_id}"
}
```

- `contents` must be Gemini-style (`role: user|model`, `parts[]`) —
  Anthropic-style `messages` is not accepted.
- `systemInstruction` must be an object with `parts`, not a plain string.
- Tools use `functionDeclarations[]` with JSON Schema parameters. The plugin
  sanitizes schemas (allowlist; `const` → `enum`, `$ref`/`$defs` handling,
  placeholder for empty objects) because the backend rejects unsupported
  keywords.
- `googleSearch: {}` and `functionDeclarations` are mutually exclusive on
  Gemini — the plugin drops `web_search` with a warning when functions exist
  (D-SEARCH-MUTEX). Never "fix" this by sending both.

## Header contract (current)

- OAuth `Authorization: Bearer` on Antigravity calls; the SDK's placeholder
  `x-goog-api-key` is stripped before forwarding.
- `x-goog-user-project` is stripped for **all** header styles.
- Content requests must **not** send `X-Goog-QuotaUser`, `X-Client-Device-Id`,
  `X-Goog-Api-Client`, or `Client-Metadata`. Fingerprints contribute
  `User-Agent` only (`buildFingerprintHeaders`, applied on the Antigravity
  path).
- Two header styles exist for the dual quota pools: `antigravity`
  (fingerprint UA) and `gemini-cli` (nodejs-client UA). Cross-style quota
  fallback is allowed for the `gemini` family only; Claude always uses
  `antigravity`.
- Linux never appears in Antigravity UAs (Linux masquerades as macOS);
  `ideType` is `ANTIGRAVITY`, platform is `WINDOWS|MACOS`, plugin type
  `GEMINI`. Runtime Antigravity version resolves dynamically with a
  hardcoded last-resort fallback.

Older snapshots showing the removed headers or the Autopush endpoint are
historical — the rules above describe current behavior.

## Thought signatures (upstream, external)

- Responses may carry `thoughtSignature` in content parts; clients should
  echo them back exactly. Gemini 3 enforces validation during function
  calling — missing signatures yield 400, including at `minimal` thinking
  level. Parallel calls carry the signature on the FIRST `functionCall`
  only; replies must order all calls before all responses
  (`FC1+sig, FC2, FR1, FR2` — interleaving is a 400).
- `skip_thought_signature_validator` is an officially supported last-resort
  bypass (degrades performance). The plugin uses it only on
  cache-miss/session-mismatch restart paths, never as the default.
- References: Google "Thought signatures" docs (AI for Developers +
  Enterprise Agent Platform), Gemini 3 developer/thinking guides. Re-verified
  2026-09-29 for parallel ordering, empty-text streaming parts, and the
  Gemini 3 vs 2.5 strictness split.
