# Sources, verification, and version limits

Checked 2026-09-26. The user's starting URL, [OpenCode v1 plugin docs (Portuguese)](https://opencode.ai/docs/pt-br/plugins/), displays a **“New OpenCode v2 is now available”** banner and points to `/v2/docs/` separately. Treat `/docs/` as the v1 documentation site, not a pinned historical snapshot. The docs edit link points to the repository's `dev` branch; check a release-matched package before using exact signatures.

## Primary documentation

- [Plugins: creation, discovery, dependencies, ordering, events, examples](https://opencode.ai/docs/pt-br/plugins/)
- [Config: locations, formats, merge precedence, plugin configuration](https://opencode.ai/docs/pt-br/config/)
- [Custom tools: naming, schemas, context, tool collision](https://opencode.ai/docs/pt-br/custom-tools/)
- [SDK: logging, sessions, TUI, event subscription](https://opencode.ai/docs/pt-br/sdk/)

For docs pages, use Defuddle where available (`bunx defuddle parse <url> --md` or `npx -y defuddle parse <url> --md`). For package declarations or raw `.md` files, use WebFetch. Check the version in the published package and the installed OpenCode runtime rather than relying only on the documentation update date.

## Published package contracts checked

| Package | Evidence | Important observation |
| --- | --- | --- |
| `@opencode-ai/plugin@0.15.30` | [index.d.ts](https://unpkg.com/@opencode-ai/plugin@0.15.30/dist/index.d.ts), [tool.d.ts](https://unpkg.com/@opencode-ai/plugin@0.15.30/dist/tool.d.ts) | `PluginInput` and core hooks exist; no `shell.env` or compaction hook in the checked types; tool execution returns `Promise<string>` and tool context has no `directory`/`worktree`. |
| `@opencode-ai/plugin@1.18.32` | [index.d.ts](https://unpkg.com/@opencode-ai/plugin@1.18.32/dist/index.d.ts), [tool.d.ts](https://unpkg.com/@opencode-ai/plugin@1.18.32/dist/tool.d.ts) | Adds many named hooks, tool-context fields, and richer tool returns. These types import some SDK types from `@opencode-ai/sdk/v2`; that import alone does not turn this guide into v2 documentation. |

The local `.opencode/package.json` currently depends on `@opencode-ai/plugin@1.18.32`, while this repo's root `package.json` declares `^0.15.30`. Those are distinct dependency scopes; neither alone identifies the running OpenCode binary. Inspect the requested target before choosing which API to present.

## Claim labels for future research

- **Documented:** explicitly stated on an official v1 docs page, but unversioned and subject to updates.
- **Type-verified:** present in the linked published package's declaration, not proof the target runtime dispatches it.
- **Runtime-verified:** confirmed on the specific installed or tagged OpenCode runtime. No runtime dispatch has been independently tested for this reference bundle.
- **Recommendation:** engineering guidance, not an OpenCode guarantee (e.g., restart after load-time changes, pin dependency versions, avoid duplicate registrations).

When sources disagree, record the exact versions and prefer a matching runtime implementation plus package types for the user's version; say what is still uncertain. Do not claim that every name in the docs' “Events” list is emitted on the generic event bus.
