# 01 — System Model and Architecture

## Major parts

| Part            | Paths                                                                                                                | Responsibility                                                                                                                                                                |
| --------------- | -------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Shared identity | `src/adapters/antigravity/constants.ts`, `src/constants.ts`, `src/shims.d.ts`, `src/adapters/opencode/google-sdk.ts` | OAuth client id/secret/scopes/redirect, endpoint orders, Antigravity headers, version pinning, hardening prompts, search tuning; `src/constants.ts` is a compatibility facade |
| Application     | `src/app/composition.ts`, `src/app/execute-request.ts`                                                               | Selects adapters and runs the single request execution + rotation loop                                                                                                        |
| OpenCode V2     | `src/adapters/opencode/plugin.ts`, `src/adapters/opencode/{rpc,tui,config,hooks}/`                                   | V2 registration, host lifecycle, RPC/TUI, config, update hook, and SDK routing integration                                                                                    |
| Compatibility   | `src/v2-plugin.ts`, `src/tui.ts`, `src/rpc.ts`, `src/google-sdk.ts`                                                  | Thin package/source entrypoint re-exports; implementation remains under `adapters/opencode/`                                                                                  |
| OAuth facade    | `src/adapters/opencode/oauth.ts`, `src/adapters/antigravity/oauth.ts`                                                | Preserves the package authorize/exchange API and binds provider OAuth operations to OpenCode logging                                                                          |
| Vendor clients  | `src/adapters/antigravity/*`                                                                                         | OAuth/token/project/quota/verification HTTP, headers, endpoint order, timeouts, and response wire parsing                                                                     |
| Auto-update     | `src/adapters/opencode/hooks/auto-update-checker/*`                                                                  | Root-session npm check, toast or pinned rewrite + cache invalidate                                                                                                            |
| Core domains    | `src/modules/{accounts,inference,session-recovery}/*`, `src/adapters/{antigravity,filesystem}/*`, `src/plugin/*`     | Account, inference, and recovery policy; vendor and filesystem adapters; remaining plugin request/auth composition; OpenCode debug and log delivery                           |

## Dependency direction (normative)

```text
adapters/opencode/plugin.ts ──uses──> app/composition.ts
                                      ──calls──> app/execute-request.ts
                                      (sole request path)
adapters/opencode/tui ──RPC──> adapters/opencode/rpc
app/composition.ts ──selects──> account, inference, Antigravity transport,
                                OpenCode host, and filesystem adapters
app/execute-request.ts ──coordinates──> account pool + inference policies
adapters/opencode/* ──composes──> modules/* + vendor/filesystem adapters
modules/inference/transforms/* ──should stay──> pure re: I/O
plugin request boundary ──supplies──> config, environment, and diagnostics
```

### Rule: R-ARCH-V2-DELEGATES-V1

**Requirement:** V2 MUST route ALL Antigravity model traffic through the
single application execution path: `aisdk.hook("sdk") → antigravityFetch →
app/composition.ts :: executeAntigravityRequest →
app/execute-request.ts :: executeRequest` (rotation, soft-quota gate,
Retry-After/RetryInfo, thinking warmup, toasts, and `invalid_grant` eviction).
No parallel router, no legacy fallback.

**Rationale:** Single routing implementation; prevents quota/signature drift.

**Project evidence:**

- `src/app/composition.ts :: executeAntigravityRequest`,
  `:: refreshOAuthCredentialUnified`
- `src/app/execute-request.ts :: isNativeEngineEnabled`
- `src/adapters/opencode/plugin.ts :: antigravityFetch`
- `src/app/execute-request.test.ts`,
  `src/adapters/opencode/plugin.setup.test.ts` :: routes SDK JSON through native engine

**Status:** Explicit.

### Rule: R-ARCH-ANTIGRAVITY-AUTH-ISOLATION

**Requirement:** Antigravity MUST register its own `antigravity` provider,
integration, and `antigravity-oauth` method. It MUST NOT update, remove, read,
or depend on OpenCode's `google` integration, Google provider, or Google
connection.

**Rationale:** Antigravity account selection and OAuth credentials are isolated
from ordinary Google API-key and OAuth connections.

**Project evidence:** `src/adapters/opencode/plugin.ts` integration/provider
transforms and `src/adapters/opencode/plugin.setup.test.ts` standalone
registration coverage.

**Status:** Explicit.

### Rule: R-ARCH-NO-BYPASS-SDK

**Requirement:** Every model registered by the `antigravity` provider MUST set
`package = aisdk:<ANTIGRAVITY_SDK>` where `ANTIGRAVITY_SDK` is
`new URL("./google-sdk.js", import.meta.url).href`. The Google provider is
outside this plugin's routing scope and MUST retain its configured route.

**Project evidence:**

- `src/adapters/opencode/plugin.ts` provider/model transforms;
  `src/adapters/opencode/google-sdk.ts`
- `src/adapters/opencode/plugin.setup.test.ts` :: Google SDK route untouched; unauthenticated
  Antigravity throws

**Status:** Explicit.

### Rule: R-ARCH-PURE-TRANSFORM

**Requirement:** `src/modules/inference/transforms/*` SHOULD be pure functions
of `(payload, model, config)`. Network and filesystem work belong in adapters;
account policy belongs in `src/modules/accounts/`. Environment reads and
diagnostics are supplied or handled by the request boundary.

**Status:** Strong (consistent implementation; cross-module report).

## Extension points

- Dedicated `antigravity` provider and OAuth integration; the OpenCode `google`
  provider and integration are not modified. Antigravity traffic uses the
  application request path (`src/app/composition.ts`,
  `src/app/execute-request.ts`, `src/adapters/opencode/plugin.ts`).
- `account_selection_strategy = sticky | round-robin | hybrid` (default
  `hybrid`) + pool policy in `src/modules/accounts/account-pool.ts` and health,
  token-bucket, and backoff policy in `src/modules/accounts/selection/`.
  `src/adapters/opencode/account-pool.ts` supplies filesystem and host-specific
  dependencies; health, token-bucket, and backoff policy remain in the module.
- `TransformContext/Result`, request/response pipelines, signature policy, and
  `StreamingCallbacks` live in `src/modules/inference/`; plugin request and
  streaming paths are compatibility adapters.
- `antigravity_accounts` tool (`src/adapters/opencode/plugin.ts :: manageAccounts`,
  backed by `src/modules/accounts/account-admin.ts` through the compatibility
  facade in `src/plugin/account-service.ts`).
  No search tool is registered; the D-SEARCH-MUTEX guard in
  `src/modules/inference/transforms/gemini.ts` keeps the D-SEARCH-MUTEX guard
  for SDK-supplied search tools.
- Production account UI (`src/adapters/opencode/tui/index.ts :: /antigravity` dialog,
  `src/adapters/opencode/rpc.ts :: AntigravityAccounts` with `list/quota/verify/mutate/
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
  project. It only uses `adapters/opencode/debug.ts :: debugLogToFile`. (Observed,
  promote to SHOULD.)
- External-origin fetches MUST NOT receive `x-goog-api-key` or
  `authorization` headers (see R-FETCH-SCOPE).
- `modules/inference/transforms/*` MUST NOT depend on account-selection policy
  or filesystem persistence (inferred; no current violation reported).
