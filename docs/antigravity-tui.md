# `/antigravity` account management

Dialog-only TUI for saved Antigravity accounts. No custom JSX pages: the host
renderer rejects them (`No renderer found`), so every screen is a
host-rendered dialog, select, confirm, alert, or toast.

## Entry

- Slash: `/antigravity`
- Palette: `Antigravity accounts`
- Registration: `keymap.layer` inside the `app` slot render only.

## Flows

- List: select dialog over saved accounts. Each option shows the account email
  with `disabled` / `selected` / quota state in the description. Footer hint:
  `Add accounts: opencode auth login`.
- Per-account actions: Show quota (cached text bars), Refresh quota (fresh
  fetch, text bars), Use next (rotation hint, never permanent pinning),
  Enable/Disable, Verify, Remove (confirm dialog), Back (re-opens the list).
- Empty state: alert pointing to `opencode auth login`.
- Verify blocked: alert showing the `verifyUrl` plus reconnect guidance
  (`run opencode auth login and sign in again`).
- RPC failure: error toast with server-unavailable guidance (restart opencode
  or check the plugin installation).

## Quota text

Quota bars render as plain text via `src/plugin/account-ui-format.ts`:

- `renderQuotaBar(fraction)` — `0..1` to `████░░ 60%`, unknown stays
  `░░░░░░░░░░░░ unknown`. Out-of-range values are unknown, never clamped.
- `formatResetCountdown(resetTime)` — `resets in Xh Ym` / `resets in Xm` /
  `reset unknown`.
- `formatAccountOneLiner(account)` — email plus `[selected]`, `[disabled]`,
  `[verify required]`, `[cooling down]`, `[quota error]`, `[quota unknown]`.

## RPC

`AntigravityAccounts` (`src/rpc.ts`, handlers in `src/v2-plugin.ts`): `list`,
`quota` (`{ refresh? }`), `verify` (`{ id }`), `mutate`
(`{ id, op: select|enable|disable|delete, family? }`), `deleteAll`, `ping`.
Mutations address durable ids only, never indices. Every method output is
credential-free: projections never serialize `refreshParts`, refresh tokens,
or access tokens (covered by secret-scan tests).

## Transport codec

Explicit `undefined` optionals pass Zod but are rejected by the host JSON
codec (`InvalidRequestError: Expected JSON value at ["output"]`). Handler
projections must omit absent optionals rather than setting them to
`undefined`. Regression coverage encodes handler returns via an Effect codec
mirror (`src/rpc-transport.test.ts`) since `@opencode/protocol` is not
installed. The TUI maps only that host-known shape to the invalid-response
toast; every other RPC failure gets the generic server-unavailable toast with
no error detail (diagnostics stay in the host log).

## Testing / limitations

Unit coverage for the TUI targets the pure gates in `src/tui.ts`
(`isInvalidRpcResponse`, `isStaleMutate`; see `src/tui-behavior.test.ts`):
a stale `{ ok: false }` mutate outcome takes the stale path, never the
success toast. The full dialog/toast flow is not driven in tests — mocking
the host TUI context (`client.rpc`, dialogs, slots, keymap layers) is
disproportionate to the value, so that path stays manually verified.
