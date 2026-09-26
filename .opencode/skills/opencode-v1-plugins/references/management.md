# Installing and managing v1 plugins

Sources and qualifications: [sources.md](sources.md).

## Discovery and configuration

| Scope | Local files, automatically loaded | npm config |
| --- | --- | --- |
| Project | `.opencode/plugins/*.js` or `*.ts` | Project `opencode.json` → `plugin` array |
| User | `~/.config/opencode/plugins/*.js` or `*.ts` | `~/.config/opencode/opencode.json` → `plugin` array |

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["opencode-helicone-session", "@my-org/custom-plugin"]
}
```

The v1 docs list this load order: global config, project config, global plugin directory, project plugin directory. All registered hooks execute sequentially. npm packages with the same **name and version** are loaded once, while a local file and npm package with similar names both load. Diagnose duplicate callbacks by checking all four sources. Do not assume a config override disables a discovered local file.

The v1 configuration guide says JSON/JSONC configurations are merged with later sources taking precedence on conflicting keys. It also documents `OPENCODE_CONFIG` and `OPENCODE_CONFIG_DIR` for alternate config locations; check the actual release when these are relevant. Do not infer array merge semantics or deletion behavior from generic object-merge wording.

## Dependencies

- An npm plugin is installed with Bun at startup; the v1 docs specify cache storage at `~/.cache/opencode/node_modules/`.
- A local plugin is loaded directly; put third-party dependencies in its scope's configuration directory package file (e.g. `.opencode/package.json` for project scope). The v1 docs say OpenCode runs `bun install` at startup for this directory.
- TypeScript authors can import `Plugin` and `tool` from `@opencode-ai/plugin`; check the installed package version before using release-specific APIs.
- The docs do not guarantee that a local plugin's project-root `package.json` dependencies will be installed into `.opencode/`. Prefer the documented config-directory package file or an npm-distributed plugin.

## Routine management

To add: choose one source, add the file or package reference, ensure dependencies resolve, and restart OpenCode. To remove: delete the intended config entry or local plugin file, check the other sources for duplicates, and restart. To upgrade or downgrade: adjust the package spec/dependencies appropriate to that scope and verify startup and typed hooks on the target runtime. These are operational recommendations; the v1 docs establish startup loading and installation but do **not** specify a dedicated plugin management CLI, reliable cache-invalidation procedure, or semver update policy. Avoid promising that editing a running plugin is hot-reloaded.

When startup fails or a hook does not fire, confirm: runtime version, actual config location, whether the file is inside `plugins/`, named export/function shape, package installation errors, matching types, event name vs hook name, and logs. Use a minimal plugin and focused log entry to isolate registration from business logic. See [hooks-and-events.md](hooks-and-events.md).

Official guides: [v1 plugins](https://opencode.ai/docs/pt-br/plugins/), [v1 config](https://opencode.ai/docs/pt-br/config/).
