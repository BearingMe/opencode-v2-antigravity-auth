---
name: opencode-plugins-migration
description: Use when assessing, planning, implementing, or debugging a port of an OpenCode v1 plugin to OpenCode v2, including hook/tool/auth/provider rewrites, config and package entrypoints, event streams, behavior parity, or explicitly requested dual-version support. Establish both runtime versions and preserve intended behavior; research-only requests remain read-only.
---

# Port OpenCode plugins from v1 to v2

Treat migration as a behavior-preserving redesign, not a string replacement: v2 can normalize supported v1 **configuration**, but it cannot execute v1 **plugin code**. Use this skill for migrations; use [v1 plugin guidance](../opencode-v1-plugins/SKILL.md) to interpret source APIs and [v2 plugin guidance](../opencode-v2-plugins/SKILL.md) for destination API details. The references here remain usable without those sibling skills.

## Workflow

1. **Set boundaries.** Establish the actual v1 OpenCode runtime and `@opencode-ai/plugin` version, the target v2 runtime and `@opencode/plugin` version, and the requested deliverable (assessment, plan, implementation, or diagnosis). Ask whether dual support is required if it affects the design; do not add it by default. Respect research-only requests.
2. **Inventory behavior before editing.** Inspect plugin exports, entrypoints, returned hooks/tools, config, dependencies, SDK/server calls, OAuth and request routing, event handlers, timers, file state, TUI usage, and tests. Identify which behavior applies to user prompts, main model turns, auxiliary calls, child sessions, and other locations. Record the expected effect and a verification method for each item.
3. **Map each behavior, not just each hook name.** Make a table: `behavior | v1 implementation | v2 destination | semantic difference or unknown | parity check`. Label mappings as direct adaptation, behavioral redesign, or unresolved contract. Use [extension-point-mapping.md](references/extension-point-mapping.md) and [behavioral-pitfalls.md](references/behavioral-pitfalls.md); check the official v2 docs and release-matched types before relying on exact signatures.
4. **Port in slices if implementation is requested.** Start with v2 entrypoint, stable ID, packaging/config, then transforms/tools, runtime hooks/client calls, authentication/networking, subscriptions/state/CLI. Preserve unrelated project settings and reusable domain logic. Refer to [configuration-and-packaging.md](references/configuration-and-packaging.md). Consider an explicit transition plan for stored credentials and files.
5. **Verify parity.** Follow [verification.md](references/verification.md): loading alone is insufficient. Typecheck/build and test affected behavior, exercise every registered operation, cancellation, cleanup/reload, relevant request kinds, and installed-package behavior where applicable. If the target runtime is unavailable, distinguish static checks from unverified runtime behavior.
6. **Report** source/target versions, the behavior table, decisions, changes (if any), checks, and known gaps. Cite official sources from [sources.md](references/sources.md) for nonobvious or release-sensitive claims.

## Non-equivalences to watch

- V2 `ctx.session.hook("prompt")` changes admitted/persisted user input; `ctx.session.hook("context")` changes the outgoing agent-loop request. `compaction`, `generate`, and `title` are distinct model-call kinds.
- V2 `ctx.location` is the plugin instance's location, not a universal replacement for v1 `directory`/`worktree` on every session or tool. Decide which actual path is needed.
- V2 transforms are synchronous and replayable; do external I/O before registration and call domain `reload()` when captured data changes. They do not mutate one global config object.
- Auth/integration registration, provider/model definitions, and native HTTP/WS interception are separate v2 concerns. A v1 `auth.loader` with a `fetch` override cannot be ported by renaming `auth`.
- Retained v1 configuration does not imply retained plugin behavior; converting unrelated config is optional. Dual entrypoints contain two separate implementations and only work on supported runtimes.
