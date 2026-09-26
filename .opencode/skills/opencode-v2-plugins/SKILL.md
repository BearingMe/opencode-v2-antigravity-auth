---
name: opencode-v2-plugins
description: Use when researching, creating, configuring, publishing, debugging, or maintaining OpenCode v2 plugins: @opencode/plugin, Plugin.define, server or CLI plugins, plugins config and CLI management, domain transforms, hooks, tools, storage, dependencies, Effect, RPC, or event streams. Check the target v2 release and its published API before implementation.
---

# OpenCode v2 plugins

Use the native OpenCode v2 API. Keep research-only requests read-only; this skill describes v2 directly, without assuming any other plugin API.

## Workflow

1. Establish the task (research, create, manage, diagnose) and target OpenCode v2 / `@opencode/plugin` versions. Check the installed runtime or ask when release-specific behavior matters.
2. Inspect applicable `opencode.json(c)`, `.opencode/plugins/`, `cli.json` if terminal-only, package metadata, and repository guidance. Determine whether the plugin runs on the server, in the CLI, or both.
3. Pick the narrowest extension point: a domain **method** to read/invoke, **transform** to change registered state, **hook** to intercept an operation, or **event subscription** to observe public events. Consult only the relevant reference below.
4. Verify exact signatures against the target version of the official v2 docs and `@opencode/plugin` types before implementing; avoid guessing event payloads or release-specific fields. Favor examples from the relevant Promise, Effect, CLI, or RPC docs rather than mixing their contracts.
5. For changes, check plugin loading and behavior on the target version; exercise cleanup, cancellation, options, and reload as applicable. For research, cite sources, distinguish guarantees from recommendations, and state uncertainties. Report what was done and how it was verified.

## Read as needed

- [development.md](references/development.md): entrypoint, options, tools, storage, dependencies, publishing, Effect, CLI, RPC.
- [management.md](references/management.md): discovery, config order, ID controls, CLI, package updates, reload and diagnostics.
- [domains-and-transforms.md](references/domains-and-transforms.md): domain selection, replay, registrations, provider/model/integration and other editors.
- [hooks-and-events.md](references/hooks-and-events.md): interception semantics, request kinds, cancellation, event stream and cleanup.
- [sources.md](references/sources.md): official source links, API schema and version limitations.

## Ground rules

- Server plugins default-export `Plugin.define({ id, setup(ctx) { ... } })` from `@opencode/plugin`; `id` is stable and scopes storage. Terminal plugins import `@opencode/plugin/tui`; Effect plugins import `@opencode/plugin/effect` and provide `effect` rather than `setup`.
- Keep transform callbacks **synchronous and replayable**. Load external inputs before registration; `ctx.<domain>.reload()` replays registrations, not plugin setup. Retain registrations only if early disposal is needed.
- Use `ctx.event.subscribe({ signal })` for public server notifications, domain `.hook(...)` for live interception. Abort subscriptions and release timers/sockets in cleanup; registered hooks/transforms are cleaned up on plugin unload.
- `ctx.location` belongs to the plugin instance, not necessarily the current session or every event. Check the event/session's own location when needed.
