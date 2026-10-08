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

- [x] Existing `google/<model>` selections for Antigravity models are migrated

  to `antigravity/<model>`; ordinary Google API-key models retain their route.

- [ ] Already-saved account at 10/10 reconnects instead of failing (count

  stays 10, no capacity error for the duplicate).

- [ ] Genuinely new account at 10/10 fails cleanly with the capacity

  message; pool unchanged.

- [x] Cancelling the browser OAuth flow writes nothing (no entry, no

  selection change, pool file untouched).

## Management actions (per account)

- [x] Installed-host smoke: `Show quota` opens for the populated disposable

  account; the user reports cached quota is shown without a connection.

- [x] Detailed `Show quota` layout: one padded `Antigravity quota` screen with

  grouped Gemini and Claude/GPT sections, each with weekly and five-hour bars,
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

- [x] Installed-host smoke: manual quota refresh completed quickly and updated

  the quota in place (user-reported).

- [x] Detailed `Refresh quota` behavior via `ctrl+r`: `Refreshing…`

  appears inline, then the available bars update in place with no dialog
  closing. Repeat presses during a fetch are ignored (no duplicate fetch).
  Clicking refresh is equivalent. Partial failures show source-specific
  inline status and keep cached values. Overall quota errors also show an
  error toast and stay on the screen. A successful grouped summary still
  updates even if the per-model probe failed.

- [x] Esc/Back navigation was confirmed working in the account list, account

  info, verification, and quota dialogs.

- [x] Back from quota returns to the main account list (not a submenu); list

  dismissal has no toast or state change.

- [x] Removed actions: no standalone `Refresh quota` and no `Use next` in

  the account menu. (The `select` rotation hint remains available via the
  `antigravity_accounts` agent tool.)

- [x] Disable then Enable both succeed for the disposable account (user-reported).
- [x] Exact Disable/Enable toasts and the one-liner gaining/losing `[disabled]`.
- [x] `Verify` works for a healthy account and accounts requiring external

  verification (user-reported).

- [x] Verify detail: healthy alert says `ok`; external-verification alert has

  the expected message, a
  `Verify: <url>` line, and `run opencode auth login and sign in again`;
  the account becomes `[disabled] [verify required]`.

- [x] `Remove` with Cancel: confirm dialog; Cancel returns to actions, the

  account stays saved.

- [x] Remove succeeds for the disposable account (user-reported).
- [x] Exact Remove toast and refreshed-list presentation.

## Failure and edge states

- [x] Stale remove/action target from another open screen is handled with an

  error message (user-reported).

- [x] Exact stale-target warning/no-success behavior and stale quota refresh:

  open quota for A, delete A elsewhere, then refresh; expect an alert and
  return to the refreshed list.

- [x] Configured plugin removal during a session: the host makes its UI/RPC

  unavailable without a toast; a model invocation reports lost access. This is
  host-level plugin removal, not an RPC transport error or a TUI error-toast
  check. (Observed.)

- [ ] TUI action while the TUI remains loaded but its RPC server is

  unavailable: show the `Antigravity server unavailable...` error toast. Test
  separately from removing the plugin, which unloads the TUI as well. Use a
  prior palette-history action only if the host still allows it to be invoked.

- [x] Refresh quota with no network: error toast; cached grouped and per-model

  values remain visible with stale/error status.

- [x] `ctrl+r` scope: outside the quota view, `ctrl+r` keeps its host

  behavior (session rename); inside the quota view it refreshes. Esc from
  the quota view returns to the account list; Esc from actions closes with
  no toast and no state change.

- [x] Account-list `ctrl+t` toggle: not tested because Orca reserves the

  shortcut; Disable/Enable was tested through the account actions instead.

- [x] Narrow terminal (\~60 cols): text bars wrap/truncate without renderer

  errors.

- [x] Reset status is clear and consistent with the quota data: grouped buckets

  show a compact remaining duration, fully available buckets are identified as
  available, unknown reset times for unavailable buckets stay unknown, and
  expired reset times are not presented as upcoming. Exact wording is not
  contractual.

## Persistence and packaged install

- [x] Restart persistence: disable one account, remove another, restart

  opencode, reopen `/antigravity` — same list, flags, selection, and quota
  cache timestamps.

