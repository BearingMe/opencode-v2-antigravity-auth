# Architecture

V2 plugin. Model traffic enters through the AI SDK hook or the fetch bridge
and is routed by a single native engine. There is no V1 harness anymore.

## Request flow

```text
OpenCode ──▶ Plugin ──▶ Antigravity API ──▶ Claude/Gemini
               │              │
               │              └─ Google gateway (Gemini format)
               └─ THIS PLUGIN (auth, transform, recovery)
```

1. **Routing in** (`src/adapters/opencode/plugin.ts` + `src/app/composition.ts`)
   - `aisdk.hook("sdk")` matches `antigravity-*` / OAuth-routed `gemini-*`
     models on the Antigravity SDK URL and assigns the OAuth fetch bridge.
     Plain `gemini-*` models with a non-OAuth (API-key) connection keep
     their configured route and never receive the bridge fetch.
   - The fetch bridge (`antigravityFetch`) rejects non-model
     `generativelanguage.googleapis.com` paths, strips credentials for
     external origins, normalizes the body without consuming the original
     request, and calls `executeAntigravityRequest()`.
2. **Execution** (`src/app/execute-request.ts`, sole request path)
   - Account selection (sticky/hybrid/round-robin, rate-limit aware),
     unified token refresh, project-context resolution, soft-quota gate,
     endpoint fallback (daily → prod), optional thinking warmup,
     Antigravity dispatch through `adapters/antigravity/inference-client.ts`,
     streaming transform, success/failure bookkeeping,
     rotation and retry.
3. **Transformation** (`modules/inference/pipeline.ts`,
   `modules/inference/transforms/*`, `modules/inference/request-helpers.ts`,
   `modules/inference/streaming/*`, and signature policy). The plugin request
   facade supplies config, debug, fingerprint, and image-storage adapters.

- Model detection, thinking config, Claude thinking-strip, tool
  normalization to `functionDeclarations[]`, schema sanitization, tool-id
  assignment, `{ project, model, request }` wrapping; SSE streaming with
  signature caching and `thought` → `reasoning` conversion. Engine retains
  account/retry orchestration; the Antigravity client owns fetch dispatch.

Session recovery policy lives in `modules/session-recovery/`: pure in-request
turn repair is separate from session-error recovery. The filesystem store and
OpenCode session operations are composed by the OpenCode adapter through
`adapters/filesystem/session-recovery-store.ts` and
`adapters/opencode/session-recovery.ts`.

Interrupted tool calls are repaired at the provider-agnostic V2 `context` hook:
the hook adds canonical tool-result messages to the outgoing model history.
This does not rewrite persisted session history; the supported V2 prompt API is
text-only.

## Module map

```text
src/
├── adapters/opencode/
│   ├── plugin.ts              # V2 server registration and host lifecycle wiring
│   ├── account-pool.ts        # Filesystem/identity composition for account pool
│   ├── google-sdk.ts          # Isolated AI SDK hook-routing module
│   ├── rpc.ts                 # AntigravityAccounts RPC contract (credential-free)
│   ├── tui/                   # /antigravity dialog UI and controller
│   ├── config/                # OpenCode config/model registration details
│   └── hooks/                 # Host event integrations, including update checks
├── constants.ts               # Compatibility exports for provider/model constants
├── antigravity/oauth.ts       # Compatibility facade for OAuth authorization and exchange
├── adapters/
│   ├── antigravity/           # OAuth identity/endpoints/headers and account/inference clients
│   ├── filesystem/            # Account/recovery/signature stores and debug-file destination
│   └── opencode/              # Host logging and session-recovery operations
├── modules/accounts/
│   ├── account-pool.ts        # Membership, family cursors, cooldowns, and pool bookkeeping
│   ├── account-admin.ts       # Credential-free administration use cases and mutations
│   ├── project-context/       # Managed-project discovery, onboarding, and cache policy
│   ├── quota/                 # Account quota aggregation, snapshots, and presentation
│   ├── verification/          # Account verification outcomes and persistence policy
│   ├── refresh/               # Unified credential refresh and proactive queue policy
│   ├── persistence/           # Stored schema, migrations, dedupe, and tombstone policy
│   └── selection/             # Health/token-bucket scoring, hybrid selection, and backoff
├── modules/session-recovery/  # Error detection, session repair, and request-time turn repair
├── modules/inference/         # Request helpers, transforms, schema cleaning, streaming, signatures, and ports
├── platform/logging/          # Neutral events, policy, and safe log formatting
└── plugin/
    ├── account-service.ts     # Compatibility façade and RPC quota-schema validation
    ├── account-ui-format.ts   # Quota bars, countdowns, one-liners (pure)
    ├── auth.ts / token.ts     # Refresh-part packing and provider/cache composition
    ├── verify.ts                  # Account verification refresh/probe composition
    ├── request.ts / request-helpers.ts  # Compatibility APIs and config/debug adapters
    ├── quota.ts               # Antigravity quota refresh/probe adapter composition
    ├── fingerprint.ts / project.ts  # Device fingerprints + project-context composition
    ├── refresh-queue.ts          # Proactive refresh host composition
    ├── cache.ts               # Auth cache and signature-persistence composition
└── debug.ts / logger.ts / logging-utils.ts / version.ts / errors.ts / types.ts
```

