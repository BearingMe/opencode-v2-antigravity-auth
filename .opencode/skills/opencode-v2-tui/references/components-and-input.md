# Components and input

## Solid + OpenTUI

Custom plugin UI is Solid JSX rendered by OpenTUI (`<box>`, `<text>`, etc.).
No React, DOM nodes, Ink components, or HTML tags. The host TUI sets
`jsxImportSource: @opentui/solid`; match that in plugin TSX and tests.

```tsx
import { usePlugin } from "@opencode/plugin/tui"

function Status() {
  const context = usePlugin()
  return <text fg={context.theme.text.base}>{context.app.version}</text>
}
```

`usePlugin()` only works inside JSX rendered through the plugin context
(route/slot/dialog `provide` wrapper). Calling it in bare `setup()` or outside
a provided render throws `PluginContextProvider is missing`.

Keep renders pure and reactive: read `context.data.*`, `context.ui.model`,
`context.ui.tabs`, keymap state inside Solid computations so updates flow.
Do not snapshot reactive reads into module-level variables at setup time.

## Keymap layers (component-owned)

`context.keymap.layer()` creates a reactive layer **owned by the calling component**.
Registering at bare `setup()` top level has no owner; app-wide commands must be
registered from an `app` slot render:

```tsx
const unregister = context.ui.slot({
  append: "app",
  render: () => {
    context.keymap.layer(() => ({
      mode: "global",
      priority: 10,
      commands: [
        {
          id: "acme.status",
          title: "Show Acme status",
          group: "Acme",
          bind: "ctrl+g",
          palette: true,
          slash: { name: "acme", aliases: ["status"], arguments: true },
          enabled: () => true,
          suggested: true,
          run: async (input) => context.ui.toast.show({ message: input ?? "Ready" }),
        },
      ],
      bindings: ["acme.status"],
    }))
    return null
  },
})
return unregister
```

Command rules (enforced at runtime):

- Named commands need non-empty `id`; palette/slash commands require an `id`.
- Inline (id-less) commands require `bind` and cannot use `palette`/`slash`.
- `bind: false` disables auto-binding for a named command.
- `run` may return `false` to continue keyboard dispatch to lower layers.
- `enabled` accepts boolean or predicate; layer itself accepts `enabled`.

Introspection:

```ts
context.keymap.dispatch("acme.status", "verbose")
const shortcuts = context.keymap.shortcuts("acme.status")
const commands = context.keymap.commands() // reactive
const pending = context.keymap.pending()   // reactive
const active = context.keymap.active()     // reactive
const popMode = context.keymap.mode.push("acme-search")
popMode()
```

`mode` defaults to `base`; use `mode: "global"` to opt out. Target one
renderable with `target: () => renderable | null`. Scope panel-local bindings
inside the mounted panel component so they die with it.

Key syntax and command IDs come from `cli.json` keybinds and the host keymap.
Never guess IDs — check the keybind reference for the target release. Respect
user overrides; do not hard-code `ctrl+c`/`escape` without a reason.

## Model / tabs access

```ts
const selected = context.ui.model.current() // { providerID, modelID, variant? } | undefined
const variants = context.ui.model.variant.list() // reactive
context.ui.model.variant.set("high")
context.ui.model.variant.set(undefined) // model default
```

`variant.set` returns `false` when no model is selected or the variant is
unknown — check the return instead of assuming success.

```ts
if (context.ui.tabs.enabled()) {
  context.ui.tabs.open(sessionID) // background open
  context.ui.tabs.focus(sessionID)
  context.ui.tabs.move(sessionID, 0)
  context.ui.tabs.close(sessionID)
}
```

All tab mutators return `false` when disabled or unmatched.

## Storage (TUI side)

```ts
const [settings, updateSettings] = context.storage.store("settings", { initial: { compact: false } })
await updateSettings((draft) => { draft.compact = true })

const [state, updateState] = context.storage.memory("state", { initial: { count: 0 } })
updateState((draft) => { draft.count++ })
```

`store` is durable JSON, synced across TUI instances, keyed per plugin id.
`memory` survives hot reloads, dies on TUI exit, allows non-JSON values.
`store` updates are async; `memory` updates are sync.
