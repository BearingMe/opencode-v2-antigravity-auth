# 01 — System Model and Architecture

## Major parts

| Part            | Paths                                                                                              | Responsibility                                                                                                                                                                    |
| --------------- | -------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Shared identity | `src/adapters/antigravity/constants.ts`, `src/constants.ts`, `src/shims.d.ts`, `src/google-sdk.ts` | OAuth client id/secret/scopes/redirect, endpoint orders, Antigravity headers, version pinning, hardening prompts, search tuning; `src/constants.ts` is a compatibility facade     |
| Native engine   | `src/plugin/engine.ts`                                                                             | Request execution + rotation loop (sole router), unified OAuth refresh, thinking warmup                                                                                           |
| V2 bridge       | `src/v2-plugin.ts`                                                                                 | V2 `integration/provider/model/aisdk/tool/session/event` transforms; routes via the native engine                                                                                 |
| OAuth facade    | `src/antigravity/oauth.ts`                                                                         | Compatibility API for authorize/exchange; delegates endpoint communication to Antigravity adapters                                                                                |
| Vendor clients  | `src/adapters/antigravity/*`                                                                       | OAuth/token/project/quota/verification HTTP, headers, endpoint order, timeouts, and response wire parsing                                                                         |
| Auto-update     | `src/hooks/auto-update-checker/*`                                                                  | Root-session npm check, toast or pinned rewrite + cache invalidate                                                                                                                |
| Core domains    | `src/modules/*` + `src/plugin/*` + `cache/config/core/stores/transform`                            | Account policy, request transforms, schema/thinking utils, quota/storage adapters, fingerprint/project/refresh, session-recovery policy, streaming, debug/logger, version, images |

## Dependency direction (normative)

```text
v2-plugin.ts ──uses──> plugin/engine.ts :: executeAntigravityRequest
                       (sole router) + plugin/{request,accounts,token,
                       project,quota,config,cache,recovery,refresh-queue,
                       logger,rotation,version,debug,request-helpers,
                       verify,verification,account-service}
                     + antigravity/oauth + hooks/auto-update-checker
plugin account callers ──ports──> adapters/antigravity/*
plugin/* ──uses──> constants.ts (identity/endpoints/headers)
                   + plugin/{auth,storage,logger,debug} kernels
plugin/{accounts,rotation}.ts ──compatibility facades──> modules/accounts/
transform/*, request-helpers ──should stay──> pure re: I/O
                   (except cache + config reads)
```

### Rule: R-ARCH-V2-DELEGATES-V1

**Requirement:** V2 MUST route ALL Antigravity model traffic through the
native engine: `aisdk.hook("sdk") → antigravityFetch →
executeAntigravityRequest` (`src/plugin/engine.ts`: rotation,
soft-quota gate, Retry-After/RetryInfo, thinking
warmup, toasts, and `invalid_grant` eviction).
No parallel router, no legacy fallback.

**Rationale:** Single routing implementation; prevents quota/signature drift.

**Project evidence:**

- `src/plugin/engine.ts :: executeAntigravityRequest`,
  `:: refreshOAuthCredentialUnified`, `:: isNativeEngineEnabled`
- `src/v2-plugin.ts :: loadRoutedFetch`, `:: antigravityFetch`
- `src/plugin/engine.test.ts`,
  `src/v2-plugin.setup.test.ts` :: routes SDK JSON through native engine

**Status:** Explicit.

### Rule: R-ARCH-ANTIGRAVITY-AUTH-ISOLATION

**Requirement:** Antigravity MUST register its own `antigravity` provider,
integration, and `antigravity-oauth` method. It MUST NOT update, remove, read,
or depend on OpenCode's `google` integration, Google provider, or Google
connection.

**Rationale:** Antigravity account selection and OAuth credentials are isolated
from ordinary Google API-key and OAuth connections.

**Project evidence:** `src/v2-plugin.ts` integration/provider transforms and
`src/v2-plugin.setup.test.ts` standalone registration coverage.

**Status:** Explicit.

### Rule: R-ARCH-NO-BYPASS-SDK

**Requirement:** Every model registered by the `antigravity` provider MUST set
`package = aisdk:<ANTIGRAVITY_SDK>` where `ANTIGRAVITY_SDK` is
`new URL("./google-sdk.js", import.meta.url).href`. The Google provider is
outside this plugin's routing scope and MUST retain its configured route.

**Project evidence:**

- `src/v2-plugin.ts` provider/model transforms; `src/google-sdk.ts`
- `src/v2-plugin.setup.test.ts` :: Google SDK route untouched; unauthenticated
  Antigravity throws

**Status:** Explicit.

### Rule: R-ARCH-PURE-TRANSFORM

**Requirement:** `src/modules/inference/transforms/*` SHOULD be pure functions of
`(payload, model, config)`. Network and filesystem work belong in adapters;
account policy belongs in `src/modules/accounts/`, with plugin files retained
only as compatibility boundaries during migration. Environment reads and
diagnostics are supplied or handled by the request boundary.

**Status:** Strong (consistent implementation; cross-module report).

## Extension points

- Dedicated `antigravity` provider and OAuth integration; the OpenCode `google`
  provider and integration are not modified. Antigravity traffic uses the
  native engine (`src/plugin/engine.ts`, `src/v2-plugin.ts`).
- `account_selection_strategy = sticky | round-robin | hybrid` (default
  `hybrid`) + pool policy in `src/modules/accounts/account-pool.ts` and health,
  token-bucket, and backoff policy in `src/modules/accounts/selection/`.
  `src/plugin/accounts.ts` and `src/plugin/rotation.ts` remain compatibility
  facades for existing callers.
- `TransformContext/Result`, request/response pipelines, signature policy, and
  `StreamingCallbacks` live in `src/modules/inference/`; plugin request and
  streaming paths are compatibility adapters.
- `antigravity_accounts` tool (`src/v2-plugin.ts :: manageAccounts`,
  backed by `src/modules/accounts/account-admin.ts` through the compatibility
  facade in `src/plugin/account-service.ts`).
  No search tool is registered; the D-SEARCH-MUTEX guard in
  `src/modules/inference/transforms/gemini.ts` keeps the D-SEARCH-MUTEX guard
  for SDK-supplied search tools.
- Production account UI (`src/tui.ts :: /antigravity` dialog,
  `src/rpc.ts :: AntigravityAccounts` with `list/quota/verify/mutate/
deleteAll/ping`) — the interactive management surface sharing the
  account-admin use cases with the legacy tool. `ping` returns
  `ANTIGRAVITY_RPC_ACCOUNTS_OK`.
- V2 login surface: the standalone `antigravity` integration with its
  `antigravity-oauth` method and required
  pre-authorization Add/reconnect selection (one account per command;
  native Ctrl+C cancellation) +
  `antigravity_accounts` tool + `/antigravity` dialog +
  manual code/URL paste callback.

## Forbidden relationships

- `src/hooks/*` MUST NOT depend on auth/quota/accounts/storage/fingerprint/
  project. It only uses `plugin/debug.ts :: debugLogToFile`. (Observed,
  promote to SHOULD.)
- External-origin fetches MUST NOT receive `x-goog-api-key` or
  `authorization` headers (see R-FETCH-SCOPE).
- `transform/*` MUST NOT import `accounts.ts` / `storage.ts` (inferred;
  no current violation reported).
