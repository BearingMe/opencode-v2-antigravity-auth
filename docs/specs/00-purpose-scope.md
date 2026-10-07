# 00 — Purpose and Scope

## What the project is

`opencode-v2-antigravity-auth` (`src/adapters/opencode/plugin.ts :: PLUGIN_ID`,
package `opencode-v2-antigravity-auth`) is an OpenCode V2 plugin that provides Google
Antigravity (Cloud Code Assist) OAuth authentication and request routing for
Gemini and Claude models. It intercepts `fetch()` calls aimed at
`generativelanguage.googleapis.com`, rewrites them into Antigravity
`v1internal:streamGenerateContent` / `generateContent` calls, manages a pool
of up to 10 Google accounts with per-account quota rotation, and repairs
thinking-signature / tool-result failures that would otherwise break sessions.
It registers a dedicated `antigravity` provider and OAuth integration; the
OpenCode `google` provider, integration, and credentials remain outside the
plugin's ownership.

Evidence: `src/adapters/opencode/plugin.ts :: setup` (V2 bridge),
`src/app/composition.ts :: executeAntigravityRequest` and
`src/app/execute-request.ts :: executeRequest` (single native request path),
`src/constants.ts` (identity/endpoints/headers),
`src/antigravity/oauth.ts :: authorizeAntigravity / exchangeAntigravity`.

## Problem solved

1. Ordinary Gemini API keys do not grant Antigravity quota pools or Claude
   models served through Google's Cloud Code Assist backend. The plugin
   supplies an Antigravity OAuth path for supported Gemini and Claude models.
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
  `src/plugin/token.ts`,
  `src/adapters/opencode/plugin.ts :: refreshOAuthCredential`).
- Dedicated provider/integration registration without reading or mutating
  OpenCode's Google provider or sign-in connection.
- Request interception, model resolution, payload transforms, and streaming
  (`src/modules/inference/pipeline.ts`, `src/modules/inference/transforms/*`,
  `src/modules/inference/signature-*`, `src/modules/inference/streaming/*`).
  `src/plugin/request.ts` and `src/plugin/request-helpers.ts` retain plugin
  request adaptation and helper APIs. The former `src/plugin/core/streaming/*`
  re-export paths were removed in Step 14; streaming policy is consumed from
  `modules/inference/`.
  The former `src/plugin/transform/*` re-export paths were removed in Step 14;
  transform policy is consumed from `modules/inference/`.
- Multi-account pool/selection and persistence policy
  (`src/modules/accounts/account-pool.ts`, `modules/accounts/selection/`,
  `modules/accounts/persistence/`), quota probing, fingerprints, project context
  (`src/plugin/quota.ts`, `fingerprint.ts`,
  `project.ts`, `refresh-queue.ts`; persistence through
  `src/adapters/filesystem/account-store.ts`).
- Recovery (in-flight turn repair + session-error hook), debug file/TUI
  logging split (`debug` vs `debug_tui`), version pinning,
  auto-update checker, `antigravity_accounts` tool, `/antigravity` dialog
  over the `AntigravityAccounts` RPC
  (`src/adapters/opencode/tui/index.ts`, `src/adapters/opencode/rpc.ts`).
  Removed surfaces stay removed: OAuth localhost server, CLI prompts,
  terminal UI, dedicated `google_search` tool — model-declared web search
  is still sanitized via the D-SEARCH-MUTEX guard.

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

- V2 bridge (current product path):
  `src/adapters/opencode/plugin.ts` default export
  `Plugin.define({id: "opencode-v2-antigravity-auth"})`.
  `src/v2-plugin.ts` remains a compatibility re-export. Routing lives in
  `src/app/composition.ts :: executeAntigravityRequest`, with the execution
  loop in `src/app/execute-request.ts`;
  `verifyAccountAccess` lives in `src/plugin/verify.ts`.
- AI-SDK shim: `src/adapters/opencode/google-sdk.ts :: createGoogle` re-export.
  `src/google-sdk.ts` remains a compatibility re-export. Models MUST
  point at `aisdk:<ANTIGRAVITY_SDK>` (the `./google-sdk.js` URL), never
  directly at `@ai-sdk/google`, so the `aisdk.hook("sdk")` bridge cannot be
  bypassed.

Status: Explicit.
