# Manual testing — `/antigravity` account UI

The TUI dialog/toast flow is not driven in automated tests, so verify it
here. Assumes the plugin is installed and at least one account can be added
via `opencode auth login`. Use a disposable test account for destructive
checks — never your real multi-account store.

## Entry and navigation

- [ ] `/antigravity` opens the account list dialog (`Antigravity accounts`
  with saved account emails).
- [ ] `Antigravity accounts` in the command palette opens the same list
  (no duplicate command entries).
- [ ] Arrows move, Enter confirms, Esc cancels at every dialog. Esc from the
  list closes it with no toast and no state change.
- [ ] List footer/placeholder shows `Add accounts: opencode auth login`.

## Add separation (login adds, `/antigravity` manages)

- [ ] Empty state with no saved accounts: alert pointing to
  `opencode auth login` (no crash, no empty select).
- [ ] Repeated login with the same Google account reconnects: still one
  entry, quota works, durable id preserved.
- [ ] Already-saved account at 10/10 reconnects instead of failing (count
  stays 10, no capacity error for the duplicate).
- [ ] Genuinely new account at 10/10 fails cleanly with the capacity
  message; pool unchanged.
- [ ] Cancelling the browser OAuth flow writes nothing (no entry, no
  selection change, pool file untouched).

## Management actions (per account)

- [ ] `Show quota`: cached bars for `claude` / `gemini-pro` / `gemini-flash`
  plus `status: ... (freshness, checked: ...)`. Unknown groups render
  `unknown`, never `0%`.
- [ ] `Refresh quota`: fresh fetch, updated `checked:` timestamp; failures
  show an error toast and keep the actions dialog open.
- [ ] `Use next`: success toast (`... will be tried next (rotation hint, not
  permanent pinning).`) and return to the list — no permanent pinning.
- [ ] Disable then Enable: `... disabled.` / `... enabled.` toasts; the
  one-liner gains/loses `[disabled]`.
- [ ] `Verify` on a healthy account: alert with the `ok` result.
- [ ] `Verify` on a blocked account: alert with the message, a
  `Verify: <url>` line, and `run opencode auth login and sign in again`;
  the account becomes `[disabled] [verify required]`.
- [ ] `Remove` with Cancel: confirm dialog; Cancel returns to actions, the
  account stays saved.
- [ ] `Remove` with Remove: `<email> removed.` toast; list refreshes without
  the account.
- [ ] `Back` returns to the list with no toast.

## Failure and edge states

- [ ] Stale target: open actions for A, delete A elsewhere, then act on A —
  warning toast (`That account is no longer saved. The list will refresh.`),
  never a success toast.
- [ ] RPC server unavailable (plugin disabled mid-session, invoke via
  palette history): `Antigravity server unavailable...` error toast.
- [ ] Refresh quota with no network: error toast; cached values remain via
  Show quota with `stale` freshness.
- [ ] Narrow terminal (~60 cols): text bars wrap/truncate without renderer
  errors.
- [ ] Reset countdown sanity: future resets show `resets in Xh Ym` /
  `resets in Xm` / `resets in <1m`; missing data shows `reset unknown` —
  never a past date presented as upcoming.

## Persistence and packaged install

- [ ] Restart persistence: disable one account, remove another, restart
  opencode, reopen `/antigravity` — same list, flags, selection, and quota
  cache timestamps.
- [ ] Packaged install: `npm pack` (or the published tarball) in a scratch
  config with `OPENCODE_CONFIG_DIR` on a temp dir, then `/antigravity` with
  zero accounts — empty-state alert with the login hint; `opencode auth
  login` adds an account that appears in the list. This confirms `./tui`
  and `./rpc` resolve from `dist/`. On Windows also point `APPDATA` at a
  temp dir (legacy fallback); on Linux/macOS point `XDG_CONFIG_HOME` at a
  temp dir. Delete the temp dirs afterwards.

## Known limitations (do not file as regressions)

- Host credential-store sync: open decision, needs user approval — not
  implemented. Plugin tombstones cover the plugin store only.
- Automated dialog/toast driving is out of scope by design; this checklist
  is its coverage.
