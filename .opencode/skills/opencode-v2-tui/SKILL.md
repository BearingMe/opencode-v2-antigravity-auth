---
name: opencode-v2-tui
description: Build and debug terminal UI inside OpenCode v2 plugins. Use whenever the user mentions plugin TUI, @opencode/plugin/tui, TUI dialogs, slots, routes, panels, keymap layers, slash commands, cli.json plugins, OpenTUI Solid JSX, usePlugin, No renderer found, or migrating a v1 TUI plugin to v2. Covers dialog/toast/route/slot/panel surfaces, component-owned keymaps, packaging, server-backed RPC UI, and TUI debugging.
---

# OpenCode v2 plugin TUI

Build terminal UI that runs **inside** the OpenCode v2 CLI as part of a plugin.
Do not use this for standalone TUI apps, Ink/React CLIs, or general server-plugin
hooks/transforms/tools — use `opencode-v2-plugins` for those.

Baseline: OpenCode **2.0.21**, `@opencode/plugin` **2.0.21**, upstream `v2` branch
commit `aa6a4f93`. Always verify against the target release before implementing;
V2 TUI APIs move fast and V1 examples will mislead.

## Workflow

1. Establish target OpenCode + `@opencode/plugin` versions and whether the TUI
   is combined (server + `./tui`) or CLI-only (`cli.json` only).
2. Pick the narrowest UI surface in [ui-surfaces.md](references/ui-surfaces.md):
   dialog/toast for simple flows, route for a page, slot for an embedded
   contribution, `session.panel` for session-scoped panels.
3. Wire input via component-owned keymap layers ([components-and-input.md](references/components-and-input.md)).
   Register app-wide commands from an `app` slot render, not bare `setup()`.
4. If the UI needs server data, call through `context.client` or a typed RPC
   contract ([server-backed-ui.md](references/server-backed-ui.md)). Never put
   tokens or credentials in TUI-visible projections.
5. Package and validate loading ([packaging-and-runtime.md](references/packaging-and-runtime.md),
   [configuration-and-loading.md](references/configuration-and-loading.md)).
   Test the installed artifact, not only a workspace-linked copy.
6. On failure, follow [debugging-and-testing.md](references/debugging-and-testing.md)
   in order: version → loading → entrypoint → rendering → input → data → lifecycle.

## Read as needed

- [ui-surfaces.md](references/ui-surfaces.md): dialogs, toasts, routes, slots, panels, markdown, theme.
- [components-and-input.md](references/components-and-input.md): Solid/OpenTUI, `usePlugin`, keymap ownership, modes, focus.
- [configuration-and-loading.md](references/configuration-and-loading.md): `cli.json` vs `opencode.json`, discovery, remote servers, options, storage.
- [packaging-and-runtime.md](references/packaging-and-runtime.md): `./tui` export, JSX emit, shared singletons, Bun vs Node.
- [server-backed-ui.md](references/server-backed-ui.md): `context.client`, `context.data`, RPC calls, location, credential-free projections.
- [debugging-and-testing.md](references/debugging-and-testing.md): `/plugins`, DevTools, logs, `testRender`, manual checks.
- [v1-differences-and-sources.md](references/v1-differences-and-sources.md): V1→V2 map, doc URLs, branch trap, type sources.

## Ground rules

- TUI entrypoint is `import { Plugin } from "@opencode/plugin/tui"` with
  `export default Plugin.define({ id, setup(context) { ... } })`. Never import
  `@opencode-ai/plugin/tui` (V1) in new V2 code.
- The host owns the renderer, layout, focus, and fullscreen presentation. Never
  create a second renderer or start another app render loop from a plugin.
- Custom UI is OpenTUI + Solid JSX. No React, DOM, Ink, or HTML elements.
- `context.keymap.layer()` is owned by the calling component. App-wide commands
  belong inside an `app` slot render returning `null`.
- Return setup cleanup for timers, subscriptions, watchers, and sockets.
  Route/slot/markdown registrations unwind via their returned unregister;
  also push owned disposers so reload/deactivation cannot leak.
- Handle cancellation: `select`/`prompt` resolve `undefined`, `confirm` resolves
  `boolean | undefined` when dismissed.
- Namespace command IDs, routes, panel names, and storage keys
  (e.g. `acme.review`, not `review`).
- Version-pin claims: cite the checked release and branch. The repo has both a
  `2.0` branch (older API) and a `v2` branch (current). Use `v2`.
