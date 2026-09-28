# Task 1 — OpenCode V2 host capabilities for Antigravity account UI

Read-only investigation. No `src/` or `package.json` changes made.
Branch: `feat/antigravity-account-ui`. Target plan:
`C:\Users\gomes\.opencode\plan\antigravity-account-ui-tasks.md`.

## Installed versions (exact)

| Component | Version | Evidence |
|---|---|---|
| Host CLI (`opencode --version`) | `v2.0.18` | `opencode --version` output |
| `@opencode/plugin` (installed) | `2.0.18` | `node_modules/@opencode/plugin/package.json:3` |
| `@opencode/schema` (installed) | `2.0.18` | `node_modules/@opencode/schema/package.json:3` |
| Plugin package (`opencode-antigravity-auth`) | `1.6.0` | `package.json:3` |
| `effect` | `4.0.0-rc.112` | `package.json:66`, `@opencode/schema` deps |
| Runtime | bun `1.4.2`, node `v22.16.0` | `bun --version`, `node --version` |

> Scope note: `v2.0.18` throughout this doc is the **observed test target**
> (the installed CLI and SDK versions on this machine), not an established
> supported-version range. No minimum/maximum supported host range was
> verified; all runtime claims are scoped to host v2.0.18 until exercised.

`@opencode/plugin` exports (verified in
`node_modules/@opencode/plugin/package.json:10-33`): `.` (server plugin),
`./tui` (`dist/tui/index.js` + types), `./host`, `./*`. Server entry contract:
`Plugin.define({ id, setup(ctx) })` —
`node_modules/@opencode/plugin/dist/promise/plugin.d.ts:55-59`. TUI entry
contract: `define({ id, setup(context) })` —
`node_modules/@opencode/plugin/dist/tui/plugin.d.ts:4-8`.

Host plugin-source resolution (verified):
`node_modules/@opencode/plugin/dist/host.js:29` —
`{ server: entry(["server", ""]), tui: entry(["tui"]), rpc: entry(["rpc"]) }`,
i.e. the host resolves subpath `<package>/tui` (and `/rpc`, `/server`) via
standard module resolution. A `./tui` package export is therefore required for
the TUI screen; the current `package.json` has **no** `exports` map (only
`main: ./dist/index.js`), so Task 5 must add it. `ERR_PACKAGE_PATH_NOT_EXPORTED`
is explicitly treated as "entry missing" in the same file, confirming the
export-map requirement.

---

## (a) Removing the inherited API-key method; dropping optional fields

**Verdict: SUPPORTED at SDK-type level, UNVERIFIED at host-runtime level.**

- `IntegrationEditor` exposes both primitives —
  `node_modules/@opencode/plugin/dist/promise/integration.d.ts:60-70`:
  - `method.list(integrationID): readonly IntegrationMethod[]`
  - `method.update(input: IntegrationMethodRegistration): void`
  - `method.remove(integrationID, method: IntegrationMethod): void`
- The inherited Google key method is `IntegrationKeyMethod`
  (`{ type: "key", label?, form? }`, same file lines 22-26) — note it has **no
  `id` field**, so `remove()` must be called with the method object obtained
  from `method.list("google")`, not an ID. The current code only calls
  `editor.update(INTEGRATION_ID, ...)` and `editor.method.update({...})`
  (`src/v2-plugin.ts:276-347`) and never lists/removes.
- `IntegrationOAuthMethod.form` is optional (`form?: Form.Fields`, same file
  line 14). `Form.Fields = NonEmptyArray(...)` —
  `node_modules/@opencode/schema/dist/form.d.ts:279` — so at the SDK-type
  level, the way to declare an OAuth method with **zero** declared fields is to
  **omit `form`** (or leave it `undefined`); passing `form: []` is a type
  error. Dropping `accountAction` and `projectId` from the type declaration is
  therefore type-supported. This says nothing about the resulting host UX
  (see UNVERIFIED below).
- Runtime UNVERIFIED: whether the host's built-in `google` integration
  actually exposes its API-key entry through `method.list()` as a removable
  `{ type: "key" }` method, and whether `remove()` suppresses it in
  `opencode auth login` on the observed host v2.0.18, can only be confirmed by
  running the transform against the real host. Likewise, whether omitting
  `form` actually renders a prompt-free login step with no Skip affordance is
  UNVERIFIED — the SDK types permit the declaration, but a verified
  prompt-free login UX is not established by types alone.

---

## (b) Where the auth-login "Skip" option comes from; how to eliminate it

**Verdict: mechanism SUPPORTED by SDK evidence; exact host rendering UNVERIFIED
(host is a binary, source not shipped).**

