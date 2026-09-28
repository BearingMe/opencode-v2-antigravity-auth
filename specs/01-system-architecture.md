# 01 — System Model and Architecture

## Major parts

| Part | Paths | Responsibility |
|---|---|---|
| Shared identity | `src/constants.ts`, `src/shims.d.ts`, `src/google-sdk.ts` | OAuth client id/secret/scopes/redirect, endpoint orders, header styles, version pinning, hardening prompts, search tuning |
| V1 engine | `src/plugin.ts` | Plugin factory, `auth.loader` fetch interceptor with rotation loop, login/logout flows, verification, warmup, toasts |
| V2 bridge | `src/v2-plugin.ts` | V2 `integration/provider/model/aisdk/tool/session/event` transforms; delegates routing to V1 loader/fetch |
| OAuth leaf | `src/antigravity/oauth.ts` | PKCE URL build + code exchange + `loadCodeAssist` project discovery |
| Auto-update | `src/hooks/auto-update-checker/*` | Root-session npm check, toast or pinned rewrite + cache invalidate |
| Core domains | `src/plugin/*` + `cache/config/core/recovery/stores/transform/ui` | Request transform, schema/thinking utils, accounts/rotation/quota/storage/fingerprint/project/refresh, recovery ×2, streaming, search, CLI/UI, server, debug/logger, version, images |

## Dependency direction (normative)

```text
v2-plugin.ts ──uses──> plugin.ts :: createAntigravityPlugin / verifyAccountAccess / dispose
plugin.ts ──uses──> plugin/{request,accounts,token,project,quota,config,cache,
                     recovery,refresh-queue,logger,rotation,version,server,
                     search,cli,debug,errors,request-helpers}
                   + antigravity/oauth + hooks/auto-update-checker
plugin/* ──uses──> constants.ts (identity/endpoints/headers)
                   + plugin/{auth,storage,logger,debug} kernels
transform/*, request-helpers ──should stay──> pure re: I/O
                   (except cache + config reads)
```

### Rule: R-ARCH-V2-DELEGATES-V1

**Requirement:** The V2 bridge MUST NOT reimplement request routing. All
Antigravity model traffic MUST flow
`aisdk.hook("sdk") → antigravityFetch → legacyPlugin.auth.loader.fetch`
(V1 interceptor).

**Rationale:** Single routing implementation; prevents quota/signature drift.

**Project evidence:**

- `src/v2-plugin.ts :: loadRoutedFetch`, `:: antigravityFetch`
- `src/v2-plugin.setup.test.ts` :: routes SDK JSON through legacy engine

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
- `antigravity_accounts` + `google_search` tools
  (`src/v2-plugin.ts :: manageAccounts`, `src/plugin/search.ts`).
- `AuthMenuAction/AccountAction` UI actions (`src/plugin/ui/auth-menu.ts`).

## Forbidden relationships

- `src/hooks/*` MUST NOT depend on auth/quota/accounts/storage/fingerprint/
  project. It only uses `plugin/debug.ts :: debugLogToFile`. (Observed,
  promote to SHOULD.)
- External-origin fetches MUST NOT receive `x-goog-api-key` or
  `authorization` headers (see R-FETCH-SCOPE).
- `transform/*` MUST NOT import `accounts.ts` / `storage.ts` (inferred;
  no current violation reported).
