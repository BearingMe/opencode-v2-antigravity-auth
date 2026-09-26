# Plugin configuration, package, and distribution changes

## Decide whether to convert configuration

OpenCode v2 reads supported v1 server config in place and normalizes it **in memory**, without rewriting files. A plugin still needs new code. If the task is to port a plugin only, do not rewrite every unrelated config section. For native v2 config, `plugin` becomes `plugins`, and a `[package, options]` tuple becomes an object:

```jsonc
// v1
{ "plugin": [["./plugins/local.ts", { "strict": true }]] }

// native v2
{ "plugins": [{ "package": "./plugins/local.ts", "options": { "strict": true } }] }
```

V2 can discover `.opencode/plugin/` and `.opencode/plugins/`; prefer `.opencode/plugins/` for a port. Move supporting modules with the entrypoint. Relative configured plugin paths resolve from the config file containing the entry. The v2 `plugins` array is ordered across applicable config sources; ID controls can disable or re-enable entries. Check the effective list if a plugin loads twice or not at all.

When converting other config as part of an explicitly broader task, consult [general migration docs](https://opencode.ai/v2/docs/migrate-v1/). Native values win over a conflicting valid v1 value, and nested agent/provider/command/model objects must not mix formats internally. V2's global terminal configuration is `~/.config/opencode/cli.json`; it is separate from server config and replaces layered `tui.json(c)` for terminal-only behavior.

## Manifest and runtime dependencies

- v1 plugin imports `@opencode-ai/plugin`; v2 server plugin imports `Plugin` from `@opencode/plugin` and default-exports `Plugin.define({ id, setup })`.
- Published package manifests should depend on a compatible `@opencode/plugin` version and export their v2 entrypoint. If terminal UI is needed, publish `./tui` from `@opencode/plugin/tui` and follow the OpenTUI peer-dependency guidance; CLI-only plugins go in `cli.json` and remain available against remote servers.
- Test the **installed package** on the target release, not solely a workspace-linked copy. Investigate local dependency resolution separately: v2 docs do not establish that v1 local-plugin dependency installation rules still apply.
- Where an integration calls OpenCode's server API, port it to the v2 `@opencode/client` contract and verify each request/response, not just the import path.

## Optional dual-version support

Only when requested, a single package may expose an object containing both the v2 definition and v1 `server()`:

```ts
import { Plugin } from "@opencode/plugin"

export default {
  ...Plugin.define({
    id: "team.example",
    async setup(ctx) {
      await ctx.tool.hook("execute.before", (event) => {
        console.log(`v2 tool: ${event.tool}`)
      })
    },
  }),
  async server() {
    return {
      "tool.execute.before": async (input) => {
        console.log(`v1 tool: ${input.tool}`)
      },
    }
  },
}
```

This has **separate** code paths, not translated hooks. The official plugin migration guide says v1 object entrypoints are supported starting with OpenCode `1.18.29`. Older v1 runtimes may need a separate package version or entrypoint. Test the oldest claimed v1 runtime and target v2 independently; design shared business logic behind separate adapters if worthwhile.

Sources: [general migration](https://opencode.ai/v2/docs/migrate-v1/), [plugin migration](https://opencode.ai/v2/docs/build/plugins/migrate-v1), [v2 plugin configuration](https://opencode.ai/v2/docs/plugins/), [v2 CLI plugins](https://opencode.ai/v2/docs/build/plugins/cli).