- SDK evidence for Skip semantics:
  `node_modules/@opencode/schema/dist/form.js:32` (FieldBase `hidden`
  annotation): `"Skip the interactive authentication prompt and use the default
  unless an answer is supplied"`. Every form field also carries optional
  `required?: boolean` — `node_modules/@opencode/schema/dist/form.d.ts:44`
  (`StringField`) and equivalents. Fields that are neither `required: true`
  nor `hidden: true` are skippable in the host's interactive auth prompt.
- Current plugin form fields (`src/v2-plugin.ts:286-302`) set **no**
  `required` flag on `accountAction` or `projectId` → both are optional at the
  SDK-type level → both are candidates for the host's Skip affordance in
  `opencode auth login` (exact host rendering UNVERIFIED, but consistent with
  the agreed-experience complaint about "ambiguous Skip actions").
- Elimination path (permitted — not proven — by SDK types): remove both
  fields (omit `form`, per (a)) so there is no declared field left to skip.
  There is no per-method "disable Skip" flag in `IntegrationOAuthMethod`
  (`integration.d.ts:10-15`); the only field-level controls are
  `required: true` (forces an answer) and `hidden: true` (skips prompt, uses
  default). Whether this yields a Skip-free login UX on the observed host
  v2.0.18 is UNVERIFIED (see (a)).
- UNVERIFIED: the exact `opencode auth login` prompt/loop implementation
  (method picker, form pages, post-success behavior) — host source is not in
  `node_modules/@opencode/*` (only SDK types + generated client stubs ship).
  Any claim about host-internal login flow beyond the SDK types above is
  UNVERIFIED.

---

## (c) Repeated add-account loop inside `opencode auth login`

**Verdict: no SDK-supported mechanism found for a plugin-controlled in-flow
loop; host invocation/persistence semantics UNVERIFIED. Approval gate for
Task 3.**

- The plugin's OAuth contract, as far as SDK types show —
  `node_modules/@opencode/plugin/dist/promise/integration.d.ts:32-49`:
  `authorize(answer: Form.Answer) => Promise<IntegrationOAuthAuthorization>`
  with `{ mode: "code", callback: (code) => Promise<Credential.OAuth> }`.
  The callback resolves a single `Credential.OAuth` value
  (`node_modules/@opencode/schema/dist/credential.d.ts:162-169`). No SDK API
  was found to loop back to a method/form list, re-invoke `authorize`, or
  render a "saved N/10, Add account, Done" list inside the host login flow.
  The `Transform<IntegrationEditor>` registration type
  (`node_modules/@opencode/plugin/dist/promise/registration.d.ts:14`) is a
  one-pass editor callback, not a UI driver.
- Current `authorize` (`src/v2-plugin.ts:304-338`) persists to the plugin disk
  store and resolves one credential per invocation; no SDK surface was found
  that lets the plugin keep a host login session open for a further account.
- **Precise limitation:** no SDK-supported mechanism was found for the agreed
  login loop (list → Add account → OAuth → back to list, up to 10) as a
  plugin-controlled in-flow loop *inside* `opencode auth login`. Host
  invocation semantics (whether the host calls `authorize` once or repeatedly
  per CLI run) and host persistence semantics (how many credentials one CLI
  run can store) remain **UNVERIFIED until exercised against host v2.0.18** —
  this doc does not assert a proven one-account-per-run ceiling or a proven
  impossibility, only the absence of a supporting plugin API.
- **Proposed alternative (needs user approval before Task 3 implementation):**
  keep `opencode auth login` as an OAuth-only step with no Project ID,
  no add/replace action, and no declared optional field to Skip — per (a)/(b),
  subject to the runtime verification noted there; enforce dedupe-by-email and
  the 10-account cap at persistence time (already partially present in
  `persistOAuthAccount`, `src/v2-plugin.ts:648-689`); and, if host runs prove
  single-shot, document the loop as repeated `opencode auth login`
  invocations with the "saved N/10" list shown in the `/antigravity` screen
  and hint text. Do NOT silently replace the agreed flow with an unexplained
  one-shot: per the task plan, this alternative requires explicit user
  approval, and the Task 3 acceptance criterion "repeated additions work up to
  the cap" must be re-scoped only as approved.

---

## (d) `/antigravity` TUI screen composition

**Verdict: SUPPORTED at SDK-type level; packaging/runtime UNVERIFIED.**

Supported building blocks (all verified in installed types):

