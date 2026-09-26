# Hooks and event bus in v1

**Different interfaces:** `event` receives `{ event }` and inspects `event.type` for notifications. Named hook functions receive their own typed input and often a mutable output. A docs page listing an event-like string does not prove it arrives through the generic event bus; confirm event types against the target SDK's `Event` union.

## Named hooks

The published `@opencode-ai/plugin` declarations establish the following. `0.15.30` and `1.18.32` are **package versions**, not a guarantee about any particular OpenCode binary. Check both installed versions before use.

| Hook / surface | `0.15.30` | `1.18.32` | Use |
| --- | --- | --- | --- |
| `event` | Yes | Yes | Receive typed SDK bus events |
| `config`, `tool`, `auth` | Yes | Yes | Modify config, register tools, provide auth |
| `chat.message`, `chat.params` | Yes | Yes | Adjust messages and model parameters |
| `permission.ask` | Yes | Yes | Decide permission status |
| `tool.execute.before`, `tool.execute.after` | Yes | Yes | Mutate tool arguments or result before/after execution |
| `shell.env` | No | Yes | Mutate shell environment |
| `chat.headers`, `command.execute.before`, `tool.definition` | No | Yes | Modify request headers, command parts, tool definitions |
| `provider`, `dispose` | No | Yes | Extend models, cleanup on disposal |
| `experimental.session.compacting` | No | Yes | Add compaction context or replace prompt |
| `experimental.chat.messages.transform`, `experimental.chat.system.transform`, `experimental.compaction.autocontinue`, `experimental.text.complete`, `experimental.provider.small_model` | No | Yes | Release-sensitive experimental behavior |

`tool.execute.before` uses `input.tool`, `input.sessionID`, `input.callID`, and `output.args`; mutate `output.args` in place or throw to prevent execution. `tool.execute.after` uses `output.title`, `output.output`, `output.metadata`. `shell.env` uses `input.cwd` and `output.env`. In the newer package, `experimental.session.compacting` accepts `{ sessionID }` and `{ context: string[], prompt?: string }`; setting `prompt` replaces the default prompt and ignores `context` per the v1 guide. The listed `permission.ask` is a hook; do not conflate it with the `permission.asked` event.

## Bus events

The v1 plugins documentation **lists** these event names; their exact payloads and availability are release-dependent. Match on `event.type`, and narrow `event.properties` according to the target SDK types before using them.

| Category | Names listed by v1 docs |
| --- | --- |
| Session | `session.created`, `session.compacted`, `session.deleted`, `session.diff`, `session.error`, `session.idle`, `session.status`, `session.updated` |
| Message | `message.part.removed`, `message.part.updated`, `message.removed`, `message.updated` |
| File | `file.edited`, `file.watcher.updated` |
| Permission | `permission.asked`, `permission.replied` |
| LSP | `lsp.client.diagnostics`, `lsp.updated` |
| Command / installation / server / todo | `command.executed`, `installation.updated`, `server.connected`, `todo.updated` |
| TUI | `tui.prompt.append`, `tui.command.execute`, `tui.toast.show` |

The documentation's event list also shows `tool.execute.before`, `tool.execute.after`, and `shell.env`, **while its examples use them as named hooks**. Treat these as hooks for interception; only claim bus delivery after verifying the target release's SDK event union or runtime behavior. `session.compacted` is a notification; `experimental.session.compacting` runs before generating the compaction summary and is a mutable hook.

## Minimal patterns

```ts
// Notification: event bus
event: async ({ event }) => {
  if (event.type === "session.idle") {
    // react to completion
  }
},

// Interception: named hook
"tool.execute.before": async (input, output) => {
  if (input.tool === "read" && typeof output.args.filePath === "string") {
    // inspect or mutate output.args, or throw to block
  }
},
```

Sources: [v1 plugins docs](https://opencode.ai/docs/pt-br/plugins/), [published 0.15.30 Hooks](https://unpkg.com/@opencode-ai/plugin@0.15.30/dist/index.d.ts), [published 1.18.32 Hooks](https://unpkg.com/@opencode-ai/plugin@1.18.32/dist/index.d.ts).
