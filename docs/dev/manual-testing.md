# Manual testing — `/antigravity` account UI

Native quota rendering is tested under Bun; installed host keyboard/auth
behavior still needs this checklist. Assumes at least one account can be added
via `opencode auth login`. Use a disposable test account for destructive
checks — never your real multi-account store.

## Entry and navigation

- [x] `/antigravity` opens the account list dialog (`Antigravity accounts`
      with saved account emails).
- [x] `Antigravity accounts` in the command palette opens the same list
      (no duplicate command entries).
- [x] Arrows move, Enter confirms, Esc cancels at every dialog. Esc from the
      list closes it with no toast and no state change.
- [x] List footer shows `Add accounts: opencode auth login`.
- [x] A small `●` beside each email is green for enabled and red for disabled,
      including the selected row. Disabled accounts also show `[disabled]`.
      The shared footer contains the colored enabled/disabled legend and one login
      hint; the login hint is not repeated beside account emails.
- [x] Search filters accounts; arrows/Enter work with filtered results. No-match
      results cannot select an account. Long lists scroll while retaining the footer.

## Add separation (login adds, `/antigravity` manages)

- [x] Login shows the required Add/reconnect selection and saved-account
      summary before opening the browser. Ctrl+C opens no browser and writes
      nothing. No Exit option or custom host build is required.
- [x] Stock host: select Antigravity, then Add opens consent once. After
      completion the host exits; another login shows the updated count. There
      is no repeated-add loop.

- [x] Empty state with no saved accounts: alert pointing to
      `opencode auth login` (no crash, no empty select).
- [x] Repeated login with the same Google account reconnects: still one
      entry, quota works, durable id preserved.
- [x] Antigravity login registers under its own integration; Google provider,
      Google sign-in methods, and active Google connections remain unchanged.
- [ ] Existing `google/<model>` selections for Antigravity models are migrated
      to `antigravity/<model>`; ordinary Google API-key models retain their route.
- [ ] Already-saved account at 10/10 reconnects instead of failing (count
      stays 10, no capacity error for the duplicate).
- [ ] Genuinely new account at 10/10 fails cleanly with the capacity
      message; pool unchanged.
- [ ] Cancelling the browser OAuth flow writes nothing (no entry, no
      selection change, pool file untouched).

## Management actions (per account)

- [ ] `Show quota`: opens one padded `Antigravity quota` screen with grouped
      Gemini and Claude/GPT sections, each with weekly and five-hour bars,
      inline muted member names, two-decimal percentages, and reset/available
      text. The dialog is medium-sized; section names use accent and each
      group's Weekly/Five-hour rows retain the intended breathing room. Timestamp
      and `refresh ctrl+r` share a footer row when they fit. If grouped summary is
      unavailable, it explicitly labels the legacy per-model bars as a fallback.
      At 80x24, the footer and any overflow hint stay visible while quota content
      scrolls as needed. Resize: narrow layouts
      wrap without clipping percentages or overlapping text.
      Bold labels, unbracketed bars (at most 20 cells), base-text percentages,
      and muted durations share each row. Quota rows have a smaller gap than
      provider groups; the footer is distinctly separated from the final row.
      The dialog ends just below the footer, without a large empty bottom area.
      Header/body/footer metadata share the same left inset; refresh is on the right.
      The header retains clickable `esc`; no duplicate footer Back/Esc appears.
      Saved bars appear immediately, then enabled accounts refresh automatically.
      Unknown windows render `unknown`, never `0%`. No submenu: the screen stays
      open across refreshes.
- [ ] `Refresh quota` via `ctrl+r` on the quota screen: `Refreshing…`
      appears inline, then the available bars update in place with no dialog
      closing. Repeat presses during a fetch are ignored (no duplicate fetch).
      Clicking refresh is equivalent. Partial failures show source-specific
      inline status and keep cached values. Overall quota errors also show an
      error toast and stay on the screen. A successful grouped summary still
      updates even if the per-model probe failed.
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
- [ ] Refresh quota with no network: error toast; cached grouped and per-model
      values remain visible with stale/error status.
- [ ] `ctrl+r` scope: outside the quota view, `ctrl+r` keeps its host
      behavior (session rename); inside the quota view it refreshes. Esc from
      the quota view returns to the account list; Esc from actions closes with
      no toast and no state change.
- [ ] Narrow terminal (~60 cols): text bars wrap/truncate without renderer
      errors.
