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
- Dialog-only by necessity: custom JSX route pages crash against the host
  renderer (`No renderer found` outside `RendererContext`), and the TUI
  imports no Solid runtime. Every screen is a host-rendered dialog, select,
  confirm, alert, or toast.
- List shows each account email with disabled/selection/quota state in the
  description plus the `Add accounts: opencode auth login` footer. Empty
  state alerts point to `opencode auth login`. Verify-blocked alerts show
  the `verifyUrl` plus reconnect guidance.
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
- The only SDK-supported OAuth path is the host login flow
  (`authorize`/`callback`); driving OAuth from a TUI page has no SDK
  contract and stays out of `/antigravity`. Additions belong to
  `opencode auth login`.
- OAuth completion inside the login flow is prompt-free and Skip-free for
  the form-less `google-oauth` method (no method picker, no declared fields).
  One CLI run performs one `authorize` round-trip (one account per run);
  repeated invocations build the pool. Live successful-OAuth completion and
  post-success rendering still need user-participated verification; the
  at-cap branch and host credential-store state after login are likewise
  covered by unit tests only, not live runs.
