# Task 6 manual checklist — `/antigravity` account UI

Live exercises for the user on Windows CLI v2.0.18. The TUI dialog/toast
flow is not driven in automated tests, so verify it here. Assumes the plugin
is installed (`"plugin": ["opencode-antigravity-auth@..."]`) and at least one
account can be added via `opencode auth login`.

## Entry and navigation

- [ ] `/antigravity` slash command opens the account list dialog.
  Expected: dialog titled `Antigravity accounts` listing saved account emails.
- [ ] `Antigravity accounts` in the command palette opens the same list.
  Expected: identical list; no duplicate command entries.
- [ ] Keyboard: arrows move selection, Enter confirms, Esc cancels at every
  dialog. Expected: Esc from the list closes it with no toast and no state
  change.
- [ ] Footer hint visible on the list dialog.
  Expected: `Add accounts: opencode auth login` in the list footer/placeholder.

## Add separation (login adds, `/antigravity` manages)

- [ ] Empty state: with no saved accounts, `/antigravity` shows an alert.
  Expected: alert pointing to `opencode auth login`; no crash, no empty select.
- [ ] Repeated login with the same Google account reconnects.
  Expected: still one entry for that email; quota works; durable id preserved
  (selection and per-account state survive).
- [ ] Login with an already-saved account when the pool is full (10/10)
  reconnects instead of failing. Expected: token refreshes in place, count
  stays 10, no `Maximum of 10` error for the duplicate.
- [ ] Login with a genuinely new account at 10/10 fails cleanly.
  Expected: `Maximum of 10 Antigravity accounts reached`; pool unchanged.
- [ ] Cancelling the browser OAuth flow writes nothing.
  Expected: no new account, no selection change, pool file untouched.

## Management actions (per account)

- [ ] `Show quota`: opens cached quota text bars.
  Expected: `claude` / `gemini-pro` / `gemini-flash` lines with bars plus a
  `status: ... (freshness, checked: ...)` line. Unknown groups render
  `unknown`, never `0%` (0% means genuinely exhausted).
- [ ] `Refresh quota`: fetches fresh quota, then shows bars.
  Expected: updated `checked:` timestamp; failures show an error toast and
  keep the actions dialog open.
- [ ] `Use next`: rotation hint. Expected: success toast
  (`... will be tried next (rotation hint, not permanent pinning).`) and a
  return to the list — no permanent pinning.
- [ ] Disable then Enable. Expected: `... disabled.` / `... enabled.` toasts;
  list one-liner gains/loses `[disabled]`.
- [ ] `Verify` on a healthy account. Expected: alert with `ok: ...` result.
- [ ] `Verify` on a blocked account. Expected: alert showing the message plus
  a `Verify: <url>` line and `run opencode auth login and sign in again`
  guidance; account becomes `[disabled] [verify required]`.
- [ ] `Remove` with Cancel. Expected: confirm dialog; Cancel returns to the
  actions dialog; account still saved.
- [ ] `Remove` with Remove. Expected: `<email> removed.` toast; list refreshes
  without the account.
- [ ] `Back` returns to the account list. Expected: list re-opens, actions
  dialog closes, no toast.

## Failure and edge states

- [ ] Stale target: open actions for account A, delete A via another session
  (or `delete_all` via the legacy tool), then act on A.
  Expected: warning toast `That account is no longer saved. The list will
  refresh.` — never a success toast.
- [ ] RPC server unavailable (e.g. plugin disabled mid-session, then invoke
  via palette history). Expected: error toast `Antigravity server
  unavailable. Restart opencode or check the plugin installation...`.
- [ ] Refresh quota with no network (disconnect, then Refresh quota).
  Expected: error toast; cached values remain visible via Show quota with
  `stale` freshness rather than disappearing.
- [ ] Narrow terminal layout (shrink width to ~60 cols, open list + quota).
  Expected: text bars wrap or truncate without breaking the dialog; no
  renderer errors.
- [ ] Quota reset countdown sanity. Expected: future resets show
  `resets in Xh Ym` / `resets in Xm` / `resets in <1m`; missing data shows
  `reset unknown` — never a date in the past presented as upcoming.

## Persistence and packaged install

- [ ] Restart persistence: disable an account, remove another, restart
  opencode, reopen `/antigravity`. Expected: same list, same flags, same
  selection; quota cache timestamps preserved.
- [ ] Packaged install: `npm pack` (or install the published tarball) in a
  scratch config with `OPENCODE_CONFIG_DIR` pointed at a temp dir, then
  `/antigravity` with zero accounts. Expected: empty-state alert with the
  login hint; `opencode auth login` adds an account and it appears in the
  list. (Confirms `./tui` and `./rpc` export entries resolve from `dist/`.)
  Isolate the account store too: `OPENCODE_CONFIG_DIR` covers the plugin
  store, but on Windows also point `APPDATA` at a temp dir (legacy
  `%APPDATA%\opencode` fallback), and on Linux/macOS point
  `XDG_CONFIG_HOME` at a temp dir (sibling paths read it directly).
  Delete the temp dirs afterwards. Use a disposable test account only —
  never your real multi-account store.

## Known limitations (do not file as regressions)

- Tombstone/host credential-store sync: decision open, needs user approval —
  not implemented (Task 2 remainder).
- Full dialog/toast driving is untested in automation by design; this
  checklist is its coverage (see `docs/antigravity-tui.md`).
