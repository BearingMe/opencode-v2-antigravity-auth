# Installation

## Requirements

- OpenCode V2 (observed target: v2.0.18; newer V2 hosts should work but the
  compatibility range has not been established — see
  [dev/testing.md](../dev/testing.md))
- A Google account (each login adds one account, up to 10)

## Add the plugin

> **First release in preparation.** Version `0.1.0` is not on npm yet. Until
> publication, install from a local checkout. In your OpenCode config
> (`~/.config/opencode/opencode.json` or `opencode.jsonc`):

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": ["/absolute/path/to/opencode-v2-antigravity-auth"],
}
```

Once `0.1.0` is published, use the pinned registry entry:

```json
"plugins": ["opencode-v2-antigravity-auth@0.1.0"]
```

You can use `@latest` instead if you prefer automatic updates. Local paths and
`file://` URLs continue to work for development.

> OpenCode V2 uses the `plugins` (plural) key. `plugin` (singular) is not
> valid V2 configuration.

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
