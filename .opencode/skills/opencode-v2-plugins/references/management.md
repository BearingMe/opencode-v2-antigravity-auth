# Configure and manage OpenCode v2 plugins

## Config and discovery

Use plural `plugins` in `opencode.json(c)`; entries can be npm packages (including versions/scopes), npm-compatible Git specs, local directories/files, file URLs, or `{ "package": "...", "options": { ... } }` objects. Relative paths resolve relative to the declaring config file. Applicable config arrays are applied from low to high precedence rather than replaced: global `~/.config/opencode/opencode.jsonc`, project `./opencode.jsonc`, then `./.opencode/opencode.jsonc` in the [v2 docs example](https://opencode.ai/v2/docs/plugins/). Verify any additional config scopes against the targeted runtime.

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": [
    "opencode-acme-plugin@1.2.0",
    { "package": "./plugins/local", "options": { "strict": true } }
  ]
}
```

OpenCode discovers direct `.js`/`.ts` files and immediate plugin package directories from discovered `.opencode/plugins/` directories, also globally at `~/.config/opencode/plugins/`. A project-root `plugins/` sibling of `opencode.json(c)` is **not** auto-discovered: configure the path explicitly. If using a package directory, ensure its entrypoint/export layout matches the package contract.

Plugin list entries are processed in order: `"*"` selects all, `"-acme.reviewer"` disables an ID, `"-team.*"` disables an ID prefix, and a later ID can re-enable it. `opencode.config.policy` and `opencode.provider.opencode` ignore removals for policy delivery. Diagnose duplicate or unexpected behavior by inspecting the merged plugin list and actual IDs; do not assume a path string is the same thing as a plugin ID.

## CLI management and updates

The `opencode plugin` commands manage **global package plugins**:

```sh
opencode plugin add opencode-acme-plugin@1.2.0
opencode plugin list
opencode plugin list --builtin
opencode plugin check
opencode plugin update
opencode plugin update opencode-acme-plugin
opencode plugin remove opencode-acme-plugin@1.2.0
```

`check` covers server and TUI-only package plugins; `update` updates outdated packages. Local plugins and exact package revisions are skipped. `plugin add` accepts npm versions/tags/ranges and npm-compatible Git specs (host shortcuts, HTTPS or SSH, branch/tag/commit, and `::path:` selectors). Configure local paths directly; tarballs and npm aliases are not accepted by `plugin add`.

Startup loads cached package plugins immediately, installs missing packages in the background, and checks unpinned npm/Git targets for updates **without changing the installed package**. Exact npm versions and full Git hashes remain pinned.

## Reload and terminal scope

Changes under watched config directories reload automatically; unwatched local dependencies can require restart. Use `opencode service restart` if necessary, or touch the plugin's watched entrypoint to trigger a reload. Domain `ctx.<domain>.reload()` replays registered transforms *within an already loaded plugin* and is not the same as plugin reload.

`cli.json` configures **CLI-only** plugins so they remain active against a remote server. Packages configured on the server that expose a TUI component are loaded automatically by the CLI; do not configure them again in `cli.json` just for this. See [CLI plugin configuration](https://opencode.ai/v2/docs/cli/plugins) and [CLI API](https://opencode.ai/v2/docs/build/plugins/cli).

## Diagnose

Check version, config source and path resolution, `plugins` order/ID filters, local entrypoint exports, package install/update status, `opencode plugin list` and `ctx.plugin.list()` at the relevant location. Confirm the extension point was registered and invoked, then test unloading/reloading for cleanup. Distinguish a registered resource definition from a connected resource's status; catalog registration does not guarantee an MCP server or provider is already connected.
