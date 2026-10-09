# Antigravity OAuth for OpenCode V2

[![npm version](https://img.shields.io/npm/v/opencode-v2-antigravity-auth?logo=npm)](https://www.npmjs.com/package/opencode-v2-antigravity-auth)
[![GitHub release](https://img.shields.io/github/v/release/BearingMe/opencode-v2-antigravity-auth?logo=github)](https://github.com/BearingMe/opencode-v2-antigravity-auth/releases)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE.md)

Use supported Gemini, Claude, and GPT-OSS models in OpenCode through Google Antigravity OAuth. Includes account rotation, quota visibility, thinking support, and session recovery.

> **Maintained OpenCode V2 port.** This fork of the now-archived [NoeFabris/opencode-antigravity-auth](https://github.com/NoeFabris/opencode-antigravity-auth) uses OpenCode V2's plugin API and native request engine. Existing Antigravity account files remain in use.

> [!CAUTION]
> **Terms of Service and account risk:** This unofficial project is not endorsed by Google. Proxying Antigravity may violate Google's Terms of Service, and users have reported account restrictions. You assume all account, legal, and technical risk.

## Install

### For people

Requires OpenCode V2 and a Google account. This command installs the plugin to your **global OpenCode configuration**:

```bash
opencode plugin add opencode-v2-antigravity-auth
opencode auth login
```

In the login flow, choose **Antigravity**, then **Add or reconnect an account**. Complete Google's authorization yourself. Each login adds or reconnects one account; run it again to add another, up to 10. Press Ctrl+C to cancel before authorization.

Check the plugin and try a model:

```bash
opencode plugin list
opencode run "Hello" --model=antigravity/antigravity-gemini-3.8-flash
```

The model request uses Antigravity quota. Models register automatically; no model definitions are needed. Open `/antigravity` in OpenCode to manage saved accounts and view quota.

#### Install for one project instead

Add the package to that project's `opencode.json` or `opencode.jsonc`:

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": ["opencode-v2-antigravity-auth"],
}
```

OpenCode V2 uses the plural `plugins` key. The CLI command above is for global installation.

### For AI agents

You can give an agent these bounded instructions. They make the global configuration change explicit and leave sign-in and the first quota-using request to you:

```text
Install opencode-v2-antigravity-auth for OpenCode V2.

1. Check `opencode --version` and confirm the V2 `opencode plugin add` command is available.
2. Explain that `opencode plugin add` changes my global OpenCode configuration. Ask me before proceeding if approval is required.
3. Run `opencode plugin add opencode-v2-antigravity-auth`, then `opencode plugin list` to verify it is listed. Do not change or remove other plugins or settings.
4. Stop before OAuth. Tell me to run `opencode auth login`, choose Antigravity, and complete Google's authorization myself. Never ask me to share an authorization code, redirect URL, password, or token.
5. Do not read, copy, or delete Antigravity account files. Do not send a model request or consume quota unless I explicitly approve it.
6. Report what was installed and whether sign-in or model verification is still needed. If a command fails, show the error and stop rather than changing unrelated configuration.
```

For a project-local install, ask the agent to add the package to the existing `plugins` array in that project's OpenCode config, preserving all other entries. Do not add a second config file or overwrite the user's settings.

## A look inside OpenCode

These screenshots show the login flow, automatic model registration, account management, and grouped quota view. Email addresses are covered in the published images.

| Sign in                                                                                                                                                                                                            | Choose a model                                                                                                                                                                       |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| ![OpenCode login showing the Antigravity add-or-reconnect choice; account identities redacted](https://raw.githubusercontent.com/BearingMe/opencode-v2-antigravity-auth/main/assets/screenshots/redacted/auth.png) | ![OpenCode model picker showing the Antigravity model catalog](https://raw.githubusercontent.com/BearingMe/opencode-v2-antigravity-auth/main/assets/screenshots/redacted/models.png) |

| Manage accounts                                                                                                                                                                      | Check quota                                                                                                                                                                             |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ![Antigravity account list with account identities redacted](https://raw.githubusercontent.com/BearingMe/opencode-v2-antigravity-auth/main/assets/screenshots/redacted/accounts.png) | ![Grouped Antigravity quota dialog with account identity redacted](https://raw.githubusercontent.com/BearingMe/opencode-v2-antigravity-auth/main/assets/screenshots/redacted/quota.png) |

## What you get

- Gemini 3.6/3.7/3.8 Flash, Gemini 3.1 Pro, Claude Opus and Sonnet 4.6 Thinking, and GPT-OSS 120B Medium through Antigravity OAuth
- Rotation across up to 10 Google accounts, using one Antigravity quota pool
- Gemini thinking variants where supported
- Recovery for interrupted tool calls
- Sanitization of model-declared web search; this plugin does not register a separate search tool

See the [model catalog and variants](docs/user/models-and-variants.md) for model IDs and supported options.

## Accounts and quota

Run `opencode auth login` to add or reconnect an account. Use `/antigravity` (or **Antigravity accounts** in the command palette) to enable or disable accounts, verify or remove them, and view quota. Adding accounts is done through login; the dialog manages saved accounts.

Account files contain OAuth refresh tokens and should be treated like passwords. Never share them or include them in screenshots or support requests. See [accounts and quota](docs/user/accounts-and-quota.md) for storage and management details.

## Update

OpenCode V2 manages package plugin updates. Check for this plugin's update, then update only this package:

```bash
opencode plugin check opencode-v2-antigravity-auth
opencode plugin update opencode-v2-antigravity-auth
```

The unversioned install command above tracks the package's latest release. Exact version pins are intentionally skipped by `plugin update`; change a pin in the applicable OpenCode `plugins` configuration when you want to select another version. OpenCode may need to reload the plugin before a running session uses the updated code.

The plugin's optional `auto_update` checker has a known V2 config-key limitation. Use OpenCode's `plugin check` and `plugin update` commands rather than relying on that checker.

## Configuration

Defaults work for most users. Optional settings live in `~/.config/opencode/antigravity.json` (project override: `.opencode/antigravity.json`). Common options:

| Area                  | Options                                                                                                    |
| --------------------- | ---------------------------------------------------------------------------------------------------------- |
| Thinking and recovery | `keep_thinking` (`false`), `session_recovery` (`true`), `auto_resume` (`false`)                            |
| Account rotation      | `account_selection_strategy` (`hybrid`), `scheduling_mode` (`cache_first`), `pid_offset_enabled` (`false`) |
| Quota protection      | `soft_quota_threshold_percent` (`90`), `quota_refresh_interval_minutes` (`15`)                             |
| Logging               | `debug` (`false`), `debug_tui` (`false`)                                                                   |

Full [configuration reference](docs/user/configuration.md) · [JSON schema](assets/antigravity.schema.json).

Gemini CLI-only model IDs such as `gemini-2.5-pro` and `gemini-2.5-flash` are not served through Antigravity OAuth. Use a registered `antigravity-gemini-*` model, or keep those IDs on OpenCode's separate Google API-key provider. Existing `google/antigravity-*` model references need the `antigravity/` provider prefix; saved plugin accounts remain in place.

## Documentation

- **User guides:** [installation](docs/user/installation.md) · [configuration](docs/user/configuration.md) · [models and variants](docs/user/models-and-variants.md) · [accounts and quota](docs/user/accounts-and-quota.md) · [troubleshooting](docs/user/troubleshooting.md)
- **Developers and maintainers:** [developer docs](docs/dev/README.md) · [testing](docs/dev/testing.md) · [maintainer operations](docs/dev/maintainer-operations.md)
- **Normative behavior:** [specifications](docs/specs/07-rule-index.md)
- [Changelog](CHANGELOG.md)

## Compatibility

- Works alongside other plugins, including oh-my-opencode and DCP. With oh-my-opencode, set `google_auth` to `false`; list this plugin before DCP. A separate Gemini-auth plugin is not needed.
- Debug logs: set `OPENCODE_ANTIGRAVITY_DEBUG=1` for file logging or `=2` / `=verbose` for verbose logging. `OPENCODE_ANTIGRAVITY_DEBUG_TUI=1` enables TUI logs independently. See [troubleshooting](docs/user/troubleshooting.md).

## Development

Runtime tests live beside their source under `src/`; cross-cutting tests and smokes live under `test/`. Run `bun run test`, `bun run test:tui`, `bun run typecheck`, and `bun run lint` before submitting changes. See [developer testing](docs/dev/testing.md) for details and live-test requirements.

## Credits

- Original V1 plugin (archived): [NoeFabris/opencode-antigravity-auth](https://github.com/NoeFabris/opencode-antigravity-auth)
- [opencode-gemini-auth](https://github.com/jenslys/opencode-gemini-auth) by [@jenslys](https://github.com/jenslys)
- [CLIProxyAPI](https://github.com/router-for-me/CLIProxyAPI)

## License

MIT. See [LICENSE.md](LICENSE.md). Not affiliated with Google. “Antigravity,” “Gemini,” “Google Cloud,” and “Google” are trademarks of Google LLC.