- [x] Refresh quota successfully, close/reopen, then restart: grouped and

  per-model readings survive. Offline refresh and empty readings do not
  erase either saved cache.

- [x] Disabled-account quota shows saved bars and the refresh-paused message.
- [x] Plugin reload with quota open closes it without reopening the list.
- [x] Replacing quota with another host dialog does not reopen the account

  list or clear the replacement. Native backdrop dismissal simply closes;
  the quota's Back/Esc command returns to the list.

- [ ] Packaged install: `npm pack` (or the published tarball) in a scratch

  config with `OPENCODE_CONFIG_DIR` on a temp dir, then `/antigravity` with
  zero accounts — empty-state alert with the login hint; `opencode auth login`
  adds an account that appears in the list. This confirms `./tui`
  and `./rpc` resolve from `dist/`. On Windows also point `APPDATA` at a
  temp dir (legacy fallback); on Linux/macOS point `XDG_CONFIG_HOME` at a
  temp dir. Delete the temp dirs afterwards.

## Deferred final migration acceptance: installed-host E2E

Run this mandatory final acceptance gate after Step 14 implementation, against
the built plugin in the target OpenCode 2.0.18 host. It was deferred from Step 13
by approval, not waived.

Use an isolated config/data/state profile and a disposable Antigravity test
account. Keep the existing account store untouched. Record the OpenCode version,
plugin revision, host logs, and final process exit status.

**Isolation note:** The user's `opencode debug paths` output showed default user
config, data, and state directories. `--standalone` uses a private server but
does not isolate those paths. The recent checks are functional observations,
not evidence for this isolated-host gate. The user reports that the account
store is fine and add/remove/enable/disable work normally.

For a Windows run, use a fresh PowerShell window and set a unique profile before
login. These overrides were checked with OpenCode 2.0.18 using
`opencode debug paths`; confirm every printed path except `home` is under
`$isolatedRoot` before continuing:

```powershell
$tempRoot = $env:TEMP
$isolatedRoot = Join-Path $tempRoot ("opencode-antigravity-e2e-" + [guid]::NewGuid().ToString("N"))
$env:OPENCODE_CONFIG_DIR = Join-Path $isolatedRoot "config"
$env:XDG_CONFIG_HOME = $env:OPENCODE_CONFIG_DIR
$env:XDG_DATA_HOME = Join-Path $isolatedRoot "data"
$env:XDG_STATE_HOME = Join-Path $isolatedRoot "state"
$env:XDG_CACHE_HOME = Join-Path $isolatedRoot "cache"
$env:OPENCODE_DB = Join-Path $env:XDG_DATA_HOME "opencode.db"
$env:APPDATA = Join-Path $isolatedRoot "appdata"
$env:LOCALAPPDATA = Join-Path $isolatedRoot "local-appdata"
$env:TEMP = Join-Path $isolatedRoot "temp"
$env:TMP = $env:TEMP
New-Item -ItemType Directory -Force -Path @(
  $env:OPENCODE_CONFIG_DIR, $env:XDG_DATA_HOME, $env:XDG_STATE_HOME,
  $env:XDG_CACHE_HOME, $env:APPDATA, $env:LOCALAPPDATA, $env:TEMP
) | Out-Null
opencode debug paths
```

Keep this PowerShell window and its environment for login and every test run.
Create `$env:OPENCODE_CONFIG_DIR\opencode.json` with a `plugins` entry pointing
to the absolute repository root so the profile loads this built checkout rather
than a globally installed copy. Run `opencode --standalone` from this window.
After all OpenCode processes exit, verify the profile root is a direct child of
the original temp directory and remove only that root:

```powershell
if ([IO.Path]::GetFullPath((Split-Path -Parent $isolatedRoot)) -ne [IO.Path]::GetFullPath($tempRoot)) {
  throw "Refusing to remove a profile outside the temp directory"
}
Remove-Item -LiteralPath $isolatedRoot -Recurse -Force
```

Close the test PowerShell window after cleanup so later commands do not inherit
the removed profile paths.

- [ ] Start with no accounts and verify `/antigravity` opens the login alert;

  Esc dismisses it. Then add the disposable account and verify the populated
  list, row selection, actions, quota view, refresh, and Esc/back keymaps.

- [x] Exercise the installed account UI against the disposable account: listing

  and quota display worked. Disabling the only account produced an error and
  repeated attempts (11 observed); re-enabling restored normal operation. The
  configured model list did not change. Direct RPC response redaction and a
  manual Select action were not independently verified.

