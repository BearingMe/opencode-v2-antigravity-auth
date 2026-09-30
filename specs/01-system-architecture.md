# 01 — System Model and Architecture

## Major parts

| Part | Paths | Responsibility |
|---|---|---|
| Shared identity | `src/constants.ts`, `src/shims.d.ts`, `src/google-sdk.ts` | OAuth client id/secret/scopes/redirect, endpoint orders, header styles, version pinning, hardening prompts, search tuning |
| Native engine | `src/plugin/engine.ts` | Request execution + rotation loop (ported from V1, Task 1; sole router since Task 2), unified OAuth refresh, thinking warmup |
| V2 bridge | `src/v2-plugin.ts` | V2 `integration/provider/model/aisdk/tool/session/event` transforms; routes via the native engine |
| OAuth leaf | `src/antigravity/oauth.ts` | PKCE URL build + code exchange + `loadCodeAssist` project discovery |
| Auto-update | `src/hooks/auto-update-checker/*` | Root-session npm check, toast or pinned rewrite + cache invalidate |
| Core domains | `src/plugin/*` + `cache/config/core/recovery/stores/transform` | Request transform, schema/thinking utils, accounts/rotation/quota/storage/fingerprint/project/refresh, recovery ×2, streaming, debug/logger, version, images (`search`, `cli`, `ui/`, `server` removed Tasks 2–3) |

## Dependency direction (normative)

```text
v2-plugin.ts ──uses──> plugin/engine.ts :: executeAntigravityRequest
                       (sole router) + plugin/{request,accounts,token,
                       project,quota,config,cache,recovery,refresh-queue,
                       logger,rotation,version,debug,request-helpers,
                       verify,verification,account-service}
                    + antigravity/oauth + hooks/auto-update-checker
plugin/* ──uses──> constants.ts (identity/endpoints/headers)
                   + plugin/{auth,storage,logger,debug} kernels
transform/*, request-helpers ──should stay──> pure re: I/O
                   (except cache + config reads)
```
(Historical diagram referencing `plugin.ts :: createAntigravityPlugin` was
retired with the V1 deletion 2026-09-28, Task 2.)

### Rule: R-ARCH-V2-DELEGATES-V1 (retargeted 2026-09-28, Task 2)

**Requirement:** V2 MUST route ALL Antigravity model traffic through the
native engine: `aisdk.hook("sdk") → antigravityFetch →
executeAntigravityRequest` (`src/plugin/engine.ts`, ported from the V1
hot-path loop: rotation, soft-quota gate, Retry-After/RetryInfo, thinking
warmup, toasts, `invalid_grant` eviction, gemini-only dual-pool fallback).
The V1 harness is deleted (`src/plugin.ts`, `cli.ts`, `server.ts`, `ui/`,
`@opencode-ai/plugin` removed; `verifyAccountAccess` moved to
`src/plugin/verify.ts`). No parallel router, no legacy fallback;
`OPENCODE_ANTIGRAVITY_V2_LEGACY_FETCH` is retired.

**Rationale:** Single routing implementation; prevents quota/signature drift.

**Project evidence:**

- `src/plugin/engine.ts :: executeAntigravityRequest`,
  `:: refreshOAuthCredentialUnified`, `:: isNativeEngineEnabled`
- `src/v2-plugin.ts :: loadRoutedFetch`, `:: antigravityFetch`
- `src/plugin/engine.test.ts` (13 parity tests),
  `src/v2-plugin.setup.test.ts` :: routes SDK JSON through native engine

**Status:** Explicit.

### Rule: R-ARCH-NO-BYPASS-SDK

**Requirement:** Every `antigravity-*` model and every OAuth-routed `gemini-*`
model MUST set `package = aisdk:<ANTIGRAVITY_SDK>` where `ANTIGRAVITY_SDK`
is `new URL("./google-sdk.js", import.meta.url).href`. Plain `gemini-*`
models with a non-OAuth (API-key) connection MUST keep their configured
route and MUST NOT receive `options.fetch`.

**Project evidence:**

- `src/v2-plugin.ts` provider/model transforms; `src/google-sdk.ts`
- `src/v2-plugin.setup.test.ts` :: API-key gemini untouched; unauthenticated
  antigravity throws

**Status:** Explicit.

### Rule: R-ARCH-PURE-TRANSFORM

**Requirement:** `src/plugin/transform/*` SHOULD be pure functions of
`(payload, model, config)`. Network, filesystem, and account mutation belong
in `request.ts`, `accounts.ts`, `storage.ts`, `quota.ts`, `project.ts`.

**Status:** Strong (consistent implementation; cross-module report).

## Extension points

- `HeaderStyle = "antigravity" | "gemini-cli"` + per-model `quotaPreference`
  (`src/constants.ts :: getRandomizedHeaders`,
  `src/plugin/transform/model-resolver.ts :: resolveModelWithTier`).
- `account_selection_strategy = sticky | round-robin | hybrid` (default
  `hybrid`) + health/token-bucket trackers (`src/plugin/rotation.ts`).
- `TransformContext/Result`, `StreamingCallbacks/SignatureStore`
  (`src/plugin/transform/types.ts`, `src/plugin/core/streaming/types.ts`).
- `antigravity_accounts` tool (`src/v2-plugin.ts :: manageAccounts`,
  backed by `src/plugin/account-service.ts`).
  (`google_search` tool + `src/plugin/search.ts` REMOVED 2026-09-28, Task 3;
  the D-SEARCH-MUTEX guard in `transform/gemini.ts` stays.)
- Production account UI (`src/tui.ts :: /antigravity` dialog,
  `src/rpc.ts :: AntigravityAccounts` with `list/quota/verify/mutate/
  deleteAll/ping`) — the interactive management surface sharing the
  `account-service.ts` backend with the legacy tool. The `/antigravity-smoke`
  command and `ANTIGRAVITY_RPC_SMOKE_OK` ping were removed with the smoke
  phase; `ping` now returns `ANTIGRAVITY_RPC_ACCOUNTS_OK`.
- (Historical, REMOVED Task 2) `AuthMenuAction/AccountAction` UI actions
  (`src/plugin/ui/auth-menu.ts`), `cli.ts` readline prompts, `server.ts`
  localhost listener. V2 replacements: form-less `google-oauth` integration
  method (no declared fields, prompt-free and Skip-free; one account per
  login run) + `antigravity_accounts` tool + `/antigravity` dialog +
  manual code/URL paste callback.

## Forbidden relationships

- `src/hooks/*` MUST NOT depend on auth/quota/accounts/storage/fingerprint/
  project. It only uses `plugin/debug.ts :: debugLogToFile`. (Observed,
  promote to SHOULD.)
- External-origin fetches MUST NOT receive `x-goog-api-key` or
  `authorization` headers (see R-FETCH-SCOPE).
- `transform/*` MUST NOT import `accounts.ts` / `storage.ts` (inferred;
  no current violation reported).
