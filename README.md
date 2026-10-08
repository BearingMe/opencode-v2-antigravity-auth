# Antigravity OAuth Plugin for OpenCode V2

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE.md)

Authenticate OpenCode V2 against **Antigravity** (Google's IDE backend) via
OAuth and use Antigravity quota for `gemini-3` / `claude-4.6` models with
your Google credentials. Multi-account rotation, thinking support, and
session recovery included.

> **Maintained V2 port.** This is a fork of
> [`NoeFabris/opencode-antigravity-auth`](https://github.com/NoeFabris/opencode-antigravity-auth)
> (now archived), ported to the OpenCode V2 plugin API. Model requests flow
> through V2's AI SDK hook and the plugin's native engine (auth, transform,
> streaming, quota, rotation, recovery). Account files from earlier installs
> remain in use. Onboarding is `opencode auth login` (one account per run,
> up to 10); management is the `/antigravity` dialog (also
> `Antigravity accounts` in the command palette) over the credential-free
> `AntigravityAccounts` RPC. Server plugins have no toast API, so TUI toasts
> are emitted as plugin logs.

> **First release in preparation.** `opencode-v2-antigravity-auth@0.1.0` is
> not on npm yet. Use a local path below until the package is published; after
> release, use the registry entry shown below. The `auto_update` checker queries
> npm dist-tags and stays silent until publication.

## What you get

- **Gemini 3.6/3.7/3.8 Flash, Gemini 3.1 Pro, Claude Opus/Sonnet 4.6
  Thinking, and GPT-OSS 120B Medium** via Antigravity's Google OAuth
- **Multi-account rotation** across up to 10 Google accounts
- **One Antigravity quota pool** for supported models
- **Gemini thinking variants** for low/medium/high levels where supported
- **Auto-recovery** from interrupted tool calls
- **Model-declared web search** sanitized by the pipeline (no dedicated
  search tool is registered)

> [!CAUTION]
> **Terms of Service warning.** This is an unofficial tool, not endorsed by
> Google. Proxying Antigravity may violate Google's Terms of Service; users
> have reported bans or shadow-bans. You assume all account, legal, and
> technical risk.

## Installation

Until the first npm release, reference a local checkout. In your OpenCode
config (`~/.config/opencode/opencode.json` or `opencode.jsonc`):

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": ["/absolute/path/to/opencode-v2-antigravity-auth"],
}
```

Once `0.1.0` is published, replace the local path with a pinned registry entry:

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": ["opencode-v2-antigravity-auth@0.1.0"],
}
```

Local paths, `file://` URLs, and registry packages with optional `@version`
pins are accepted. The V2 key is `plugins` (plural).

```bash
opencode auth login   # one account per run; repeat to add more (max 10)
```

Then manage saved accounts inside OpenCode with `/antigravity`. The plugin
registers a fixed model catalog — verify with:

```bash
opencode run "Hello" --model=antigravity/antigravity-gemini-3.8-flash
```

## Multi-account in 30 seconds

- Add: `opencode auth login` — choose Add/reconnect before the browser opens
  (re-signing refreshes the same entry in place). Adds one account per command;
  rerun to add another (max 10), or press Ctrl+C to cancel. No custom host needed.
- Manage: `/antigravity` — saved quota bars, refresh-on-open and manual refresh (`ctrl+r`),
  enable/disable, verify with reconnect guidance, confirm-guarded removal.
- Details: [docs/user/accounts-and-quota.md](docs/user/accounts-and-quota.md).

## Configuration (optional)

Create `~/.config/opencode/antigravity.json` (project override:
`.opencode/antigravity.json`). Defaults work for most users.

| Area              | Key options                                                                                                  |
| ----------------- | ------------------------------------------------------------------------------------------------------------ |
| Thinking/recovery | `keep_thinking` (default `false`), `session_recovery` (`true`), `auto_resume` (`false`)                      |
| Rotation          | `account_selection_strategy` (`hybrid`), `scheduling_mode` (`cache_first`), `pid_offset_enabled` (`false`)   |
| Quota protection  | `soft_quota_threshold_percent` (`90`), `quota_refresh_interval_minutes` (`15`)                               |
| Behavior          | `quiet_mode` (`false`), `toast_scope` (`root_only`), `debug` / `debug_tui` (`false`), `auto_update` (`true`) |

Full reference: [docs/user/configuration.md](docs/user/configuration.md).
Schema: `assets/antigravity.schema.json`.

Gemini CLI-only model IDs such as `gemini-2.5-pro` and `gemini-2.5-flash`
are not served through Antigravity OAuth. Use a registered
`antigravity-gemini-*` model instead, or keep using those IDs with an ordinary
Google API-key connection under OpenCode's separate `google` provider.
Antigravity has its own provider and sign-in; this plugin does not change
OpenCode's Google integration. Existing `google/antigravity-*` model
references need the new `antigravity/` provider prefix; saved plugin accounts
remain in place. Verified Gemini preview aliases remain supported.

## Docs

- User: [installation](docs/user/installation.md) ·
  [configuration](docs/user/configuration.md) ·
  [models & variants](docs/user/models-and-variants.md) ·
  [accounts & quota](docs/user/accounts-and-quota.md) ·
  [troubleshooting](docs/user/troubleshooting.md)
- Developer: [docs/dev/README.md](docs/dev/README.md) (architecture,
  storage, RPC/TUI, quota contract, API, testing, manual checklist,
  maintainer ops)
- Normative specs: `docs/specs/00-07` (agent/reviewer source of truth)
- [Changelog](CHANGELOG.md)

## Development

Runtime tests stay beside their source under `src/`. Cross-cutting tests and
smokes live under `test/`; build and repository tooling lives under `scripts/`.
Run `bun run test`, `bun run test:tui`, `bun run typecheck`, and `bun run lint`
before submitting changes. See [developer testing](docs/dev/testing.md) for
the suites and live-test requirements.

## Compatibility

- Works alongside other plugins (oh-my-opencode, DCP). With oh-my-opencode,
  set `"google_auth": false`; list this plugin **before** DCP. No separate
  gemini-auth plugin is needed.
- Debug logs: `OPENCODE_ANTIGRAVITY_DEBUG=1` (file) or `=2`/`=verbose`
  (verbose); `OPENCODE_ANTIGRAVITY_DEBUG_TUI=1` shows logs in the TUI panel
  independently of file logging. See
  [troubleshooting](docs/user/troubleshooting.md).

## Credits

- Original plugin (V1, archived):
  [NoeFabris/opencode-antigravity-auth](https://github.com/NoeFabris/opencode-antigravity-auth)
- [opencode-gemini-auth](https://github.com/jenslys/opencode-gemini-auth)
  by [@jenslys](https://github.com/jenslys)
- [CLIProxyAPI](https://github.com/router-for-me/CLIProxyAPI)

## License

MIT. See [LICENSE](LICENSE). Not affiliated with Google. "Antigravity",
"Gemini", "Google Cloud", and "Google" are trademarks of Google LLC.
