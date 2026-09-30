# Installation

## Requirements

- OpenCode V2 (observed target: v2.0.18; newer V2 hosts should work but the
  compatibility range has not been established — see
  [dev/testing.md](../dev/testing.md))
- A Google account (each login adds one account, up to 10)

## Add the plugin

> **Not yet published.** Until the first npm release, install from a local
> checkout. In your OpenCode config (`~/.config/opencode/opencode.json` or
> `opencode.jsonc`):

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": ["/absolute/path/to/opencode-v2-antigravity-auth"]
}
```

Local paths and `file://` URLs work; registry packages with optional
`@version` pins will work once published. After the first release this
becomes `"plugins": ["opencode-v2-antigravity-auth@latest"]`.

> OpenCode V2 uses the `plugins` (plural) key. `plugin` (singular) is not
> valid V2 configuration.

## Connect Google

```bash
opencode auth login
```

Each run adds or reconnects **one** account (up to 10). To add another
account, run the command again. Cancelling the browser flow writes nothing.

The login step shows the current pool (`Saved accounts: N/10`), a
one-account-per-login note, and a pointer to `/antigravity` for management.
Complete Google sign-in, then paste either the authorization code or the full
`localhost` redirect URL when prompted.

## Verify

```bash
opencode run "Hello" --model=google/antigravity-gemini-3-flash
```

Models are registered automatically by the plugin — no manual model
definitions are required, although you may still declare them explicitly
(see [models-and-variants.md](models-and-variants.md)).

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
