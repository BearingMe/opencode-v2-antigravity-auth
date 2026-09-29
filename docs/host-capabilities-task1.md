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

**Verdict: SUPPORTED at SDK-type level, OBSERVED at host-runtime level on v2.0.18
(see runtime note below; investigation run 2026-09-29).**

- `IntegrationEditor` exposes both primitives —
  `node_modules/@opencode/plugin/dist/promise/integration.d.ts:60-70`:
  - `method.list(integrationID): readonly IntegrationMethod[]`
  - `method.update(input: IntegrationMethodRegistration): void`
  - `method.remove(integrationID, method: IntegrationMethod): void`
- The inherited Google key method is `IntegrationKeyMethod`
  (`{ type: "key", label?, form? }`, same file lines 22-26) — note it has **no
  `id` field**, so `remove()` must be called with the method object obtained
  from `method.list("google")`, not an ID. The current code lists methods and
  removes the inherited key entry (`src/v2-plugin.ts`).
- `IntegrationOAuthMethod.form` is optional (`form?: Form.Fields`, same file
  line 14). `Form.Fields = NonEmptyArray(...)` —
  `node_modules/@opencode/schema/dist/form.d.ts:279` — so at the SDK-type
  level, the way to declare an OAuth method with **zero** declared fields is to
  **omit `form`** (or leave it `undefined`); passing `form: []` is a type
  error. Dropping `accountAction` and `projectId` from the type declaration is
  therefore type-supported, and the current code omits `form` entirely.
- Runtime OBSERVED on host v2.0.18 (`docs/task3-login-runtime.md`): the live
  `opencode auth login google --standalone` run showed no method picker, no
  form prompts, and no Skip option. Zero-`form` renders as a prompt-free,
  Skip-free login step on the observed host.

---

## (b) Where the auth-login "Skip" option comes from; how to eliminate it

**Verdict: mechanism SUPPORTED by SDK evidence; Skip-free rendering OBSERVED on
v2.0.18 for the zero-`form` method (host is a binary, source not shipped).**

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
  default). OBSERVED on host v2.0.18 (`docs/task3-login-runtime.md`): the
  form-less method login shows no Skip affordance.
- UNVERIFIED: the exact `opencode auth login` prompt/loop implementation
  (method picker, form pages, post-success behavior) — host source is not in
  `node_modules/@opencode/*` (only SDK types + generated client stubs ship).
  Any claim about host-internal login flow beyond the SDK types above is
  UNVERIFIED.

---

## (c) Repeated add-account loop inside `opencode auth login`

**Verdict: no SDK-supported mechanism found for a plugin-controlled in-flow
loop; single-shot-per-run invocation OBSERVED on v2.0.18. Approval gate
resolved: the one-account-per-run alternative was approved and implemented
(commit `cf6961e`; `docs/task3-login-runtime.md`).**

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
  invocation semantics are now OBSERVED on v2.0.18: one CLI run performs one
  `authorize` round-trip (live run in `docs/task3-login-runtime.md` reached a
  single code prompt with no loop-back affordance). Host persistence semantics
  (how many credentials one CLI run can store) remain UNVERIFIED beyond the
  single observed run.
- **Approved alternative (implemented):** `opencode auth login` is an
  OAuth-only step with no Project ID, no add/replace action, and no declared
  optional field to Skip; dedupe-by-email and the 10-account cap are enforced
  at persistence time inside a single-lock transaction (`updateAccounts`,
  `src/plugin/storage.ts`); the loop is repeated `opencode auth login`
  invocations with the saved N/10 list shown in the login instructions and
  hint text. Task 3 acceptance "repeated additions work up to the cap" was
  re-scoped to repeated invocations per the 2026-09-28 approval.

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

Packaging caveats (partially resolved 2026-09-29, live-TUI verified):
- Local-dir plugins need a root `tui.ts` entrypoint: the host resolves
  `index.ts`/`tui.ts` source and ignores the package `exports` map for
  loading (the map is still kept for packagers). `tsconfig*.json` include
  root `tui.ts`, which re-exports `./src/tui.js`.
- Only `.` and `./tui` load automatically: a separate RPC sidecar module has
  NO host auto-load contract. RPC handlers must be registered from the
  production server setup (`ctx.rpc.register` in `src/v2-plugin.ts`, disposed
  on cleanup); `src/rpc.smoke-server.ts` was deleted for this reason.
- `keymap.layer` must run inside a component (app-slot render), never at
  setup top level (`Keymap.Provider is missing` otherwise).
