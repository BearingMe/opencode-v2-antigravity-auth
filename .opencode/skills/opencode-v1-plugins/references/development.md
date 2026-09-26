# Developing a v1 plugin

Sources and version boundaries: [sources.md](sources.md). This is a guide, not a substitute for the installed release's declarations.

## Entry point

A plugin module exports one or more functions. The v1 docs demonstrate a named export. For a TypeScript local plugin:

```ts
import type { Plugin } from "@opencode-ai/plugin"

export const ExamplePlugin: Plugin = async ({ client, project, directory, worktree, $ }) => {
  await client.app.log({
    body: { service: "example-plugin", level: "info", message: "Plugin initialized" },
  })

  return {
    event: async ({ event }) => {
      if (event.type === "session.idle") {
        await client.app.log({
          body: { service: "example-plugin", level: "info", message: "Session idle" },
        })
      }
    },
  }
}
```

`PluginInput` in both checked package versions contains `client`, `project`, `directory`, `worktree`, and Bun's `$`. `Plugin` returns `Promise<Hooks>`. The docs' demonstration of `console.log` at startup is illustrative; their logging guidance prefers `client.app.log()` for structured logs.

## Custom tools

Declare tools inside `tool` with `tool()` and `tool.schema` (Zod):

```ts
import { tool } from "@opencode-ai/plugin"
import type { Plugin } from "@opencode-ai/plugin"

export const GreetingPlugin: Plugin = async () => ({
  tool: {
    greet: tool({
      description: "Greet a person by name",
      args: { name: tool.schema.string().describe("Person's name") },
      async execute(args) {
        return `Hello, ${args.name}`
      },
    }),
  },
})
```

Plugin tools with the same name as built-ins take precedence; use distinct names unless replacing a tool intentionally. This differs from standalone tools in `.opencode/tools/`, whose filename/export naming is documented separately. The `0.15.30` type's tool context includes `sessionID`, `messageID`, `agent`, `abort`, and returns a string. `1.18.32` additionally types `directory`, `worktree`, `metadata()`, `ask()`, and a richer result. Check the installed type before using these later fields.

## Auth and provider integrations

The package types declare an `auth` object with a `provider`, optional `loader`, and `methods` (OAuth or API-key). The OAuth `authorize()` result chooses `method: "auto"` with a no-argument callback or `method: "code"` with `callback(code)`. Successful callbacks return credentials in one of the typed forms; `loader` may return provider options including a request `fetch` override for integration-specific routing. This is a sensitive integration: follow the release-matched `AuthHook`/SDK `Auth` contracts, preserve request cancellation, scope interception to intended URLs, and do not print credentials. The repository's `src/plugin.ts` is one implementation example, not an API specification.

For other extensions, check the installed `Hooks` interface before using `config`, `chat.*`, `permission.ask`, `provider`, or experimental hooks. The v1 `1.18.32` package also declares `dispose`, `provider`, and optional plugin options; the checked `0.15.30` package does not. Avoid importing from `@opencode-ai/sdk/v2` yourself merely because later v1 plugin declarations import some types from it.

## Engineering practices

- Keep startup initialization bounded; avoid blocking every session on unrelated network calls.
- Handle expected failures at their boundary; preserve enough context in structured logs to diagnose errors without exposing tokens.
- Make notification handlers idempotent or debounce them when one action generates repeated events. Filter on the relevant session ID when operating across child sessions.
- Prefer the injected SDK client for OpenCode operations; use the injected `$` only for necessary OS commands.
- Use `context.directory` for session paths when supported by the target tool type, `worktree` for git-root-relative paths, and `context.abort` for cancellable tool work.
- Add focused tests for behavior that transforms requests, mutates tool args, or handles failure/retry. Typecheck against the same plugin version used by the target runtime.

Official guides: [v1 plugins](https://opencode.ai/docs/pt-br/plugins/), [v1 custom tools](https://opencode.ai/docs/pt-br/custom-tools/), [v1 SDK](https://opencode.ai/docs/pt-br/sdk/).