| Need | API | Evidence |
|---|---|---|
| `./tui` export loading | host `resolve()` tries `<pkg>/tui` | `plugin/dist/host.js:29`; missing-export tolerated as absent |
| TUI plugin definition | `define({ id, setup })` | `plugin/dist/tui/plugin.d.ts:4-8` |
| JSX UI | Solid JSX (`JSX.Element`), `PluginContextProvider`/`usePlugin` | `plugin/dist/tui/solid.d.ts`, `tui/index.js`, `tui/context.d.ts` (`@opentui/solid`, `@opentui/core`, `solid-js/store` imports) |
| Full-screen page | `ui.router.register(page)` + `ui.router.navigate({ type: "plugin", name, data })`; `Route = home \| session \| plugin` | `plugin/dist/tui/context.d.ts:112-131, 402-406` |
| Slash command + palette, no model call | server `ctx.command.transform(editor => editor.add({ name, description, execute }))`; TUI `keymap.layer(() => ({ commands: [{ id, title, slash: { name: "antigravity" }, palette: true, run }] }))` | `plugin/dist/promise/command.d.ts:11-22`; `plugin/dist/tui/context.d.ts:323-364, 375-395` |
| Session panel slot | `ui.panel.open(name)` + slot claim `{ append/prepend/replace: "session.panel", render(input: PanelInput) }`; `SlotMap["session.panel"]` | `plugin/dist/tui/context.d.ts:139-148, 161-179, 199-231, 407-419` |
| Server RPC | server `ctx.rpc.register(definition, handlers)`; shared contract `Rpc.define({ id, methods, events })`; portable methods accept JSON-schema or Standard-Schema I/O | `plugin/dist/promise/rpc.d.ts:17-22`; `schema/dist/rpc.d.ts:43-49`; `Context.rpc` in `promise/plugin.d.ts:44` |
| TUI→server calls | TUI `Context.client: OpenCodeClient` with `rpc.call` | `plugin/dist/tui/context.d.ts:463`; `client/dist/promise/generated/client.d.ts:180-181` |
| Dialogs/select/toast/theme | `ui.dialog.{show,select,confirm,alert}`, `ui.toast.show`, `theme` tokens | `plugin/dist/tui/context.d.ts:232-247, 311-322, 396-401` |

Packaging caveats (Task 5 work, all UNVERIFIED at runtime):
- `package.json` currently has no `exports` map and no `solid-js` /
  `@opentui/*` dependency — both must be added (TUI `context.d.ts` imports
  `@opentui/core`, `@opentui/solid`, `solid-js/store`, `@opencode/theme/tui`).
  Whether the host resolves those from plugin `dependencies` vs. `peerDependencies`
  is UNVERIFIED;ifaithful-to-host approach is to mirror a known-good V2 TUI
  plugin's manifest, which we do not have locally.
- `tsconfig.build.json` includes `src/**/*.tsx` and emits declarations, so a
  `src/tui.tsx` (+ `src/rpc.ts` if a separate rpc entry is used) compiles; but
  hot-reload/file-watching behavior for the `tui` entry is UNVERIFIED.
- OAuth completion/cancellation *inside* a TUI screen is UNVERIFIED: the only
  SDK-supported OAuth path is the host login flow (`authorize`/`callback`);
  driving `authorizeAntigravity`/`exchangeAntigravity` from a TUI page + RPC
  has no SDK contract and must stay out of `/antigravity` (additions belong to
  login per the agreed experience). If in-TUI OAuth is ever wanted, that is
  **host work** (a new host-supported OAuth entrypoint), not a plugin-only
  change — no user-approval shortcut exists; until then the constraint stands.

---

## (e) Credential-sync invariant (removed accounts must stay removed)

**Verdict: invariant expressible, but host-side removal is UNVERIFIED
plugin-only. Approval/runtime-verification gate for Task 2.**

Verified facts:

- `getAuth()` precedence (`src/v2-plugin.ts:182-211`):
  1. host connection `ctx.integration.connection.active("google")` → resolve →
     OAuth value wins; an explicit **non-OAuth** (API-key) connection returns
     `{ type: "none" }` and *takes precedence over saved Antigravity accounts*
     (comment at lines 194-196);
  2. in-memory `currentAuth`;
  3. disk fallback `loadAccounts()` → `accounts[activeIndex]`.
- Consequence: the host credential store is authoritative at step 1. The
  plugin persists OAuth results to its own disk file on every login
  (`persistOAuthAccount`, lines 648-689); the host login flow additionally
  receives the returned `Credential.OAuth` (per the `callback` contract), so a
  host-side persisted copy is expected — host persistence format and
  lifecycle UNVERIFIED. Deleting only the plugin disk entry while the host
  connection still resolves means the "removed" account keeps routing
  (step 1) and a subsequent OAuth/refresh round-trip can re-persist it —
  resurrection. The `manageAccounts` delete paths (lines 753-803) clear disk +
  `currentAuth` + invalidate the fetch manager, but never touch the host
  credential store.
