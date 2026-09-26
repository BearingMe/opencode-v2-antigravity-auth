# Build OpenCode v2 plugins

## Server plugin (Promise API)

Place a package directory or direct `.ts`/`.js` file under `.opencode/plugins/`, or configure a package/path in `plugins`. Use a stable plugin ID; storage and diagnostics use it.

```ts
// .opencode/plugins/example/index.ts
import { Plugin } from "@opencode/plugin"

export default Plugin.define({
  id: "example",
  async setup(ctx) {
    const strict = ctx.options.strict === true
    await ctx.storage.set("settings", { strict })
  },
})
```

`setup` runs when loaded. A returned cleanup function runs on unload; registered hooks/transforms are disposed by the plugin runtime. `ctx.location` gives plugin-instance `directory`, optional `workspaceID`, and project metadata (`id`, `directory`, `canonical`), not the location of every session. `ctx.options` holds config options; narrow/validate unknown values. `ctx.storage` offers plugin-scoped durable JSON `get`, `set`, `remove`, `scan({ prefix, after?, limit? })`.

## Custom tools

The Promise tool editor uses JSON Schema input and a structured result. A transform callback itself is synchronous, even inside async `setup`.

```ts
await ctx.tool.transform((editor) => {
  editor.add({
    name: "greeting",
    description: "Greet a person",
    input: {
      type: "object",
      properties: { name: { type: "string" } },
      required: ["name"],
      additionalProperties: false,
    },
    execute: async (input, context) => {
      // Pass context.signal to cancellable I/O such as fetch.
      return { content: `Hello ${(input as { name: string }).name}!` }
    },
  })
})
```

Namespaced tools use `editor.namespace({ name, description })` and `options.namespace`. Tool IDs include the effective namespace (e.g. `acme_greeting`); use the effective ID for updates/removals. Later valid registrations override an earlier tool of the same effective name. New model requests capture a tool snapshot; reload/disposal changes future snapshots. Executors closing over mutable data still see that data, so capture stable values inside the transform if needed.

## Dependencies and publishing

Published package plugins export the same default definition as local ones. The official Promise example declares ESM and `@opencode/plugin` in `dependencies`:

```json
{
  "name": "opencode-acme-plugin",
  "version": "1.0.0",
  "type": "module",
  "exports": { ".": "./src/index.ts" },
  "dependencies": { "@opencode/plugin": "latest" }
}
```

For production, choose and test a package version compatible with the target OpenCode release rather than blindly relying on `latest` (recommendation). Declare additional external libraries in the plugin package's manifest and test the installed artifact. The v2 configuration/build pages show published package dependencies but do **not** promise that a local plugin can import arbitrary root-project dependencies or that v1's `bun install` behavior applies; verify local resolution on the actual target before documenting it as guaranteed.

## Other runtime flavors

- **Effect server plugin:** `import { Plugin } from "@opencode/plugin/effect"`; `Plugin.define({ id, effect: ctx => Effect.gen(function* () { ... }) })`. Install both `@opencode/plugin` and `effect`. Effect operations and callbacks return Effects/Streams; scoped registrations, fibers, and finalizers are released with the plugin `Scope`. Do not paste Promise hook callbacks into an Effect plugin. See [Effect docs](https://opencode.ai/v2/docs/build/plugins/effect).
- **CLI/TUI plugin:** `import { Plugin } from "@opencode/plugin/tui"`; configure CLI-only packages in `cli.json`. `context.client` talks to the connected server; `context.data` holds reactive caches and event listeners; `context.ui`, `context.keymap`, `context.renderer`, and `context.theme` handle terminal UI. A package with both sides can export `.` and `./tui` for automatic CLI loading from active server plugins. Declare OpenTUI/Solid peers for JSX UIs as in the [CLI build docs](https://opencode.ai/v2/docs/build/plugins/cli).
- **RPC:** use `Rpc.define` from `@opencode/plugin/rpc` for typed custom methods/errors/events; register with `ctx.rpc.register`, optionally export an `./rpc` contract, and use `ctx.rpc(contract)` or `client.rpc(contract)` to call it. JSON Schema or Standard Schema can validate RPC payloads. Custom event payloads must be objects; subscriptions are live-only and need cleanup. See [RPC docs](https://opencode.ai/v2/docs/build/plugins/rpc).

Keep OAuth/integration methods under `ctx.integration` and provider inventories under `ctx.provider`. Consult domain-specific documentation and types before implementing credential handling or native HTTP interception.
