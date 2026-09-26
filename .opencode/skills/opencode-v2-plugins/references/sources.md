# Sources and version discipline

Reviewed 2026-09-26. These are the official **v2** pages; links may update after this review and are not a pinned release snapshot.

| Area | Source |
| --- | --- |
| Configuration/discovery/CLI management/reload | [Configure plugins](https://opencode.ai/v2/docs/plugins/) |
| Promise API, lifecycle, domain transforms, hooks, event stream, publishing | [Build plugins](https://opencode.ai/v2/docs/build/plugins) |
| Effect `Scope`, callbacks, dependencies | [Effect plugins](https://opencode.ai/v2/docs/build/plugins/effect) |
| Terminal context, UI and TUI exports | [Build CLI plugins](https://opencode.ai/v2/docs/build/plugins/cli) |
| CLI-only config and auto-loading | [Configure CLI plugins](https://opencode.ai/v2/docs/cli/plugins) |
| Custom methods/events, validation, subscriptions | [Plugin RPC](https://opencode.ai/v2/docs/build/plugins/rpc) |
| Public event union and schemas | [API reference: V2EventEncoded](https://opencode.ai/v2/docs/api#schema-V2EventEncoded) |

Use Defuddle for documentation pages if available (`npx -y defuddle parse <url> --md`); use WebFetch for raw markdown/types. For an exact signature, check the installed target `@opencode/plugin` declarations and OpenCode v2 runtime release. In particular, Promise and Effect plugin signatures may differ or evolve independently; cite the page and release when presenting type-level claims. The enormous API page is best used for targeted schema lookup rather than copying all events into this skill.

The v2 config/build guides document package installation and package manifests, but do not establish v1-style implicit installation of arbitrary dependencies from `.opencode/package.json` for local v2 plugins. Treat local dependency resolution as release-sensitive until tested or confirmed by release-matched source. When documentation and a target build disagree, report the mismatch rather than claiming an unversioned page is authoritative for every release.
