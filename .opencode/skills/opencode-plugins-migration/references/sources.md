# Sources and evidence policy

Checked 2026-09-26. Official unversioned v2 pages can change; inspect the package declarations and runtime for a specific pinned release.

## Primary sources

- [OpenCode v1 → v2 migration](https://opencode.ai/v2/docs/migrate-v1/): compatibility boundaries, optional config conversion, terminal config, plugin/API breaking changes and setup checks.
- [Migrate plugins from v1](https://opencode.ai/v2/docs/build/plugins/migrate-v1): entrypoint, extension-point mapping, tools, request hooks, subscriptions, options, dual entrypoint constraints and verification.

## Detail sources when behavior matters

- [v2 build plugins](https://opencode.ai/v2/docs/build/plugins): Promise hooks and domain APIs, transforms, storage, tools and transport.
- [v2 plugin configuration](https://opencode.ai/v2/docs/plugins/): discovery, config order, ID control, CLI management, update and reload.
- [v2 CLI plugins](https://opencode.ai/v2/docs/build/plugins/cli) and [CLI-only configuration](https://opencode.ai/v2/docs/cli/plugins): local/remote terminal boundary.
- [v2 Effect plugins](https://opencode.ai/v2/docs/build/plugins/effect): Effect entrypoint and scoped lifecycle.
- [v2 plugin RPC](https://opencode.ai/v2/docs/build/plugins/rpc): cross-plugin/client methods and custom events.
- [v2 API reference](https://opencode.ai/v2/docs/api): released server request/response and event schemas.
- [v1 plugins](https://opencode.ai/docs/pt-br/plugins/): source API context (unversioned v1 docs); inspect the source release's `@opencode-ai/plugin` types for exact signatures.

For docs sites use Defuddle if available (`npx -y defuddle parse <url> --md`); for raw package declaration files use WebFetch. Compare source and destination release-matched types. Label each migration claim as documented, type-verified, runtime-verified, or a recommendation. Current web docs are not proof that a target binary supports an interface. Preserve any specific release caveat from the source (e.g. v1 object entrypoint requires `1.18.29` or later).
