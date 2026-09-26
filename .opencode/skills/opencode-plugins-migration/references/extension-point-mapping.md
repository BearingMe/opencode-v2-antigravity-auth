# Map v1 extension points to v2 behavior

This table provides **destinations**, not drop-in aliases. Confirm that the source hook exists in the actual v1 package version and that the destination API exists on the target v2 release. See [official migration guide](https://opencode.ai/v2/docs/build/plugins/migrate-v1).

| v1 implementation | v2 destination | Check when porting |
| --- | --- | --- |
| Plugin function returning a `Hooks` object | Default `Plugin.define({ id, setup(ctx) })` from `@opencode/plugin` | Stable ID, initialization timing, context location, cleanup |
| Plugin options argument | `ctx.options` | Validate unknown option values; preserve defaults |
| `client` SDK calls | Domain methods on `ctx` / V2 `@opencode/client` for external callers | New inputs/outputs and error shapes; `ctx.location` is instance-scoped |
| `event` callback | `ctx.event.subscribe({ signal })` | Async stream, event shape, abort during cleanup |
| `dispose` / module resources | Cleanup function returned by `setup` | Timers, subscriptions, child processes, sockets; registrations dispose automatically |
| `config` | Transform the owned domain (e.g. `ctx.agent`, `ctx.mcp`) | No global mutable config hook; order/replay differ |
| `tool` map (`tool()` / Zod args / string result) | `ctx.tool.transform(editor => editor.add(...))` | JSON Schema input, structured result, synchronous transform, executor signal |
| `tool.definition` | `ctx.tool.transform(...)` | Edit effective tool definition, namespace/override order |
| `provider` | `ctx.provider.transform(...)`, `ctx.model.transform(...)` | Provider source vs full active model inventory; account-scoped source connections |
| `auth` methods / loader | `ctx.integration.transform(...)` and connection APIs | Authentication, refresh, and request routing may need separate v2 components |
| `chat.message` | `ctx.session.hook("prompt", ...)` when modifying user admission | Admission runs once, before attachment/skill resolution; consider `context` if intent was outgoing model context |
| `chat.params` | `ctx.session.hook("context", ...)` | `event.options` uses v2 semantic settings; auxiliary kinds need separate hooks |
| `chat.headers` | `ctx.session.hook("model.request", ...)` or `"http.request"` | Choose model request header vs native HTTP header; provider scope |
| `permission.ask` | `ctx.permission.hook("evaluate", ...)` | Explicit configured deny bypasses hook; effect may start as allow or ask |
| `command.execute.before` | `ctx.command.transform(...)` for owned commands, or prompt hook | No global 1:1 command-before hook; distinguish command invocation from admitted prompt |
| `tool.execute.before` / `.after` | `ctx.tool.hook("execute.before" / "execute.after", ...)` | One mutable event instead of `(input, output)`; after distinguishes completed/error |
| `shell.env` | `ctx.shell.hook("create.before", ...)` | Can alter shell env, command, cwd, timeout |
| `experimental.chat.system.transform` / `.messages.transform` | `ctx.session.hook("context", ...)` | Changes outgoing context, not persisted history; scope auxiliary kinds explicitly |
| `experimental.session.compacting` | `ctx.session.hook("compaction", ...)` | V2 result can replace the compaction model call; compare intended summary semantics |

No direct hook-equivalent is promised for `experimental.compaction.autocontinue`, `experimental.provider.small_model`, or `experimental.text.complete`. Specify the original user-visible behavior and assess v2 session, provider, model, or event APIs before committing to a redesign.

## Typical tool port

```ts
// V2 Promise plugin: use the target release's JSON Schema and result types.
import { Plugin } from "@opencode/plugin"

export default Plugin.define({
  id: "team.greeting",
  async setup(ctx) {
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
        async execute(input) {
          return { content: `Hello ${(input as { name: string }).name}` }
        },
      })
    })
  },
})
```

Promise and Effect plugin callbacks differ. For Effect, consult [v2 Effect docs](https://opencode.ai/v2/docs/build/plugins/effect), rather than adapting the above callback syntax mechanically.
