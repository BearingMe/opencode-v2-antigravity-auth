# RPC and TUI

## Contract

`AntigravityAccounts` (`src/rpc.ts`, handlers in `src/v2-plugin.ts`):

| Method | Input | Output |
|---|---|---|
| `list` | `{}` | Accounts (redacted) + `activeIndex` / `activeIndexByFamily` |
| `quota` | `{ refresh? }` | `QuotaPresentation` (see [quota-contract.md](quota-contract.md)) |
| `verify` | `{ id }` | Success `{ index, email?, checkedAt, status: ok\|blocked\|error, message, verifyUrl? }` or `{ ok: false, kind: invalid-index\|not-found\|ambiguous, accountCount }` |
| `mutate` | `{ id, op: select\|enable\|disable\|delete, family? }` | Success (selection/cursors/remaining/selected) or `{ ok: false, kind, accountCount }` |
| `deleteAll` | `{}` | `{ remaining: 0 }` |
| `ping` | `{}` | `"ANTIGRAVITY_RPC_ACCOUNTS_OK"` |

Rules:

- Mutations address **durable ids only**, never indices. Unknown ids fail
  closed (warning toast + list refresh, never a success toast).
- Every output is **credential-free**: projections never serialize
  `refreshParts`, refresh tokens, or access tokens (covered by secret-scan
  tests). Absent optionals are **omitted**, never sent as explicit
  `undefined`.
- Registration lives on the production server plugin (`ctx.rpc.register` in
  `src/v2-plugin.ts`, disposed on cleanup). Only `.` and `./tui` auto-load —
  there is no sidecar-entry contract, so a separate RPC module would never
  be reached.

## `/antigravity` dialog

- Entry: `/antigravity` slash command and `Antigravity accounts` palette
  entry (`antigravity.accounts`, registered from an app-slot render —
  `keymap.layer` must run inside a component, never at setup top level).
- Account management uses the host's dialog stack. The quota view is custom
  Solid/OpenTUI content mounted with `dialog.show`, not a second renderer.
- The host-mounted account-list view uses small colored `●` glyphs beside
  emails (enabled/disabled only), `[disabled]` text fallback, and a shared
  legend/login footer. Search, arrow selection, Enter, Esc, and mouse selection
   are component-owned; long lists scroll. Search uses the host's focused
   formfield text/background tokens, including on light themes. Muted selection/quota metadata for
  the highlighted account appears below the rows. Empty
  state alerts point to `opencode auth login`. Verify-blocked alerts show
  the `verifyUrl` plus reconnect guidance.
- Account actions are `Show quota`, `Enable`/`Disable`, `Verify`, `Remove`,
  `Back` — there is no standalone `Refresh quota` and no `Use next`
  (rotation hints remain available via the `antigravity_accounts` agent
  tool's `select` op; rotation itself is unchanged).
- The quota view (`Antigravity quota`) is one custom dialog with padded
  sections, theme-colored aligned rows, update time, and a `refresh ctrl+r`
  footer. The quota-group box's `onSizeChange` measures actual content width
  after host sizing and padding. Bars reserve label, percentage, and longest
  reset columns; narrow layouts stack the label/reset around the bar. Resizing
  changes layout only. Saved readings render first; `onMount` refreshes enabled
  accounts. `ctrl+r` or clicking refresh uses the same controller operation.
  Loading and failures render inline; there is no polling or submenu.
   The component-owned modal keymap has priority 10. Explicit Back/Esc returns
   to the list once. Native dismissal/replacement only disposes: `onClose`
   cannot distinguish them, so it must never reopen menus or clear a replacement.
    Missing-account notices use host-mounted content with explicit Enter/Esc
    or mouse acknowledgement before list navigation. Replacing the notice
    cancels navigation; native alert promise resolution is not acknowledgement.
    Teardown disposes without
   reopening menus; late results cannot update a closed view. Enabled state
   comes from the quota response and is retained across refreshes.
- `script/build-tui.mjs` compiles JSX through the OpenTUI Solid transform
  and externalizes all imports. tsc's automatic JSX emit alone evaluates
  dynamic props eagerly. `test/tui-quota-render.test.ts` uses Bun's native
  renderer to verify the built artifact's loading, bar updates, failure
  retention, full-width/aligned rows, host-constrained sizing, resizing,
  narrow layout, and disposal. It does not replace an installed
   host input/auth check. The separate test checkout's optional
   `antigravity-package.test.tsx` loads a packed plugin through its runtime
   singleton bridge and real keymap/dialog stack; it exercises Enter, ctrl+r,
   Esc, replacement, and cleanup with fixture RPC data.
- TUI→server calls go through `context.client.rpc(AntigravityAccounts)`
  with the current location. Quota text renders via the pure helpers in
  `src/plugin/account-ui-format.ts` (`renderQuotaBar`, `formatResetCountdown`,
  `formatAccountOneLiner`).

## Transport codec

Explicit `undefined` optionals pass Zod but are rejected by the host JSON
codec (`InvalidRequestError: Expected JSON value at ["output"]`). Handler
projections must omit absent optionals. Regression coverage encodes handler
returns via an Effect codec mirror (`src/rpc-transport.test.ts`) because
`@opencode/protocol` is not installed. The TUI maps only that host-known
shape to the invalid-response toast; every other RPC failure gets the
generic server-unavailable toast with no error detail (diagnostics stay in
the host log).

## Production status (not smoke)

Earlier task notes called `src/tui.ts` / `src/rpc.ts` "smoke-only". That is
stale: the `/antigravity` dialog and `AntigravityAccounts` RPC are the
production account-management surface (the legacy `antigravity_accounts`
agent tool shares the same `account-service.ts` backend). The removed
`/antigravity-smoke` command and `ANTIGRAVITY_RPC_SMOKE_OK` ping are the only
smoke remnants, and they are gone from the current contract (`ping` returns
`ANTIGRAVITY_RPC_ACCOUNTS_OK`).

## Host constraints (observed, v2.0.18)

- The server plugin context carries no raw `OpenCodeClient` handle — only
  domain facades — so generated `credential.*` endpoints are not reachable
  from the server plugin. Host credential removal/deactivation needs host
  work, not a plugin-only change.
- Login declares a required `method.form` string selection with options.
  The host's `auth/login.ts` calls `answerForm` before `oauth.connect`, so
  saved-account information and Add/reconnect appear before any URL is
  generated. `authorize` validates the answer; no Exit option is exposed.
  Ctrl+C while answering uses the host's native prompt cancellation.
- The form summary is captured by the integration transform and refreshed
   after successful OAuth, RPC mutations/verification/deletion, and tool
   management actions via `integration.reload`. External store changes
  may require plugin reload to refresh this pre-auth summary; authorization
  and the capacity transaction always reread the live store.
- The stock v2.0.18 CLI performs one authentication and exits with Done.
  Rerun the command to add another account. No host-specific login metadata
  or repeated-login loop is used. Login
  additions remain on `opencode auth login`, not silently moved to a TUI flow.
   Live OAuth completion still requires user-participated verification.
