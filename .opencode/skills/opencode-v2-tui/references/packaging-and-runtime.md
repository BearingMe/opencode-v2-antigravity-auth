# Packaging and runtime

## Package layout

Combined plugin (server + TUI):

```json
{
  "name": "opencode-acme-plugin",
  "type": "module",
  "exports": {
    ".": "./src/index.ts",
    "./tui": "./src/tui.tsx",
    "./rpc": "./src/rpc.ts"
  },
  "dependencies": { "@opencode/plugin": "latest" },
  "peerDependencies": {
    "@opentui/core": ">=0.5.8",
    "@opentui/solid": ">=0.5.8",
    "solid-js": ">=1.9.0"
  }
}
```

```ts
// src/index.ts
import { Plugin } from "@opencode/plugin"
export default Plugin.define({ id: "acme.server", setup() {} })
```

```ts
// src/tui.tsx
import { Plugin } from "@opencode/plugin/tui"
export default Plugin.define({ id: "acme.cli", setup() {} })
```

Host auto-loads only `.` and `./tui`. `./rpc` is a contract-only import for
other plugins/clients — it never executes as an entrypoint. Pin a compatible
`@opencode/plugin` version for the OpenCode release you target; verify `latest`
resolves compatibly before shipping.

## JSX emit and singletons (read before custom JSX)

The docs example exports raw `./src/tui.tsx`, but that is **not** a complete
build recipe for published packages:

- OpenTUI Solid transform excludes `node_modules`. Packages installed under
  `node_modules` shipping uncompiled TSX do not get a runtime JSX transform.
  Publish precompiled Solid/OpenTUI ESM for installed packages.
- Local file plugins go through the host source pipeline (Bun transform with
  runtime-module map, Node hook path otherwise) — local success does not prove
  installed-package success. Test both.
- Keep `@opentui/*` and `solid-js` as peers/externals. Bundling a second copy
  splits context identity and produces `No renderer found` / missing-provider
  crashes even when code looks correct.
- The host installs runtime-module support (`ensureRuntimePluginSupport`) once
  with a complete map before importing plugins. Never call it from a plugin.
- TUI plugin module shape is `{ default: { id, setup } }`. Anything else fails
  with `Invalid V2 TUI plugin module`.
- Do not import server-only `@opencode/plugin` domains from `./tui` expecting
  server behavior; use `context.client` / RPC from the TUI side.

## Runtime differences

- **Bun:** full runtime transform + module-map rewriting; local TSX sources
  reload with dependency tracking and debounced reconcile.
- **Node:** loads precompiled plugins; no Bun transform. Ship compiled ESM.
- Hot reload watches local entrypoints and their resolved local deps; missing
  targets are polled. Package resolution failures are memoized until config
  changes. A failed import keeps the last-good generation running and surfaces
  a toast + `/plugins` entry — it does not tear down siblings.
- Reconcile is serialized; membership/order changes rebuild the generation to
  preserve slot ordering. Unchanged generations are no-ops.

## Minimal TUI smoke

```tsx
import { Plugin } from "@opencode/plugin/tui"

export default Plugin.define({
  id: "acme.smoke",
  setup(context) {
    return context.ui.slot({
      append: "home.footer.status",
      render: () => <text>SMOKE</text>,
    })
  },
})
```

If this one-line contribution does not render, the fault is loading/build/
version — not dialog logic. Add dialogs, keymaps, and RPC only after smoke passes.