The package-root `src/v2-plugin.ts`, `src/tui.ts`, and `src/rpc.ts` files remain
thin compatibility entrypoints. The server plugin and TUI implementation live
under `adapters/opencode/`; the server adapter composes account administration
and session recovery, and delegates model execution to application composition.
The single request executor remains `app/execute-request.ts`.

Logging is split by responsibility: `platform/logging/` owns neutral policy,
events, and formatting; OpenCode host/console delivery is in
`adapters/opencode/logging.ts`; file paths, retention, and writes are in
`adapters/filesystem/debug-log.ts`. The remaining plugin logging files keep
Antigravity trace context and compatibility-facing logger calls.

Account persistence policy now lives in `modules/accounts/persistence/` and
the locked filesystem implementation is in
`adapters/filesystem/account-store.ts`. Runtime callers use the owning module or
filesystem adapter directly; the former `plugin/storage.ts` compatibility
facade was removed in Step 14.

Account membership and selection policy now live in
`modules/accounts/account-pool.ts` and `modules/accounts/selection/`.
`adapters/opencode/account-pool.ts` supplies the filesystem, fingerprint, and
logging dependencies used to construct the runtime account pool.

Session-recovery policy and request-time turn repair now live in
`modules/session-recovery/`. The OpenCode adapter composes the policy with
filesystem and OpenCode adapters; plugin recovery files remain compatibility
facades only.

Antigravity OAuth/token/project/quota/verification HTTP and response parsing
live in `adapters/antigravity/`. Plugin-facing refresh, project-context,
quota, verification, and OAuth modules retain their orchestration and
compatibility APIs; credential-refresh, project-discovery, quota-probe, and
access-verification ports connect callers to transport clients.

Historical (removed, do not reintroduce): V1 `src/plugin.ts`, `cli.ts`,
`server.ts` (localhost OAuth listener), `ui/`, and `plugin/search.ts`
(`google_search` tool). The D-SEARCH-MUTEX guard for model-declared web
search stays in the request pipeline.

## Boundaries

- `transform/*` stays pure: `(payload, model, config)` in, transformed
  payload out. Network and filesystem work belongs in adapters; account
  policy belongs in `modules/accounts/`.
- `hooks/*` must not depend on auth/quota/accounts/storage/fingerprint/
  project. It only uses file debug logging.
- External-origin fetches must never receive `x-goog-api-key` or
  `authorization`.
- `modules/inference/transforms/*` must not depend on account-selection policy
  or filesystem persistence.
- Runtime (non-test) imports must resolve under **both** `tsconfig.json`
  and `tsconfig.build.json`: use `.js`-suffixed or extensionless relative
  imports. `.ts`-suffixed imports pass `typecheck` but fail `bun run build`
  (TS5097).

## Claude thinking policy

Outgoing Claude requests strip ALL thinking blocks by default
(`keep_thinking: false`); Claude re-thinks fresh each turn, which removes a
class of signature-validation failures. With `keep_thinking: true`, cached
signatures are re-injected (first assistant message of a turn only) and the
disk signature cache is initialized. Gemini 3 function calls enforce valid
`thought_signature` behavior instead (first call keeps the signature,
parallel extras are stripped, calls ordered before responses).