- Custom JSX route pages crash against the host renderer (`No renderer
  found` outside `RendererContext`): TUI interaction uses host-rendered
  dialogs/toasts/selects only. This revises the Task 5 design: no custom
  router page; one slash/palette entry driving dialogs.
- SMOKE GATE PASSED on host v2.0.18 (live TUI): `/antigravity-smoke` opens a
  host select dialog (Ping RPC / Plugin info); Ping returns
  `ANTIGRAVITY_RPC_SMOKE_OK` via toast. `solid-js`/`@opentui/*` remain
  peerDeps for packaging; whether the host resolves them from plugin
  `dependencies` vs. `peerDependencies` is still UNVERIFIED (no failure
  observed with the dialog-only smoke, which imports no Solid runtime —
  verify again once the production UI imports Solid).
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

**Verdict: plugin-side removal is now transactional (single-lock replace, no
merge); host-side removal is NOT supported from the server plugin context
under the installed SDK types. Tombstone-or-host-work decision gate for
Task 2 remains.**

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
  in the server SDK. Verified 2026-09-29: the server `Context` type
  (`plugin/dist/promise/plugin.d.ts:25-53`) carries no raw `OpenCodeClient`
  handle (only domain facades: integration, rpc, session, etc.), so the
  generated client's `credential.update/activate/remove` endpoints (present in
  `client/dist/.../contract-*.js`) are **not reachable from the server plugin
  context** under the installed SDK types. Host-side removal therefore needs
  host work (a supported removal/deactivation entrypoint) — it is not a
  plugin-only change.
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
  proceed. Service-side read-modify-write is now transactional
  (`updateAccounts`, single lock, replace-no-merge), closing the concurrent
  lost-update/resurrection race for service paths. Host-credential sync/removal
  implementation is **GATED**: server-context removal is confirmed unsupported
  by the installed SDK types (see (e)), so it requires either host-side work
  (a supported removal/deactivation entrypoint) or an approved tombstone
  design specifying identity key, reauthorization behavior, restart
  persistence, and concurrent-update handling. No tombstone or host-store
  mutation work starts before one of those two conditions is met. Remaining
  non-service write path: `AccountManager.saveToDisk` still uses merging
  `saveAccounts` (resurrection vector for racing background saves; bounded —
  tool/login paths reset the manager after mutations).
- **Task 3 (login screen): GATE RESOLVED.** The one-account-per-run
  alternative was approved 2026-09-28 and implemented (commit `cf6961e`);
  zero-`form`, key-method removal, and Skip-free rendering are runtime-observed
  on v2.0.18 (`docs/task3-login-runtime.md`). Remaining: live successful-OAuth
  completion (needs user participation; Task 6) and concurrent-login
  regression coverage via the new transactional persistence.
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
  artifact passes on the observed host. GATE PASSED 2026-09-29 via the
  dialog-driven smoke (see (d)): `/antigravity-smoke` + ping round-trip live
  on v2.0.18. Production build proceeds WITHOUT custom JSX pages (host
  renderer rejects them) — dialogs/toasts/selects only. OAuth-in-TUI needs
  host work (see (d)); host-credential removal is gated per (e).
- **Task 6 (verify/package): GO** once the Task 3 entrypoint decision is
  recorded; manual CLI exercises must run against host v2.0.18 on Windows.

## UNVERIFIED list (must be proven at runtime, not assumed)

Resolved since investigation (observed on host v2.0.18, `docs/task3-login-runtime.md`):
- ~~`method.remove()` suppresses the inherited Google key method~~ — OBSERVED.
- ~~Zero-`form` OAuth method renders prompt-free and Skip-free~~ — OBSERVED.
- ~~Host calls `authorize` once per CLI run (no in-flow loop API)~~ — OBSERVED
  single-shot; no SDK loop mechanism exists (absence established by type
  inspection, single-shot behavior by live run).
- ~~Host credential `remove`/deactivate reachability from server plugin
  context~~ — RESOLVED negative: not present in the server `Context` type;
  needs host work.

Still open:
1. Post-success login rendering (what the host shows after a successful OAuth
   callback) — needs a live consent run with user participation.
2. Credentials stored per host run beyond the single observed abort run.
3. `solid-js`/`@opentui/*` resolution once the production UI imports the
   Solid runtime (dialog-only smoke imports none).
4. `credential.switched/updated` event visibility via `ctx.event.subscribe`.
5. TUI-driven OAuth completion/cancellation (no contract; excluded by design).
