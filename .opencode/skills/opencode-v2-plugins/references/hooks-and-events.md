# v2 runtime hooks and public events

Hooks intercept a live operation and receive one mutable event; event subscriptions observe the server's public stream. Both are distinct from transforms that build domain state. Hook callbacks execute in registration order, so later hooks see earlier modifications. The returned registration can be disposed; unloading also disposes it.

## Hook selection

| Hook | Timing and effect |
| --- | --- |
| `ctx.session.hook("prompt", ...)` | Once at incoming user prompt admission, before attachment/skill resolution and persistence. Changes to text/files/metadata/delivery become canonical input; retry-safe transformations are important because concurrent admissions may run it more than once. No provider scoping yet. |
| `ctx.session.hook("context", ...)` | Before each agent-loop model call, including continuations; change `system`, `messages`, `tools`, `options` for outgoing request only. |
| `ctx.session.hook("compaction" | "generate" | "title", ...)` | Distinct auxiliary request kinds. `compaction` and `title` can set `result` to bypass the corresponding model call. |
| `ctx.session.hook("model.request", ..., { providerID? })` | Modify model request headers and settings; scope to a provider when needed. |
| `ctx.session.hook("http.request" | "http.response", ...)` | Modify native HTTP exchanges for primary/compaction/title/generate; body streams are one-shot: clone/replace before consuming. |
| `ctx.session.hook("retry", ...)` | Change proposed retry/terminal decision and delay after failure classification, before scheduling; built-in max attempts still applies. |
| `ctx.session.hook("experimental.ws.handshake" | "experimental.ws.send" | "experimental.ws.receive", ...)` | WebSocket connection and frames for applicable providers; HTTP hooks do not see native WebSocket traffic. Experimental contract, verify target release. |
| `ctx.permission.hook("evaluate", ...)` | Revise `allow`/`ask` before execution or prompt; explicit configured `deny` bypasses this hook. |
| `ctx.shell.hook("create.before", ...)` | Mutate shell command, cwd, executable, timeout, environment. |
| `ctx.tool.hook("execute.before" | "execute.after", ...)` | Mutate/inspect tool input before running; after handles successful result or failure (`event.status`). |

`context` does not cover compaction/title/generate. Hooks affecting all request kinds should register each needed kind. Semantic options (`maxTokens`, `temperature`, provider-specific options) differ from raw protocol HTTP body fields; scope provider options by `providerID`. `event.kind` on HTTP/model hooks distinguishes `"primary"`, `"compaction"`, `"title"`, `"generate"`. `retry` is an override of a proposed decision, not a direct account-rotation API.

```ts
await ctx.session.hook("context", (event) => {
  event.system.push({ type: "text", text: "Focus on correctness." })
  event.options.temperature = 0.2
})

await ctx.tool.hook("execute.after", (event) => {
  if (event.status === "completed") {
    event.result = { ...event.result, metadata: { observed: true } }
  }
})
```

For cancellation, pass tool executor `context.signal` or provider callback signals to cancellable I/O. Stopping a session signals cancellation; cooperating work must act on it.

## Public server events

Subscribe via `ctx.event.subscribe({ signal })` (Promise API). Abort on cleanup:

```ts
setup(ctx) {
  const controller = new AbortController()
  void (async () => {
    try {
      for await (const event of ctx.event.subscribe({ signal: controller.signal })) {
        if (event.type === "session.idle") console.log("Session finished")
      }
    } catch (error) {
      if (!controller.signal.aborted) console.error(error)
    }
  })()
  return () => controller.abort()
}
```

The [v2 public event schema](https://opencode.ai/v2/docs/api#schema-V2EventEncoded) defines the available names and payloads; confirm the target release's event union rather than recycling an older event list. Example names in v2 docs include `session.idle`, `config.updated`, and `worktree.updated`. Event observation does not make the event mutable. CLI event listeners use `context.data.on(type, callback)` or `data.listen(callback)` and return unsubscribe functions; Effect plugins use `ctx.event.subscribe()` as a Stream and fork consumers scoped to the plugin. RPC events are separate, live-only custom events with `data` and `location` (see [RPC docs](https://opencode.ai/v2/docs/build/plugins/rpc)).

Main source: [v2 plugin build guide, Hooks and Events](https://opencode.ai/v2/docs/build/plugins#hooks).