- [ ] Remove only the disposable account during cleanup; completion not reported.
- [x] Select available Antigravity models and complete normal prompts: Claude

  Sonnet 4.6 and Gemini 3.8 Flash returned responses. The account-disable retry
  behavior above remains an observed issue; no general retry-loop claim is made.

- [x] The observed standalone host run in the isolated profile exited with
      status `0`.
- [x] Triggered a real tool call, cancelled the running turn with Esc, and

  continued the same session successfully. The observer log contained only
  `loaded` records (no context records), so plugin recovery is not proven.

- [x] A fresh session and prompt worked. Clean plugin unload and disposable

  profile cleanup were not reported; the final acceptance gate remains open.

### Capture the interrupted-call context

The optional read-only probes in `test/e2e/recovery-observer/` report tool-call IDs,
matching result counts, and whether the canonical cancellation result is present.
They do not log prompts or tool output, are not loaded automatically, and stay
inactive unless `STEP13_RECOVERY_PROBE=1` is set in the host process. When
enabled, they append sanitized JSONL records to
`os.tmpdir()/opencode/step13-recovery-probe.jsonl` by default (on Windows,
usually under `%TEMP%`). `STEP13_RECOVERY_PROBE_LOG` overrides the output path.
The file contains opaque session/tool-call IDs; treat it as local test data.

1. From the project directory, get absolute paths for the probe plugin
   directories:

   ```powershell
      $before = (Resolve-Path .\test\e2e\recovery-observer\before).Path.Replace('\', '/')
      $after = (Resolve-Path .\test\e2e\recovery-observer\after).Path.Replace('\', '/')
     $before
     $after
   ```

   In the isolated test profile's `opencode.json` or `opencode.jsonc`, put those
   two directory paths around the existing Antigravity plugin entry, in this
   order: before probe, Antigravity, after probe. Keep the existing settings and
   do not add the probes to your normal profile. Plugin paths are resolved
   relative to the config file, so use the absolute paths printed above.

2. In PowerShell, from the project directory and with the same isolated-profile
   environment you used for the test, run:
   ```powershell
     $probeLog = Join-Path $env:TEMP ("opencode\step13-recovery-probe-" + (Get-Date -Format "yyyyMMdd-HHmmss") + ".jsonl")
     $env:STEP13_RECOVERY_PROBE_LOG = $probeLog
     $env:STEP13_RECOVERY_PROBE = "1"
     opencode --standalone
     $hostExitCode = $LASTEXITCODE
     Remove-Item Env:STEP13_RECOVERY_PROBE
     Remove-Item Env:STEP13_RECOVERY_PROBE_LOG
     Write-Host "Observer log: $probeLog"
     Write-Host "Host exit: $hostExitCode"
   ```
3. Start a fresh session. Trigger a tool that takes long enough to still be
   running, press Esc before its result appears, then send a follow-up in the
   same session.
4. Exit the standalone host normally. The commands print the isolated observer
   log path and host exit code; tell the agent when the run is finished so it
   can inspect that file.
5. Compare the `before` and `after` records for the interrupted call ID. A
   missing result before the Antigravity hook and exactly one result afterward,
   with `canonicalCancellation: true`, confirms the plugin inserted the
   expected result. If the result was already present in the `before` record,
   OpenCode supplied it; do not count that as plugin recovery.
6. In the first PowerShell window, check `$hostExitCode`; it must be `0`.
   `opencode service status` checks the shared service, not this foreground
   process's exit status.

The earlier recovery probe asserted that the plugin inserted the canonical
result only after a temporary pre-hook removed OpenCode's result. The routing
probe captured OAuth refresh and native Antigravity dispatch with a synthetic
account and mocked fetch, but generation timed out after retries. Both host
processes exited nonzero; these are diagnostic observations, not passing E2E
results. These observations do not pass the final gate; complete the checklist
above after Step 14 implementation before declaring the migration verified.

## Known limitations (do not file as regressions)

- Host credential-store sync: open decision, needs user approval — not
  implemented. Plugin tombstones cover the plugin store only.
- Native-renderer tests do not exercise the host's complete dialog stack or
  authentication/browser lifecycle; this checklist covers those boundaries.
