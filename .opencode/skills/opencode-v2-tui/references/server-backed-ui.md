# Server-backed UI

TUI plugins do not own server state. Read through `context.client` and
`context.data`; mutate through RPC or the server API. Keep every projection
credential-free.

## Direct client calls

```ts
const location = context.location ?? context.data.location.default()
const res = await context.client.plugin.list({ location })
```

`context.client` is the generated client for the connected server, including
remote servers. Pass the calling `location` on location-scoped calls.

## Typed RPC (preferred for plugin-owned methods)

Define once, implement on the server, call from the TUI:

```ts
// rpc.ts (shared contract)
import { Rpc } from "@opencode/plugin/rpc"
export const Acme = Rpc.define({ id: "acme", methods: { search: { input: {...}, output: {...} } }, events: {...} })
```

```ts
// src/index.ts (server)
import { Plugin } from "@opencode/plugin"
import { Acme } from "./rpc.js"
export default Plugin.define({
  id: "acme.server",
  async setup(ctx) {
    await ctx.rpc.register(Acme, { search: async (input, c) => ({ text: "..." }) })
  },
})
```

```ts
// src/tui.tsx (TUI)
import { Plugin } from "@opencode/plugin/tui"
import { Acme } from "opencode-acme-plugin/rpc"
export default Plugin.define({
  id: "acme.tui",
  async setup(context) {
    const acme = context.client.rpc(Acme)
    const result = await acme.search({ query: "hello" })
  },
})
```

Rules:

- Mutations address durable ids, never list indices. Unknown ids fail closed
  (warning + refresh, never a false success toast).
- Omit absent optionals; never send explicit `undefined`. The host JSON codec
  rejects `undefined` (`InvalidRequestError: Expected JSON value`) even when
  Zod would accept it.
- Keep outputs credential-free: no refresh parts, refresh tokens, or access
  tokens in any TUI-visible shape. Cover with secret-scan tests.
- Distinguish transport failure (server unavailable) from schema failure
  (version mismatch — prompt to update plugin + OpenCode). Keep user toasts
  generic; leave diagnostics in the host log.

## Reactive data + events

```ts
const sessions = context.data.session.list()
const session = context.data.session.get(sessionID)
await context.data.session.sync(sessionID)
context.data.session.invalidate(sessionID)

const stopOne = context.data.on("permission.asked", (event) => {
  context.ui.toast.show({ message: `Permission ${event.data.id}` })
})
const stopAll = context.data.listen(({ details }) => console.log(details.type))
return () => { stopOne(); stopAll() }
```

`list` reads cache; `sync` refreshes; `invalidate` drops. Location collections
(`agent`, `command`, `model`, `provider`, `skill`, `mcp`, ...) share
`list/sync/invalidate` keyed by optional `LocationRef`. Forms are per
`(sessionID, location)` with `reply`/`cancel`.

Return unsubscribers from setup cleanup. A failed `setup` must dispose anything
it already registered before rethrowing.

## What NOT to do from TUI

- No OAuth flows from TUI pages — use the host `opencode auth login` flow.
- No host credential removal/deactivation — the server TUI context exposes no
  raw credential endpoints.
- No long polls inside render. Sync in event handlers or effects, render from cache.
