# 00 — Purpose and Scope

## What the project is

`opencode-antigravity-auth` is an OpenCode plugin that provides Google
Antigravity (Cloud Code Assist) OAuth authentication and request routing for
Gemini and Claude models. It intercepts `fetch()` calls aimed at
`generativelanguage.googleapis.com`, rewrites them into Antigravity
`v1internal:streamGenerateContent` / `generateContent` calls, manages a pool
of up to 10 Google accounts with per-account quota rotation, and repairs
thinking-signature / tool-result failures that would otherwise break sessions.

Evidence: `src/plugin.ts :: createAntigravityPlugin` (V1 engine, ~3411 lines),
`src/v2-plugin.ts :: setup` (V2 bridge, 707 lines),
`src/constants.ts` (identity/endpoints/headers),
`src/antigravity/oauth.ts :: authorizeAntigravity / exchangeAntigravity`.

## Problem solved

1. Ordinary Gemini API keys do not grant Antigravity quota pools or Claude
   models served through Google's Cloud Code Assist backend. The plugin
   supplies an OAuth path with two header styles (dual quota pools).
2. Gemini 3 / Claude thinking models require exact round-tripping of encrypted
   thought signatures during function calling; OpenCode message history does
   not preserve them by default. The plugin caches, re-injects, sanitizes, and
   recovers signatures.
3. Google rate limits (429/500/503/529) and per-model capacity exhaustion
   require multi-account rotation, backoff, soft-quota protection, and
   verification handling rather than hard failure.

## Boundaries

In scope:

- OAuth PKCE authorize + code exchange + refresh (`src/antigravity/oauth.ts`,
  `src/plugin/token.ts`, `src/v2-plugin.ts :: refreshOAuthCredential`).
- Request interception, model resolution, payload transforms, streaming
  transform (`src/plugin/request.ts`, `src/plugin/transform/*`,
  `src/plugin/request-helpers.ts`, `src/plugin/core/streaming/*`).
- Multi-account pool, rotation, quota probing, fingerprints, project context
  (`src/plugin/accounts.ts`, `rotation.ts`, `quota.ts`, `fingerprint.ts`,
  `project.ts`, `storage.ts`, `refresh-queue.ts`).
- Recovery (in-flight turn repair + session-error hook + filesystem storage
  ops), debug/TUI logging, OAuth localhost server, search and account tools,
  CLI prompts, version pinning, auto-update checker.

Non-goals:

- The plugin is not a general Google API client. Non-model
  `generativelanguage.googleapis.com` paths MUST be rejected; external origins
  MUST NOT receive OAuth credentials (see Rule R-FETCH-SCOPE).
- It is not a package manager. The auto-update checker only rewrites the
  plugin pin and invalidates the install cache; it never installs packages
  itself.
- It does not implement the Antigravity backend. Endpoint order, quota
  semantics, and signature validation are inherited from Google and mirrored
  (see `06-external`).

## Entry points (normative)

- V1 legacy engine (REMOVED 2026-09-28, Task 2): `src/plugin.ts`
  (`createAntigravityPlugin`, `AntigravityCLIOAuthPlugin`,
  `GoogleOAuthPlugin`), `cli.ts`, `server.ts`, `ui/`, and the
  `@opencode-ai/plugin` dependency were deleted. `verifyAccountAccess`
  lives in `src/plugin/verify.ts`.
- V2 bridge (current OpenCode V2 product path):
  `src/v2-plugin.ts` default export `Plugin.define({id:
  "opencode-antigravity-auth"})`.
- AI-SDK shim: `src/google-sdk.ts :: createGoogle` re-export. Models MUST
  point at `aisdk:<ANTIGRAVITY_SDK>` (the `./google-sdk.js` URL), never
  directly at `@ai-sdk/google`, so the `aisdk.hook("sdk")` bridge cannot be
  bypassed.

Status: Explicit.
