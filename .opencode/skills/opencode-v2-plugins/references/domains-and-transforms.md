# v2 domains and replayable transforms

A domain method (e.g. `ctx.session.get`) performs a read/action. A transform contributes state; a hook intercepts a live operation. Transforms are synchronous callbacks applied in registration order onto a rebuilt value. Later registrations observe earlier changes; reads see registered state, while resource connection/status can lag. Any change, disposal, or `reload()` marks a registry for rebuilding on its next read. Existing read results are not mutated.

```ts
const source = { models: await loadModels() }
const registration = await ctx.provider.transform((editor) => {
  editor.models.set("acme", source.models)
})
source.models = await loadModels()
await ctx.provider.reload() // Replays transforms; does not rerun setup.
await registration.dispose() // Remove this contribution early if needed.
```

Load remote inputs *before* a transform and keep callbacks cheap, deterministic, and side-effect-free. Registration disposal is idempotent and unload disposes remaining registrations. When one domain's source changes, reload its domain; provider changes also invalidate the active model result.

| Intent | Domain / editor |
| --- | --- |
| Add/update provider source, settings, model definitions | `ctx.provider.transform`: `add`, `update`, `remove`, `models.set/update/remove`; inactive providers remain readable |
| Edit active model candidates / choose default | `ctx.model.transform`: `list/get/update/remove`, `default.set`; runs after provider availability and source resolution |
| Add/update integrations or login methods | `ctx.integration.transform`: `update/remove`, `method.update/remove`; `connection.active/resolve` inspect credentials; OAuth/key/command connection operations available |
| Add or modify tools | `ctx.tool.transform`: `namespace/add/update/remove`; synchronous editor; JSON Schema Promise inputs |
| Add a command | `ctx.command.transform`: `add` with `execute({ sessionID, prompt, delivery })` |
| Change agents/default | `ctx.agent.transform`: `update/remove/default` |
| Manage MCP configuration | `ctx.mcp.transform`: `set/update/remove` (including `disabled`); lifecycle reconciles from the result |
| Add/remove references or skills | `ctx.reference.transform`, `ctx.skill.transform` |
| Customize VCS, web search, worktree strategy | `ctx.vcs.transform`, `ctx.websearch.transform`, `ctx.worktree.transform` |

Read APIs include `ctx.provider.list/get`, `ctx.model.list/default`, `ctx.agent.list/get`, `ctx.tool.list`, `ctx.plugin.list`, `ctx.mcp.list`, `ctx.session.get/context/prompt`, and `ctx.storage`. Confirm exact methods and argument shapes in the versioned package. `ctx.generate.text` generates without adding a session/tool call. `ctx.worktree` operates on a project ID and strategies use cancellation; unlike a provider/model transform, a worktree strategy's ownership of existing worktrees persists in inventory.

Provider definitions and per-account credentials are separate concerns: use `ctx.integration.connection.active` plus `sourceConnection` when publishing inventory tied to a specific account. A provider transform changes sources; a model transform edits the complete active-provider candidate set. Avoid mutating immutable source definitions directly; use the editor's update operations.

Tool transforms have more detailed override and snapshot semantics in [the build guide](https://opencode.ai/v2/docs/build/plugins#tools). Integration methods, custom VCS/worktrees, and credential contracts also require the release-matched docs/types; do not infer them from generic editor names.
