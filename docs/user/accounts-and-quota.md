# Accounts and quota

## Adding accounts

```bash
opencode auth login   # select Antigravity; add or reconnect an account (max 10)
```

Before opening the browser, login shows saved accounts and an interactive
**Add or reconnect an account** selection. Only Add/reconnect starts
Antigravity authorization. At 10/10 the action is labeled **Reconnect a saved
account**. Press Ctrl+C to cancel before authorization without changing accounts.
Stock OpenCode completes one account per command; rerun login to add another.
No custom host build or login-menu patch is needed. This is the plugin's own
OAuth integration; OpenCode's Google integration is left unchanged.

Signing in again with an already-saved account reconnects it in place
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

Each email has a small colored `●`: green means enabled for rotation, red
means disabled (not quota or connection health). Disabled rows also show
`[disabled]`. A shared footer explains the dots and shows the login hint once.
Search filters saved accounts; arrows select, Enter opens actions, and Esc closes.

Per-account actions:

- **Show quota** — saved bars appear first, then refresh automatically on
  opening. `ctrl+r` or clicking **refresh** updates them again with inline
  `Refreshing…` feedback. `esc` returns directly to the account list.
- **Enable / Disable** — excluded from rotation while disabled; still shown
  in quota views as `[disabled]`
- **Verify** — healthy accounts report `ok`; blocked accounts show the
  message plus a `Verify:` URL line and reconnect guidance
  (`run opencode auth login and sign in again`), and become
  `[disabled] [verify required]`
- **Remove** — confirm-guarded deletion; `<email> removed.` toast
- **Back** — return to the account list

The legacy `antigravity_accounts` agent tool (`list`, `check_quota`,
`verify`, `enable`, `disable`, `select`, `delete`, `delete_all`) still works
and shares the same account service, including `select` (rotation hint).
Prefer the dialog for interactive use.

Stale selections (an account removed in another session) fail closed: a
warning toast and a list refresh, never a success toast. RPC failures show a
generic server-unavailable toast; diagnostics stay in the host log.

## Quota bars

The quota dialog shows Antigravity's grouped **Gemini Models** and
**Claude and GPT models** pools, each with separate weekly and five-hour
bars. Percentages use two decimal places; full buckets say `available`,
and other known buckets show when they refresh (including multi-day weekly
countdowns). Unknown values remain unknown, never `0%` (`0%` means genuinely
exhausted).

The weekly/grouped reading comes from Antigravity's `retrieveUserQuotaSummary`
endpoint; its explicit window labels are used rather than inferred. If that
summary is unavailable, the dialog labels and displays the older per-model
`claude` / `gemini-pro` / `gemini-flash` rows as a fallback. See the
[quota contract](../dev/quota-contract.md) for sources and unknown semantics.

The medium-sized dialog uses accent group names with muted member names inline.
Weekly and five-hour rows are adjacent, with compact bars, aligned percentages,
and muted time-until-reset values. Narrow terminals stack the columns. The
dialog fits its content and only scrolls when space is limited. Resizing updates
the layout without fetching quota. The timestamp and **refresh ctrl+r** share
one footer row when they fit, with a scroll hint only when needed; the header's
**esc** control and keyboard Esc return to the account list.

Grouped and per-model readings have independent caches and timestamps. Failed
refreshes keep the last good reading and mark grouped values as saved/stale
when applicable. Successful readings survive visits and restarts. A refresh in
progress ignores repeat requests. Per-account presentation timeout defaults to
12 s (clamped 1–30 s); staleness threshold defaults to 15 min.

The dialog refreshes when opened and does not poll while it remains open; press
`ctrl+r` to refresh again. Disabled accounts retain saved readings but do not
refresh until enabled.

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