- Server plugin context exposes **only**
  `connection.active` / `connection.resolve`
  (`plugin/dist/promise/integration.d.ts:74-77`) — no credential remove/deactivate
  in the server SDK. The generated *client* does have
  `credential.update/activate/remove` plus `credential.updated/switched`
  events (`client/dist/promise/generated/client.d.ts:140-143`; event union in
  `generated/types.d.ts:3308-3310`), but whether a server-context plugin may
  call them (no raw client handle in server `Context`,
  `promise/plugin.d.ts:25-53`) is UNVERIFIED, as is whether
  `ctx.event.subscribe` delivers `credential.switched` (subscription surface
  not confirmed against host v2.0.18).
- Proposed invariant for Task 2 (all steps need runtime verification):
  removal = delete from plugin disk store + clear/rotate `currentAuth` +
  dispose + reload `AccountManager`/refresh queue + remove or deactivate the
  corresponding host credential + handle last-account (empty store, neutral
  auth) + restart persistence check.
- **Credential removal — per-item requirement.** The host-credential half has
  two mutually exclusive paths forward: (i) a **verified removal path**
  (prove `credential.remove`/equivalent is reachable from the server plugin
  context on host v2.0.18 — this is **host-capability verification work**, no
  user approval needed if it succeeds); or (ii) if (i) fails, an **approved
  tombstone design** — this requires **user approval**, and the design must
  specify the tombstone identity key (e.g. refresh-token hash vs. email vs.
  host credential ID), reauthorization behavior (what happens when a
  tombstoned account re-completes OAuth), restart persistence (tombstone
  storage format and lifecycle), and concurrent-update handling ( races
  between removal, refresh rotation in `refreshOAuthCredential`, and
  background saves). Task 2 must not implement tombstones on unapproved
  terms.

---

## Go / no-go for Tasks 2–5

- **Task 2 (shared service): PARTIAL GO.** Credential-free response models
  and read-only extraction (list/quota shapes, stable-identity reads) may
  proceed. Host-credential sync/removal implementation is **GATED**: it
  requires either a verified removal path on host v2.0.18 or an approved
  tombstone design specifying identity key, reauthorization behavior, restart
  persistence, and concurrent-update handling (see (e)). No tombstone or
  host-store mutation work starts before one of those two conditions is met.
- **Task 3 (login screen): APPROVAL GATE (blocking).** The field-free OAuth
  method declaration is type-permitted, but no SDK-supported mechanism was
  found for a plugin-controlled in-flow add-account loop (c), and host
  invocation/persistence semantics are UNVERIFIED. Do not start Task 3 until
  the user approves the proposed alternative (or directs host-side work).
- **Task 4 (quota data): QUALIFIED GO — no host SDK blocker identified, full
  GO withheld.** Nothing in the SDK types blocks exposing quota/reset/selection
  data via RPC/tool responses, but field-level source validation for every
  displayed figure (which API field backs each percentage, pool, and reset
  timestamp; unknown-vs-zero handling) is still required before full GO.
- **Task 5 (`/antigravity` TUI): SMOKE-GATED (blocking).** Composition
  (./tui export, RPC, slash command, panel) is type-supported, but a minimal
  TUI smoke artifact — built package loads, command registers, page
  navigates, RPC round-trips on host v2.0.18 — is a **BLOCKING prerequisite**,
  not deferrable: the Task 5 full build must not start until the smoke
  artifact passes on the observed host. OAuth-in-TUI needs host work (see
  (d)); host-credential removal is gated per (e).
- **Task 6 (verify/package): GO** once the Task 3 entrypoint decision is
  recorded; manual CLI exercises must run against host v2.0.18 on Windows.

## UNVERIFIED list (must be proven at runtime, not assumed)

1. `method.remove()` suppresses the inherited Google key method in the login
   UI on the observed host v2.0.18 (method identity discoverable via
   `method.list("google")`).
2. Zero-`form` OAuth method declaration is permitted by SDK types; whether it
   renders as a prompt-free, Skip-free login step on the observed host is
   UNVERIFIED (types alone do not establish UX).
3. Exact `opencode auth login` picker/loop/post-success behavior (host binary;
   no local source).
4. No SDK-supported mechanism found for a plugin-controlled multi-account
   loop inside the host login flow; host invocation/persistence semantics
   (calls per CLI run, credentials stored per run) UNVERIFIED until exercised
   against host v2.0.18 — only host runs or a host-maintainer answer can
   settle this.
5. `./tui` hot-load/packaging: export map + `solid-js`/`@opentui` dependency
   placement that host v2.0.18 accepts.
6. Host credential `remove`/deactivate reachability from server plugin context;
   `credential.switched/updated` event visibility via `ctx.event.subscribe`.
7. TUI-driven OAuth completion/cancellation (no contract; excluded by design).
