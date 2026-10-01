# Configuration and loading

## cli.json vs opencode.json

| | `cli.json` | `opencode.json(c)` |
|---|---|---|
| Owner | Local terminal client only | Server / project configuration |
| Location | Global only: `~/.config/opencode/cli.json` (`$XDG_CONFIG_HOME` when set) | Global `~/.config/opencode/opencode.json(c)` + project `opencode.json(c)` / `.opencode/opencode.json(c)` |
| Schema | `https://opencode.ai/v2/cli.json` | `https://opencode.ai/config.json` (editor hint; do not infer V2 shapes from it) |
| TUI relevance | Themes, keybinds, terminal prefs, debug, CLI-only plugins | Server/combined plugins whose `./tui` the CLI auto-loads |
| Remote | CLI-only plugins stay active against remote servers | CLI pulls eligible TUI components from connected server inventory |

Rules:

- Combined plugin (server + TUI) configured in `opencode.json(c)` with a `./tui`
  export loads automatically. Do **not** also list it in `cli.json`.
- CLI-only plugin (no server side, or must survive remote-server use) goes in
  `cli.json.plugins`.
- There is no project-local `cli.json`. `OPENCODE_CLI_CONFIG_CONTENT` overlays
  global `cli.json` (objects merge, arrays/scalars replace).
- First V2 startup migrates supported global `tui.json` settings; project-local
  client config is not migrated.

## Plugin spec forms (cli.json)

```json
{
  "plugins": [
    "opencode.example",
    "-opencode.notifications",
    { "package": "./plugins/status", "options": { "compact": true } }
  ]
}
```

Entries process in order. `-` prefix or `-ns.*` wildcard disables matches.
Object form passes `options` through to `context.options`. Supported specifiers:
package name (+`@version`), local path, absolute path, `file://` URL.

## Discovery

Local (unpublished) layout — server and TUI entrypoints stay together:

```text
<global-config>/plugins/status/index.ts
<global-config>/plugins/status/tui.ts
<project>/.opencode/plugins/status/index.ts
<project>/.opencode/plugins/status/tui.ts
```

Discovered plugins import `@opencode/plugin/tui` directly; the host resolves it
at runtime. TUI-only plugins are admitted by discovery even when server
inventory only carries combined plugins; explicit config is final authority.

## Setup context

```ts
setup(context) {
  const compact = context.options.compact === true
  const location = context.location ?? context.data.location.default()
  const version = context.app.version
  const channel = context.app.channel
  const client = context.client
  const renderer = context.renderer
  const theme = context.theme
}
```

- `context.location` is where this plugin instance loaded, not necessarily the
  active session's location. Re-read per session/event when it matters.
- `context.options` is `Record<string, any>` — narrow/validate before use.
- `context.client` is the generated OpenCode client against the connected
  server (possibly remote). Use it for `client.rpc(...)`, `plugin.list`, etc.
- Return a cleanup function for owned resources. Route/slot/markdown
  registrations already return unregister functions — return or collect them.
