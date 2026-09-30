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

1. **Routing in** (`src/v2-plugin.ts` + `src/plugin/engine.ts`)
   - `aisdk.hook("sdk")` matches `antigravity-*` / OAuth-routed `gemini-*`
     models on the Antigravity SDK URL and assigns the OAuth fetch bridge.
     Plain `gemini-*` models with a non-OAuth (API-key) connection keep
     their configured route and never receive the bridge fetch.
   - The fetch bridge (`antigravityFetch`) rejects non-model
     `generativelanguage.googleapis.com` paths, strips credentials for
     external origins, normalizes the body without consuming the original
     request, and calls `executeAntigravityRequest()`.
2. **Execution** (`src/plugin/engine.ts`, sole router)
   - Account selection (sticky/hybrid/round-robin, rate-limit aware),
     unified token refresh, project-context resolution, soft-quota gate,
     endpoint fallback (daily → prod), optional thinking warmup,
     Antigravity fetch, streaming transform, success/failure bookkeeping,
     rotation and retry.
3. **Transformation** (`src/plugin/request.ts`, `transform/*`,
   `request-helpers.ts`, `core/streaming/*`)
   - Model detection, thinking config, Claude thinking-strip, tool
     normalization to `functionDeclarations[]`, schema sanitization, tool-id
     assignment, `{ project, model, request }` wrapping; SSE streaming with
     signature caching and `thought` → `reasoning` conversion.

Session recovery runs on two layers: in-request turn repair
(`thinking-recovery.ts`) and the session-error hook (`recovery.ts`,
gated by `session_recovery`, optional `auto_resume`).

## Module map

```text
src/
├── v2-plugin.ts               # V2 entry: integration/provider/model/aisdk/tool/session/event wiring
├── google-sdk.ts              # Isolated AI SDK module (hook routing key; models must use aisdk:<ANTIGRAVITY_SDK>)
├── rpc.ts                     # AntigravityAccounts RPC contract (credential-free)
├── tui.ts                     # /antigravity dialog UI (host-rendered dialogs only)
├── constants.ts               # Endpoints, headers, OAuth identity, model routing
├── antigravity/oauth.ts       # PKCE authorize URL + code exchange + project discovery
├── hooks/auto-update-checker/ # Version check (root sessions only; never installs)
└── plugin/
    ├── engine.ts              # Native request/rotation engine (sole router)
    ├── account-service.ts     # Shared account store service (tool + RPC backend)
    ├── account-ui-format.ts   # Quota bars, countdowns, one-liners (pure)
    ├── auth.ts / token.ts     # Refresh-part packing, unified refresh path
    ├── verify.ts / verification.ts  # Access verification + error helpers
    ├── request.ts / request-helpers.ts  # Transform core + schema/thinking utils
    ├── transform/             # Pure per-family transforms (claude/gemini/sanitizer/resolver)
    ├── core/streaming/        # SSE transformer
    ├── thinking-recovery.ts / recovery/  # Turn repair + session-error hook
    ├── quota.ts               # fetchAvailableModels + Gemini CLI quota probing
    ├── accounts.ts / storage.ts  # Pool manager + v4 persistent store
    ├── fingerprint.ts / project.ts  # Device fingerprints + managed project context
    ├── refresh-queue.ts / rotation.ts  # Proactive refresh + health/token-bucket scoring
    ├── config/                # Zod schema, loader, model definitions, opencode.json updater
    ├── cache/ / stores/       # Signature caches (memory + disk)
    └── debug.ts / logger.ts / logging-utils.ts / version.ts / errors.ts / types.ts
```

Historical (removed, do not reintroduce): V1 `src/plugin.ts`, `cli.ts`,
`server.ts` (localhost OAuth listener), `ui/`, and `plugin/search.ts`
(`google_search` tool). The D-SEARCH-MUTEX guard for model-declared web
search stays in the request pipeline.

## Boundaries

- `transform/*` stays pure: `(payload, model, config)` in, transformed
  payload out. Network, filesystem, and account mutation belong in
  `request.ts`, `accounts.ts`, `storage.ts`, `quota.ts`, `project.ts`.
- `hooks/*` must not depend on auth/quota/accounts/storage/fingerprint/
  project. It only uses file debug logging.
- External-origin fetches must never receive `x-goog-api-key` or
  `authorization`.
- `transform/*` must not import `accounts.ts` / `storage.ts`.
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