- [ ] Reset countdown sanity: grouped buckets show `Refreshes in Xh Ym` /
      `Refreshes in Xm` / `Refreshes now`; full buckets say `Quota available`,
      unknown values stay unknown, and no past date is presented as upcoming.

## Persistence and packaged install

- [ ] Restart persistence: disable one account, remove another, restart
      opencode, reopen `/antigravity` — same list, flags, selection, and quota
      cache timestamps.
- [ ] Refresh quota successfully, close/reopen, then restart: grouped and
      per-model readings survive. Offline refresh and empty readings do not
      erase either saved cache.
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

## Deferred Step 13 installed-host E2E gate

Run this against the built plugin in the target OpenCode 2.0.18 host, using an
isolated config/data directory and a disposable Antigravity test account. Keep
the existing account store untouched. Record the OpenCode version, plugin
revision, host logs, and final process exit status.

- [ ] Start with no accounts and verify `/antigravity` opens the login alert;
      Esc dismisses it. Then add the disposable account and verify the populated
      list, row selection, actions, quota view, refresh, and Esc/back keymaps.
- [ ] Exercise the installed `AntigravityAccounts` RPC against the disposable
      account: list it, disable and re-enable it, select it, and verify the
      returned state. Confirm responses contain no credential material. Remove
      only the disposable account during cleanup.
- [x] Select an available Antigravity model and complete a normal prompt. Verify
      the assistant response is persisted as complete, the session reaches its
      normal terminal state, and there are no retry/error loops. Registration or
      observing a native request URL alone is not a routing pass.
- [ ] Trigger a real tool call, cancel the running turn with Esc, then continue
      the same session. Capture the outgoing model context/request and verify
      that the original call ID has exactly one result and that any plugin
      recovery result uses `Operation cancelled by user (ESC pressed)`. Do not
      use a pre-hook that edits `event.messages` to manufacture the missing
      result; if the host supplies its own result, record that and find a
      naturally dangling-call scenario before claiming plugin recovery.
- [ ] Repeat with a fresh session if a request is interrupted. Confirm the
      plugin unloads cleanly, the host exits with status 0, and the isolated
      profile can be removed without touching normal OpenCode state.

### Capture the interrupted-call context

The optional read-only probes in `script/step-13-observer/` report tool-call IDs,
matching result counts, and whether the canonical cancellation result is present.
They do not log prompts or tool output and are not loaded automatically.

1. From the project directory, get absolute paths for the probe plugin
   directories:
   ```powershell
   $before = (Resolve-Path .\script\step-13-observer\before).Path.Replace('\', '/')
   $after = (Resolve-Path .\script\step-13-observer\after).Path.Replace('\', '/')
   $before
   $after
   ```
   In the isolated test profile's `opencode.json` or `opencode.jsonc`, put those
   two directory paths around the existing Antigravity plugin entry, in this
   order: before probe, Antigravity, after probe. Keep the existing settings and
   do not add the probes to your normal profile. Plugin paths are resolved
   relative to the config file, so use the absolute paths printed above.
2. In PowerShell, from the project directory and with the same isolated-profile
   environment you used for the test, run `opencode --standalone`.
3. Trigger a tool that takes long enough to still be running, press Esc before
   its result appears, then send a follow-up in the same session.
4. In another PowerShell window with the same isolated-profile environment, run:
   ```powershell
   $logPath = opencode debug paths log
   Get-Content $logPath -Wait | Select-String "step13-recovery-probe"
   ```
5. Compare the `before` and `after` records for the interrupted call ID. A
   missing result before the Antigravity hook and exactly one result afterward,
   with `canonicalCancellation: true`, confirms the plugin inserted the
   expected result. If the result was already present in the `before` record,
   OpenCode supplied it; do not count that as plugin recovery.
6. Exit the standalone host normally. In the first PowerShell window, run
   `$LASTEXITCODE`; it must be `0`. `opencode service status` checks the shared
   service, not this foreground process's exit status.

The earlier recovery probe asserted that the plugin inserted the canonical
result only after a temporary pre-hook removed OpenCode's result. The routing
probe captured OAuth refresh and native Antigravity dispatch with a synthetic
account and mocked fetch, but generation timed out after retries. Both host
processes exited nonzero; these are diagnostic observations, not passing E2E
results. Step 13 remains pending until the checklist above passes.

## Known limitations (do not file as regressions)

- Host credential-store sync: open decision, needs user approval — not
  implemented. Plugin tombstones cover the plugin store only.
- Native-renderer tests do not exercise the host's complete dialog stack or
  authentication/browser lifecycle; this checklist covers those boundaries.
