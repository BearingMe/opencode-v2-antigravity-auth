# Accounts and quota

## Adding accounts

```bash
opencode auth login   # run again for each additional account (max 10)
```

Signing in again with an already-saved Google account reconnects it in place
(token refreshes, entry count unchanged, durable id preserved). A genuinely
new account at 10/10 fails cleanly with a capacity message. Cancelling the
browser flow writes nothing.

## Managing accounts (`/antigravity`)

```text
/antigravity
```

or `Antigravity accounts` in the command palette. Every screen is a
host-rendered dialog, select, confirm, alert, or toast. The list footer and
the empty state both point back to `opencode auth login` for adding accounts.

Per-account actions:

- **Show quota** — cached quota text bars
- **Refresh quota** — fresh fetch, then text bars
- **Use next** — rotation hint for the next request, never permanent pinning
- **Enable / Disable** — excluded from rotation while disabled; still shown
  in quota views as `[disabled]`
- **Verify** — healthy accounts report `ok`; blocked accounts show the
  message plus a `Verify:` URL line and reconnect guidance
  (`run opencode auth login and sign in again`), and become
  `[disabled] [verify required]`
- **Remove** — confirm-guarded deletion; `<email> removed.` toast
- **Back** — return to the account list

Stale selections (an account removed in another session) fail closed: a
warning toast and a list refresh, never a success toast. RPC failures show a
generic server-unavailable toast; diagnostics stay in the host log.

The legacy `antigravity_accounts` agent tool (`list`, `check_quota`,
`verify`, `enable`, `disable`, `select`, `delete`, `delete_all`) still works
and shares the same account service. Prefer the dialog for interactive use.

## Quota bars

Each account shows three groups — `claude`, `gemini-pro`, `gemini-flash` —
plus a `status: ... (freshness, checked: ...)` line. Bars are plain text
(`████░░ 60%`); unknown renders as `unknown`, never `0%` (`0%` means
genuinely exhausted). Reset lines read `resets in Xh Ym`, `resets in Xm`,
`resets in <1m`, or `reset unknown`.

The Gemini CLI pool is fetched for routing fallback but intentionally not
folded into these bars — it uses a separate model list and reset semantics,
and merging them would misattribute consumption. Only the Antigravity
`fetchAvailableModels` groups are shown. There are no weekly/five-hour pool
sections: no consumed API field backs such a split (see
[dev/quota-contract.md](../dev/quota-contract.md)).

Quota caching: the presentation prefers a usable fresh check, otherwise the
last good cached reading (timestamped as such). Failed refreshes surface as
`error` without discarding cached values. Per-account presentation timeout
defaults to 12 s (clamped 1–30 s); staleness threshold defaults to 15 min.

## Storage and safety

Accounts live in `antigravity-accounts.json` (v4 schema, file mode `0600`):

- Default location: `~/.config/opencode/antigravity-accounts.json` on all
  platforms (`~` = your home directory, including Windows).
- `OPENCODE_CONFIG_DIR` overrides the config directory.
- Legacy Windows installs under `%APPDATA%\opencode\` are migrated, not
  deleted.

The file contains OAuth refresh tokens — treat it like a password file.
Removed accounts leave credential-free tombstones (bounded at the 50 most
recent deletions) so stale snapshots and background saves cannot resurrect
them; signing in again with the same account clears its tombstone.
See [dev/account-storage.md](../dev/account-storage.md) for the full
contract.

Parallel agents: enable `"pid_offset_enabled": true` in `antigravity.json`
to spread sessions across accounts.

## Token problems

`invalid_grant` (password change, revoked token, long expiry) evicts the
affected account automatically. If logins keep failing, re-authenticate that
account via `opencode auth login`. Deleting the accounts file and starting
over is a last resort, not the first step — it discards every saved account,
tombstones, quota cache, and per-family selection.
