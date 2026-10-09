# Installation

## Requirements

- OpenCode V2 (observed target: v2.0.18; newer V2 hosts should work but the
  compatibility range has not been established — see
  [dev/testing.md](../dev/testing.md))
- A Google account (each login adds one account, up to 10)

## Install the plugin

For a global install, let OpenCode add the package to your global
configuration:

```bash
opencode plugin add opencode-v2-antigravity-auth
```

To install for one project instead, add the package to that project's
`opencode.json` or `opencode.jsonc`:

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": ["opencode-v2-antigravity-auth"],
}
```

OpenCode V2 uses the `plugins` (plural) key. Local paths and `file://` URLs
also work for development. The CLI command installs a global package plugin;
it does not add a project-local entry.

## Connect Antigravity

```bash
opencode auth login
```

Choose **Antigravity** in the sign-in list. Each run adds or reconnects **one**
account (up to 10). To add another account, run the command again. Cancelling
the browser flow writes nothing. This is the plugin's own integration and does
not replace or modify OpenCode's Google sign-in.

Before the browser opens, login shows saved accounts and a real
Add/reconnect selection. Only Add starts consent; Ctrl+C cancels without
changes. This uses standard OpenCode, with no custom host build required.
Complete Google consent for Antigravity, then paste either the authorization
code or the full `localhost` redirect URL when prompted.

## Verify

```bash
opencode run "Hello" --model=antigravity/antigravity-gemini-3.8-flash
```

Models are registered automatically by the plugin — no manual model
definitions are required. See [models-and-variants.md](models-and-variants.md)
for the fixed catalog.

The request sends a prompt to Antigravity and uses quota. Ask before running it
if you are installing on someone else's behalf.

## Update

Check for and install an update to this package with OpenCode V2:

```bash
opencode plugin check opencode-v2-antigravity-auth
opencode plugin update opencode-v2-antigravity-auth
```

Exact version pins are skipped by `plugin update`. Change the selected version
in the applicable OpenCode `plugins` configuration to move a pinned install.
For normal package maintenance, prefer OpenCode's plugin commands over the
plugin's optional `auto_update` checker, which has a known V2 config-key
limitation.

## Manage accounts

```text
/antigravity
```

or `Antigravity accounts` in the command palette. Adding accounts stays in
`opencode auth login`; the dialog manages what is already saved
(see [accounts-and-quota.md](accounts-and-quota.md)).

## Next steps

- [configuration.md](configuration.md) — only if defaults do not suit you
- [accounts-and-quota.md](accounts-and-quota.md) — multi-account rotation
- [troubleshooting.md](troubleshooting.md) — when something breaks
