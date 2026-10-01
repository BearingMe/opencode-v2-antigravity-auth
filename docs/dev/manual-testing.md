# Manual testing — `/antigravity` account UI

Native quota rendering is tested under Bun; installed host keyboard/auth
behavior still needs this checklist. Assumes at least one account can be added
via `opencode auth login`. Use a disposable test account for destructive
checks — never your real multi-account store.

## Entry and navigation

- [ ] `/antigravity` opens the account list dialog (`Antigravity accounts`
      with saved account emails).
- [ ] `Antigravity accounts` in the command palette opens the same list
      (no duplicate command entries).
- [ ] Arrows move, Enter confirms, Esc cancels at every dialog. Esc from the
      list closes it with no toast and no state change.
- [ ] List footer shows `Add accounts: opencode auth login`.
- [ ] A small `●` beside each email is green for enabled and red for disabled,
      including the selected row. Disabled accounts also show `[disabled]`.
      The shared footer contains the colored enabled/disabled legend and one login
      hint; the login hint is not repeated beside account emails.
- [ ] Search filters accounts; arrows/Enter work with filtered results. No-match
      results cannot select an account. Long lists scroll while retaining the footer.

## Add separation (login adds, `/antigravity` manages)

- [ ] Login shows the required Add/reconnect selection and saved-account
      summary before opening the browser. Ctrl+C opens no browser and writes
      nothing. No Exit option or custom host build is required.
- [ ] Stock host: selecting Add opens consent once. After completion the host exits;
      another login shows the updated count. There is no repeated-add loop.

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

- [ ] `Show quota`: opens one padded `Antigravity quota` screen with themed
      bars per group (`Claude` / `Gemini Pro` / `Gemini Flash`), last-updated
      timestamp, a not-live-updated note, and a refresh-only `refresh ctrl+r` footer.
      Bars fill the available width with aligned percentage/reset columns. Resize
      the terminal: bars relayout, and narrow layouts stack without overflow.
      The header retains clickable `esc`; no duplicate footer Back/Esc appears.
      Saved bars appear immediately, then enabled accounts refresh automatically.
      Unknown groups render `unknown`,
      never `0%`. No submenu: the screen stays open across refreshes.
- [ ] `Refresh quota` via `ctrl+r` on the quota screen: `Refreshing…`
      appears inline, then the bars update in place with no dialog
      closing. Repeat presses during a fetch are ignored (no duplicate fetch).
      Clicking refresh is equivalent. Failures show `Refresh failed — showing last saved values.` inline plus an
      error toast, keep cached values, and stay on the screen.
- [ ] Back from the quota screen (`esc`) returns to the main account list —
      never to a quota submenu. Dismissing the list ends the flow with no toast
      and no state change.
- [ ] Removed actions: no standalone `Refresh quota` and no `Use next` in
      the account menu. (The `select` rotation hint remains available via the
      `antigravity_accounts` agent tool.)
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
      never a success toast. Same for quota: open the quota view for A, delete
      A elsewhere, then refresh — alert (`That account is no longer saved.`)
      and return to the refreshed list.
- [ ] RPC server unavailable (plugin disabled mid-session, invoke via
      palette history): `Antigravity server unavailable...` error toast.
- [ ] Refresh quota with no network: error toast; cached values remain via
      Show quota with `stale` freshness.
- [ ] `ctrl+r` scope: outside the quota view, `ctrl+r` keeps its host
      behavior (session rename); inside the quota view it refreshes. Esc from
      the quota view returns to the account list; Esc from actions closes with
      no toast and no state change.
- [ ] Narrow terminal (~60 cols): text bars wrap/truncate without renderer
      errors.
- [ ] Reset countdown sanity: future resets show `resets in Xh Ym` /
      `resets in Xm` / `resets in <1m`; missing data shows `reset unknown` —
      never a past date presented as upcoming.

## Persistence and packaged install

- [ ] Restart persistence: disable one account, remove another, restart
      opencode, reopen `/antigravity` — same list, flags, selection, and quota
      cache timestamps.
- [ ] Refresh quota successfully, close/reopen, then restart: saved readings
      survive. Offline refresh and empty readings do not erase the saved cache.
- [ ] Disabled-account quota shows saved bars and the refresh-paused message.
- [ ] Plugin reload with quota open closes it without reopening the list.
- [ ] Replacing quota with another host dialog does not reopen the account
      list or clear the replacement. Native backdrop dismissal simply closes;
      the quota's Back/Esc command returns to the list.
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
- Native-renderer tests do not exercise the host's complete dialog stack or
  authentication/browser lifecycle; this checklist covers those boundaries.
