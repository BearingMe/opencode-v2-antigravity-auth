# V1 differences and sources

## Do not trust V1 examples

V1 TUI (`@opencode-ai/plugin/tui`, e.g. 1.18.29) and V2 TUI
(`@opencode/plugin/tui`, 2.0.x) are different contracts. V1 implementations do
not run in V2 — moving files or renaming config is not a migration.

| V1 | V2 |
|---|---|
| `import ... from "@opencode-ai/plugin/tui"` | `import { Plugin } from "@opencode/plugin/tui"` |
| Module exports `tui(api, options, meta)` function | Default-exports `Plugin.define({ id, setup })` |
| `api.command.register/trigger/show` (legacy, deprecated in late V1) | `context.keymap.layer()` (component-owned) |
| `api.keymap.*` (varied by V1 minor) | `context.keymap.layer/dispatch/shortcuts/commands/pending/active/mode` |
| `api.route.register/navigate/current` | `context.ui.router.register/navigate/current` |
| `api.ui.DialogSelect` component + callbacks | `await context.ui.dialog.select()` (+ `alert/confirm/prompt/show/set/clear`) |
| `api.ui.toast(...)` | `context.ui.toast.show(...)` |
| `api.slots.register(...)` | `context.ui.slot(...)` with `prepend/append/before/after/replace` |
| Slot names like `sidebar_content` | Paths like `sidebar.content` |
| `api.state`, `api.kv` | `context.data`, `context.storage.store/memory` |
| `api.theme.current.text` (RGBA object) | `context.theme.text.base` (resolved tokens) + `context.themeMode` |
| Layered `tui.json(c)` | Single global `cli.json` |
| `plugin: [...]` tuple config | `plugins: [...]` with `{ package, options }` objects |

Migration destinations are not renames: re-evaluate each V1 hook/slot against
the V2 surface. `@opencode-ai/sdk/v2` in an import does not imply the V2 plugin
API. Dual V1+V2 packages must keep `server()` and `setup()` implementations
separate — sharing an export does not translate behavior.

## Canonical sources (check target release first)

- CLI plugins: https://opencode.ai/v2/docs/build/plugins/cli
- CLI settings: https://opencode.ai/v2/docs/cli/config
- CLI plugin loading: https://opencode.ai/v2/docs/cli/plugins
- TUI usage: https://opencode.ai/v2/docs/cli/tui/
- Plugins guide: https://opencode.ai/v2/docs/build/plugins
- RPC: https://opencode.ai/v2/docs/build/plugins/rpc
- V1 migration: https://opencode.ai/v2/docs/migrate-v1 and .../build/plugins/migrate-v1
- Troubleshooting: https://opencode.ai/v2/docs/troubleshooting
- V2 TUI types: https://unpkg.com/@opencode/plugin@2.0.21/dist/tui/context.d.ts
- V1 TUI types (comparison only): https://unpkg.com/@opencode-ai/plugin@1.18.29/dist/tui.d.ts
- Host implementation (`v2` branch): `packages/plugin/src/tui/`, `packages/tui/src/plugin/`
- OpenTUI runtime loading: https://github.com/anomalyco/opentui/blob/main/packages/web/src/content/docs/extend/runtime-plugins.mdx

Branch trap: `anomalyco/opencode` has a `2.0` branch (older TUI API:
`command/keymap/mode/route/ui/Dialog/kv/state`) and a `v2` branch (current
`context.ui/keymap/storage/data` API). Always confirm which branch and package
version a sample came from before copying it.
