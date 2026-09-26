# Semantic traps during a plugin port

## Requests and conversation state

- **Prompt admission vs model context:** v2 `session.hook("prompt")` changes the admitted, persisted user message; `session.hook("context")` changes the assembled outbound agent-loop request. Do not use prompt for something meant to run each turn, or context for changing durable input. Admission can run more than once under concurrent submissions, so side effects are not exactly-once.
- **Auxiliary calls:** `context` does not cover compaction, transient `generate`, or `title`. If a v1 hook applied to every model call, register each needed v2 hook and verify main and auxiliary paths. `event.options` uses semantic provider options, not raw wire fields; scope provider-specific settings by `providerID`.
- **Provider interception:** `model.request` modifies model headers/settings; `http.request` and `http.response` modify the native HTTP exchange. Fetch bodies are one-shot; clone or replace before reading. Native WebSocket traffic needs its experimental WS handshake/frame hooks, which may change by release.
- **Retry and quota:** `session.hook("retry")` changes a proposed decision/delay; maximum attempts remain enforced. It does not expose internal scheduling or perform account rotation. Context-overflow recovery is separate. Validate actual quota rotation, abort propagation, and streaming behavior if the old plugin depended on them.

## Identity, state, and lifecycle

- **Location:** `ctx.location.directory` belongs to a loaded plugin instance. It is not necessarily the path for a session, tool invocation, child session, or watched event. v1 `worktree` has no universal replacement: select current session directory, worktree root, or canonical project root according to the original behavior; verify against target v2 types.
- **Transforms:** callbacks are synchronous, replayed in registration order onto fresh state. Load remote data before registration, capture it, call `ctx.<domain>.reload()` when it changes. `reload()` replays transforms; it does not rerun `setup`. Avoid one-time side effects inside callbacks.
- **Persistent state:** `ctx.storage` is durable and scoped by stable plugin ID; it does not import v1 custom files, signatures, or credentials for you. Design a deliberate data transition or retain a justified existing store. Handle concurrent access/ownership according to the target application.
- **Cleanup:** hook/transform registrations are disposed on unload. Return a cleanup function for independently owned timers, subscriptions, sockets, subprocesses; abort `ctx.event.subscribe({ signal })`. Tool executors receive a cancellation signal for cooperative I/O.
- **Auth, provider, integration:** authentication methods belong to integration APIs; provider sources and model candidate transforms are separate. A v1 `auth.loader` that overrides `fetch` may need auth/integration registration **plus** native request/response hooks, retry policy, and stream handling. Credential refresh, account selection and error recovery need their own parity checks.
- **Permissions:** explicit configured `deny` never reaches v2 `permission.hook("evaluate")`; a hook that previously tried to override such rules may need a new policy design.
- **Terminal UI:** CLI plugins use `@opencode/plugin/tui` and `context.client`/`context.ui`; server plugin context is not a substitute for UI state. Configure CLI-only packages in `cli.json` for remote-server operation.

When a v1 hook is experimental or missing in the target v2 API, mark it **unresolved**, state the required user-visible effect, and confirm a supported alternative instead of inventing an equivalent.

Sources: [plugin migration](https://opencode.ai/v2/docs/build/plugins/migrate-v1), [v2 build reference](https://opencode.ai/v2/docs/build/plugins), [v2 CLI reference](https://opencode.ai/v2/docs/build/plugins/cli).
