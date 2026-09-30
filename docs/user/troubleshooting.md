# Troubleshooting

Paths below use `~/.config/opencode/` on **all** platforms (Windows
included; `~` = your home directory). `OPENCODE_CONFIG_DIR` overrides it.

| File | Path |
|------|------|
| Main config | `~/.config/opencode/opencode.json(c)` |
| Accounts | `~/.config/opencode/antigravity-accounts.json` |
| Plugin config | `~/.config/opencode/antigravity.json` |
| Debug logs | `~/.config/opencode/antigravity-logs/` |

## First steps

1. Update to the latest plugin version.
2. Check [accounts-and-quota.md](accounts-and-quota.md) — most "quota"
   reports are rate limits, disabled accounts, or stale cache.
3. Enable debug logging, reproduce, then read the log:

```bash
OPENCODE_ANTIGRAVITY_DEBUG=1 opencode     # file logs
OPENCODE_ANTIGRAVITY_DEBUG=2 opencode     # verbose file logs
OPENCODE_ANTIGRAVITY_DEBUG_TUI=1 opencode # TUI log panel (independent of file logs)
```

`debug` and `debug_tui` are independent sinks — either works alone.

## Auth and quota

### Reconnect instead of resetting

Signing in again refreshes an existing account in place. Only delete
`antigravity-accounts.json` as a last resort — it discards every account,
tombstone, quota cache, and selection. Prefer:

```bash
opencode auth login   # reconnects the account you sign in with
```

### `invalid_grant` / revoked token

Password changes and security events revoke refresh tokens. The plugin
evicts the affected account automatically. Re-authenticate it with
`opencode auth login`.

### "All accounts rate-limited" (but quota looks available)

Short rate limits (≤5 s) retry on the same account; longer ones rotate.
If every account is over the soft-quota threshold, the plugin waits for the
earliest reset (capped by `max_rate_limit_wait_seconds`). Try a different
`scheduling_mode`, add accounts, or wait for reset. Deleting the accounts
file does not create quota.

### 403 permission denied (`cloudaicompanion ... generateChat`)

The plugin fell back to a default project that lacks the Gemini for Google
Cloud API. Fix: create/select a GCP project, enable
`cloudaicompanion.googleapis.com`, and set `projectId` on the affected
account(s) in the accounts file (one entry per account).

### Blocked account (`verificationRequired`)

Use `/antigravity` → **Verify**: blocked results show a `Verify:` URL plus
`run opencode auth login and sign in again`. Complete verification, then
re-authenticate.

## Requests and models

### "Model not found"

The plugin registers its models automatically. If a model is missing, check
for another plugin or config that removes/renames `google` provider models,
then restart OpenCode.

### Gemini 3 `400 Unknown name "parameters"`

A tool schema (often from an MCP server) is incompatible with Gemini's
strict validation. Disable MCP servers one by one to find the culprit; tool
names must start with a letter or underscore. The plugin sanitizes schemas
automatically, but it cannot fix every malformed server schema.

### Session errors / interrupted tools

1. Type `continue` to trigger recovery.
2. If blocked, `/undo` to revert, then retry.

Recovery is governed by `session_recovery` / `auto_resume` in
[configuration.md](configuration.md).

## OAuth login issues

Login pastes an authorization code or the full `localhost` redirect URL —
there is no localhost callback listener, so nothing needs to listen on
port 51121. If the browser shows an error page after consent, that is fine:
copy the full URL from the address bar (it contains `?code=...&state=...`)
and paste it into the login prompt.

- **Browser can't open the page (Safari HTTPS-Only):** copy the OAuth URL
  into Chrome/Firefox, or temporarily disable HTTPS-Only mode.
- **WSL2 / SSH / containers:** run `opencode auth login` where the browser
  can reach `localhost`, or copy the redirect URL back manually. No port
  forwarding is required for the plugin itself (there is no listener);
  forwarding only matters if you want the browser's localhost page to load
  instead of copying the URL.
- **Moved machines:** copy `antigravity-accounts.json`, then
  `opencode auth login` if tokens are rejected. Never share the file
  publicly — it holds refresh tokens.

## Plugin interactions

- **oh-my-opencode:** set `"google_auth": false` in `oh-my-opencode.json`
  to avoid conflicting Google auth. For parallel subagents, enable
  `"pid_offset_enabled": true` in `antigravity.json`.
- **DCP (`@tarquinen/opencode-dcp`):** list this plugin **before** DCP.
- **Other gemini-auth plugins:** not needed; this plugin handles Google OAuth.

## Still stuck?

Include in your report: plugin version, `opencode --version`, OS,
model + variant, exact error text, and relevant debug-log sections
(`antigravity-logs/`). Omit tokens — refresh tokens and access tokens must
never be pasted into issues. See also
[dev/manual-testing.md](../dev/manual-testing.md) for the states the
maintainers verify by hand.
