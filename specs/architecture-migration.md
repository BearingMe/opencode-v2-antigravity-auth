# Incremental architecture migration

## Status and scope

The target tree below is the final destination, not a file-move order.
Establish boundaries first, migrate behind them, then remove legacy locations.
Preserve behavior; perform redesigns separately.

Planning consultation with Oracle has occurred. Step 1 is complete; this
document tracks the remaining migration work and its verified evidence.
Existing behavioral requirements remain in
[docs/specs/07-rule-index.md](../docs/specs/07-rule-index.md).
Apply [testing-rules.md](testing-rules.md) throughout.

Current location-specific requirements remain in force until their references
are reconciled in the corresponding migration step. In particular, step 12
must update the documented engine location without weakening the single-router
invariant; this plan does not authorize bypassing the existing native engine.

## Target structure

```text
src/
├── app/
│   ├── composition.ts
│   └── execute-request.ts
├── modules/
│   ├── accounts/
│   │   ├── index.ts
│   │   ├── account-pool.ts
│   │   ├── account-admin.ts
│   │   ├── selection/
│   │   ├── quota/
│   │   ├── verification/
│   │   ├── refresh/
│   │   ├── persistence/
│   │   └── ports.ts
│   ├── inference/
│   │   ├── index.ts
│   │   ├── request/
│   │   ├── response/
│   │   ├── transform/
│   │   ├── streaming/
│   │   ├── signatures/
│   │   └── ports.ts
│   └── session-recovery/
│       ├── index.ts
│       ├── detection.ts
│       ├── repair.ts
│       └── storage.ts
├── adapters/
│   ├── antigravity/
│   │   ├── oauth.ts
│   │   ├── token.ts
│   │   ├── project.ts
│   │   ├── quota-client.ts
│   │   └── inference-client.ts
│   ├── opencode/
│   │   ├── plugin.ts
│   │   ├── rpc.ts
│   │   ├── tui/
│   │   ├── config/
│   │   └── hooks/
│   └── filesystem/
│       ├── account-store.ts
│       ├── signature-store.ts
│       └── debug-log.ts
└── platform/
    └── logging/
```

Colocated tests and cohesive implementation files inside these boundaries are
allowed. The tree is not permission to invent extra top-level capabilities.
Resolve currently unplaced responsibilities in step 1 before moving them.

## Definition of done: every task and migration step

- [ ] All step acceptance criteria pass.
- [ ] All tests pass: the complete Vitest suite and the native Bun TUI suite,
      not just changed-file tests. Required live checks also pass when the
      scope calls for them; unrelated live E2E is not required for docs-only work.
- [ ] Typecheck, clean build, lint, and formatting checks pass for the task.
- [ ] Oracle is consulted on the actual changes, not only the initial plan.
- [ ] Code review is complete and all blocking findings are resolved.
- [ ] A scope-appropriate smoke test passes and its result is recorded.
- [ ] All runtime functions and methods in the task's scope have concise,
      repository-compliant JSDoc, including constructors and private helpers.
      Test helpers are documented; test declarations do not need JSDoc.
      At final completion, coverage applies to all runtime functions/methods.
- [ ] The task is committed with a scoped conventional commit; no unrelated
      work, secrets, or generated `dist/` output is included.
- [ ] Progress and validation evidence are recorded with the completed task.

Unrun checks, unavailable credentials/quota, failing checks, and unresolved
reviews are blockers, not passes. Do not disable tests or bypass hooks to
declare completion. No-runtime-change tasks satisfy the function-documentation
gate by recording that no functions or methods were added or changed.

Use the commands in [AGENTS.md](../AGENTS.md). The native TUI suite is
`bun run test:tui`; it is separate from `bun run test` and rebuilds the package.
Formatting checks may target the task's changed files; tests must not be
restricted to those files for the completion gate.

## Progress tracker

### Preparation evidence (not migration-step completion)

- Scope: this tracker, testing rules, conditional `AGENTS.md` guidance, and
  the four local architecture READMEs; no runtime, tests, or CI changed.
- `bun run test`: 48 files, 1,146 tests passed.
- `bun run test:tui`: clean package build and 13 native TUI tests passed.
- `bun run typecheck` and `bun run lint`: passed.
- Changed-file Prettier and diff whitespace checks: passed.
- Documentation smoke: local links resolve, all 14 steps remain pending,
  and all 27 hard testing rules are present.
- Oracle consultation: engine-location reconciliation is explicitly required
  in step 12; the app diagram's external-runtime meaning is clarified.
- Code review: no blocking findings. No runtime functions/methods changed,
  so the function-documentation gate has no additions to audit.
- Preparation commit subject: `docs: track architecture migration and testing rules`.

### Migration steps

Set a step to `done` only after its complete definition of done passes.
Identify its commit by hash or unique conventional commit subject. Keep evidence
concise: commands/results, Oracle and review outcomes, smoke scenario/results,
documentation audit, and any blockers. Update evidence in the same scoped commit;
the tracker may identify that commit by subject to avoid self-referential hashes.

| Step | Title                                 | Status  | Evidence / commit                                                       |
| ---- | ------------------------------------- | ------- | ----------------------------------------------------------------------- |
| 1    | Baseline and ownership map            | done    | `test: isolate suite state and map architecture baseline`               |
| 2    | Public APIs and ports                 | done    | `refactor: define module contracts and legacy bridges`                  |
| 3    | Mechanical boundary checks            | done    | `build: enforce architecture boundaries and required test suites`       |
| 4    | Logging separation                    | done    | `refactor: separate logging facilities from destinations`               |
| 5    | Account persistence                   | done    | `refactor: separate account persistence policy from filesystem storage` |
| 6    | Account pool and selection            | done    | `refactor: migrate account pool and selection policies`                 |
| 7    | Antigravity account communication     | pending | —                                                                       |
| 8    | Account administration and lifecycle  | pending | —                                                                       |
| 9    | Session recovery                      | pending | —                                                                       |
| 10   | Inference transforms and signatures   | pending | —                                                                       |
| 11   | Inference pipelines and client        | pending | —                                                                       |
| 12   | Application execution and composition | pending | —                                                                       |
| 13   | OpenCode integration and packaging    | pending | —                                                                       |
| 14   | Final architecture verification       | pending | —                                                                       |

## 1. Establish the migration baseline and ownership map

**Description:** Map every runtime file to the target architecture and capture
behavioral, packaging, and test contracts before changing implementations.

**Acceptance criteria:**

- [x] Every runtime file has an intended owner, including constants, types,
      config, fingerprints, image saving, errors, version checks, and the SDK.
- [x] The proposed dependency graph is acyclic.
- [x] Current test/build/typecheck/lint results distinguish existing failures
      from migration regressions; failures still block completion.
- [x] Baseline smoke covers loading, routing, account management, and recovery.
- [x] Public exports and persisted-data formats are inventoried.
- [x] A behavioral test audit identifies meaningful invariants, redundant tests,
      private-helper coupling, nondeterminism, and required suites missing from CI.
      Deletions require a fault-detection rationale, not a target test count.

### Proposed ownership map

This is a responsibility map, not a move list. Mixed files are split only after
the receiving boundary exists; their current path remains legacy-by-location.

| Current source                                                                                                                                                                                                 | Intended owner in the target architecture                                                                                                                                                                                                                                                                                                  |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `src/v2-plugin.ts`                                                                                                                                                                                             | Split host registration/routing into `adapters/opencode/plugin.ts`; move concrete wiring to `app/composition.ts` and request orchestration to `app/execute-request.ts`. Keep the one live request route.                                                                                                                                   |
| `src/google-sdk.ts`, `src/rpc.ts`, `src/shims.d.ts`                                                                                                                                                            | `adapters/opencode/`; preserve the isolated Google SDK module and host/RPC contracts. The SDK leaf may remain separate from `plugin.ts` to preserve its distinct module identity.                                                                                                                                                          |
| `src/tui.ts`, `src/tui-dialog-shell.tsx`, `src/tui-account-list-dialog.tsx`, `src/tui-quota-dialog.tsx`, `src/tui-quota-controller.ts`, `src/plugin/account-ui-format.ts`                                      | `adapters/opencode/tui/`; UI rendering and presentation stay out of account policy.                                                                                                                                                                                                                                                        |
| `src/hooks/auto-update-checker/{cache,checker,constants,index,logging,types}.ts`                                                                                                                               | `adapters/opencode/hooks/`; host event/toast integration remains here, with generic logging routed through its boundary.                                                                                                                                                                                                                   |
| `src/plugin/config/{index,loader,models,schema,updater}.ts`                                                                                                                                                    | `adapters/opencode/config/`; host config-file and provider/model registration details stay at the host boundary. Pass validated config values into modules rather than importing host APIs there.                                                                                                                                          |
| `src/plugin/accounts.ts`, `src/plugin/rotation.ts`                                                                                                                                                             | `modules/accounts/account-pool.ts` and `modules/accounts/selection/`; separate pool membership from selection/health policy.                                                                                                                                                                                                               |
| `src/plugin/account-service.ts`                                                                                                                                                                                | Split account administration, target resolution, DTO construction, and persistence policy into `modules/accounts/account-admin.ts`; keep RPC/TUI delivery in `adapters/opencode/`. Do not move its host client dependency into the module.                                                                                                 |
| `src/plugin/auth.ts`, account/auth portions of `src/plugin/types.ts`                                                                                                                                           | `modules/accounts/refresh/` and the accounts public contract; keep refresh-part packing and account types separate from vendor token exchange.                                                                                                                                                                                             |
| `src/plugin/refresh-queue.ts`                                                                                                                                                                                  | `modules/accounts/refresh/`; retain lifecycle ordering and inject the refresh operation.                                                                                                                                                                                                                                                   |
| `src/plugin/quota.ts`, quota portions of `src/plugin/account-service.ts`                                                                                                                                       | Split quota policy/aggregation/cache semantics into `modules/accounts/quota/`; move Antigravity HTTP and response-wire parsing to `adapters/antigravity/quota-client.ts`.                                                                                                                                                                  |
| `src/plugin/verify.ts`, `src/plugin/verification.ts`                                                                                                                                                           | Keep account verification outcomes/policy in `modules/accounts/verification/`; move Google response parsing and network calls to the Antigravity adapter. The adapter directory owns this integration even if the exact leaf is decided with the ports in step 2.                                                                          |
| `src/plugin/engine.ts`                                                                                                                                                                                         | Split the current router: cross-module retries/warmup/coordination to `app/execute-request.ts`, account selection/quota/refresh policy to `modules/accounts/`, request/response work to `modules/inference/`, Antigravity calls to `adapters/antigravity/`, and host toasts to `adapters/opencode/`. Preserve one active route throughout. |
| Account storage schema, migrations, dedupe, replace/tombstone rules in `src/plugin/storage.ts`                                                                                                                 | `modules/accounts/persistence/`; the storage contract and invariants stay with accounts.                                                                                                                                                                                                                                                   |
| Filesystem/locking/path/write portions of `src/plugin/storage.ts`                                                                                                                                              | `adapters/filesystem/account-store.ts`; implement the accounts persistence contract without moving policy into the adapter.                                                                                                                                                                                                                |
| `src/plugin/cache.ts`, `src/plugin/cache/signature-cache.ts`, `src/plugin/stores/signature-store.ts`                                                                                                           | Separate auth snapshot behavior into accounts refresh; keep signature policy and in-memory signature stores in `modules/inference/signatures/`; move disk serialization/path operations to `adapters/filesystem/signature-store.ts`.                                                                                                       |
| `src/plugin/request.ts`, `src/plugin/request-helpers.ts`, `src/plugin/transform/{claude,cross-model-sanitizer,gemini,index,model-resolver,types}.ts`, `src/plugin/core/streaming/{index,transformer,types}.ts` | `modules/inference/{request,response,transform,streaming}/`; split pure transforms from protocol-envelope/network work and keep transforms pure.                                                                                                                                                                                           |
| `src/plugin/thinking-recovery.ts`, `src/plugin/recovery.ts`, `src/plugin/recovery/{constants,storage,types}.ts`                                                                                                | `modules/session-recovery/`; separate in-request turn repair from session-error detection and repair. Keep storage needs in the module contract; OpenCode message/part layout and file access belong to `adapters/opencode/`. Inference reaches recovery only through its public contract.                                                 |
| `src/antigravity/oauth.ts`, `src/plugin/token.ts`, `src/plugin/project.ts`, `src/plugin/fingerprint.ts`, `src/plugin/version.ts`                                                                               | `adapters/antigravity/`; preserve OAuth, token, project-discovery, fingerprint, and version wire behavior.                                                                                                                                                                                                                                 |
| External-request portions of `src/plugin/request.ts`                                                                                                                                                           | `adapters/antigravity/inference-client.ts`; do not move account selection, retries, or inference policy there.                                                                                                                                                                                                                             |
| `src/plugin/errors.ts`                                                                                                                                                                                         | `modules/inference/` for inference/request errors; split only if a distinct account or adapter error contract is demonstrated.                                                                                                                                                                                                             |
| `src/plugin/image-saver.ts`                                                                                                                                                                                    | `adapters/filesystem/`; image-output path and writes are infrastructure, not inference policy. Add/fold a cohesive leaf within this adapter during migration; do not add a new top-level capability.                                                                                                                                       |
| `src/platform/logging/{index,policy,format}.ts` (moved from `src/lib/logger/index.ts` plus neutral debug helpers)                                                                                              | Keep logger contracts, debug-flag policy, and safe formatting domain- and vendor-agnostic.                                                                                                                                                                                                                                                 |
| `src/adapters/filesystem/debug-log.ts` (moved from `src/lib/logger/file.ts` plus legacy file setup)                                                                                                            | It owns paths, retention, timestamps, and disk writes; it is a destination, not a platform facility.                                                                                                                                                                                                                                       |
| `src/plugin/logger.ts`, `src/plugin/logging-utils.ts`, `src/plugin/debug.ts`                                                                                                                                   | Split neutral log event/policy/formatting into `platform/logging/`; host TUI/console delivery into `adapters/opencode/`; file paths/writers into `adapters/filesystem/debug-log.ts`. Account labels and domain context remain with their owning module.                                                                                    |
| `src/constants.ts`                                                                                                                                                                                             | Split by responsibility: Antigravity endpoints, OAuth identity, headers, and protocol metadata to `adapters/antigravity/`; provider/host identifiers to `adapters/opencode/`; model transform instructions and schema/signature values to `modules/inference/`. Do not retain a global constants dumping ground.                           |
| `src/plugin/types.ts` (remaining types)                                                                                                                                                                        | Split by ownership: host client surfaces to `adapters/opencode/`, account/auth contracts to `modules/accounts/`, inference/request/streaming contracts to `modules/inference/`, and recovery message contracts to `modules/session-recovery/`.                                                                                             |

The repository-root `index.ts` remains the package facade because package.json
publishes it; it is outside `src/` and is not a module. Build scripts and
`script/build-tui.mjs` remain package tooling. Preserve package exports `.`,
`./tui`, `./rpc`, and the named OAuth/type re-exports from `index.ts`.

### Proposed dependency direction

Arrows mean “depends on.” The proposed graph has no cycle:

```text
adapters/opencode/plugin ──▶ app/composition
                                  ├─▶ modules/accounts
                                  ├─▶ modules/inference ──▶ modules/session-recovery
                                  ├─▶ modules/session-recovery
                                  ├─▶ adapters/antigravity ──▶ module ports
                                  └─▶ adapters/filesystem ───▶ module ports

modules/accounts ──────────▶ platform/logging
modules/inference ─────────▶ platform/logging
modules/session-recovery ──▶ platform/logging
adapters/* ────────────────▶ platform/logging
```

Accounts and inference are sibling dependencies of app, not dependencies of
one another. The app supplies concrete adapters to module ports; modules never
import adapter implementations. Inference's current recovery use becomes a
public session-recovery contract; recovery does not depend back on inference.
Account-family values cross the application boundary as data, not as an import
from inference's resolver. Every module/adaptor may use platform logging, which
has no imports back into higher layers.

### Baseline contracts and formats

- Package exports: `.`, `./tui`, and `./rpc`; root `index.ts` also re-exports
  OAuth functions/types. `src/google-sdk.ts` has a separate runtime URL used by
  the host hook and must remain isolated from the plugin entrypoint.
- Account persistence is JSON schema v4 with v1→v4 load migrations, POSIX file
  mode `0600`, a 10-account cap, single-lock replace transactions, packed refresh
  values accepting two and three segments, and bounded generation-aware
  credential-free tombstones (50). See `docs/dev/account-storage.md` and
  `docs/specs/04-state-config-lifecycle.md`.
- Signature persistence is a separate disk cache (`version: "1.0"`) with
  memory/disk TTL and background writes. Session recovery currently reads
  OpenCode's host-owned `storage/message` and `storage/part` JSON layout; that
  host-version-sensitive access must remain behind an adapter.
- Runtime behavioral contracts remain those in `docs/specs/00-07`, including
  single-engine routing, Google API-key passthrough, credential isolation,
  signature preservation, replace/tombstone semantics, and provider-agnostic
  session retry recovery.

### Baseline test audit

- Post-change `bun run test` passed: 48 Vitest files, 1,146 tests. The native
  TUI renderer test is separate: `bun run test:tui` passed with 13 tests after
  a clean build. `.github/workflows/test.yml` does not invoke `test:tui`; step 3
  owns putting that suite on the normal PR path.
- `src/plugin/request.test.ts` imports `__testExports` and tests private helpers
  from `src/plugin/request.ts`. Replace only when inference boundaries expose
  the public behaviors or a helper becomes a cohesive module; do not add another
  test-only export.
- `src/constants.test.ts` has two runtime `HeaderSet` type tests and two loops
  of 50 randomized header checks. Type correctness belongs to TypeScript; random
  trials do not prove the platform invariant. Keep protocol behavior coverage,
  but make allowed platform cases deterministic rather than asserting lucky rolls.
- `src/plugin/errors.test.ts` includes generic `Error` inheritance/throw-catch,
  trivial assigned-field/reference checks, and default-message wording. Keep
  only error details that callers actually use as contract; avoid testing JS
  mechanics or freezing incidental prose.
- Account/RPC tests contain negative `JSON.stringify(...).not.toContain(...)`
  checks. Some cases also assert DTO behavior, but serialization scans are not
  structural allowlist assertions. At the DTO boundary, assert credential fields
  are absent and only intended safe fields can cross; keep string scans secondary.
- `src/plugin/account-service.test.ts` mocks several internal modules. As ports
  emerge, prefer testing account behavior through public contracts and mock
  external persistence/network/host boundaries, not internal call choreography.
- The five largest named suites are `request-helpers.test.ts` (64,157 bytes),
  `accounts.test.ts` (58,311), `gemini.test.ts` (51,747),
  `account-service.test.ts` (49,858), and `request.test.ts` (43,944). Split them
  along extracted behavior; size alone is not grounds to delete coverage.
- `accounts.test.ts` stubbed global `process` in `beforeEach` without teardown;
  `auth.test.ts` reset fake timers before tests but not after the fake-clock
  boundary case. This step added teardown in those suites and controls the
  `accessTokenExpired` clock at a fixed instant. The shared
  `test/storage-isolation.ts` restores process environment in `afterAll`.
- Several tests use clock control, and cleanup styles differ. Review cleanup
  when touching each suite; do not claim every fake timer/global is unclean from
  a textual search alone. Existing `as never` fixtures in account-service tests
  are a separate type-boundary audit, not a reason to cast normal fixtures.
- Tests should be split by semantic behavior, not one per method. Internal
  session-key equality is an implementation assertion unless a documented
  signature-cache identity contract requires it; retain exact wire-format tests.

### Step 1 baseline results

- Working tree was clean before the step. Baseline `bun run test`: 48 files,
  1,146 passed. `bun run test:tui`: clean production build plus 13 native TUI
  tests passed. `bun run typecheck` and `bun run lint` passed.
- `bun run typecheck` and `bun run lint` passed after the test cleanup.
- The initial repository-wide `bun run format:check` reported 145 files needing
  formatting, including untouched repository files and the test files later
  formatted for this task. Do not reformat unrelated files; the final
  changed-file Prettier check passed.
- Focused smoke passed 4 files / 113 tests, covering plugin setup/routing,
  native execution, account management, and recovery. Command:
  `bunx vitest run src/v2-plugin.setup.test.ts src/plugin/engine.test.ts src/plugin/account-service.test.ts src/plugin/recovery.test.ts`.
- Build evidence is the clean `bun run build` invoked by `bun run test:tui`.
- Public and storage contracts are inventoried above; the proposed dependency
  graph is acyclic by construction. No live host/OAuth call is needed for this
  baseline because the four focused suites exercise the plugin through the
  repository's mocked host boundary.
- Documentation link/count smoke passed (14 steps, 27 rules); `git diff --check`
  and changed-file Prettier passed.
- Oracle reviewed the final ownership map, dependency graph, formats, and test
  audit; no blocking findings remain. Independent code review found no blocker.
- No runtime functions or methods changed. The two test-only teardown callbacks
  add no undocumented helper functions.
- Completion commit: `test: isolate suite state and map architecture baseline`.

## 2. Establish public module APIs and ports

**Description:** Define narrow contracts before migrating implementations.
Legacy implementation may initially satisfy these contracts.

**Acceptance criteria:**

- [x] Accounts exposes deliberate pool/admin operations through `index.ts`.
- [x] Accounts and inference define external dependencies through `ports.ts`.
- [x] Recovery exposes detection, repair, and storage contracts publicly.
- [x] Contracts do not expose host-client types, filesystem paths, or adapters.
- [x] Classification ownership is explicit; accounts receives needed model
      classification instead of importing inference internals.
- [x] Boundaries preserve behavior without introducing a second execution path.

### Step 2 progress notes

- Public account, inference, and session-recovery contracts are under
  `src/modules/{accounts,inference,session-recovery}/`; their port types omit
  OpenCode client and filesystem implementation types.
- Current behavior is reached through temporary adapters in
  `src/app/legacy-bridges/`. The account selection bridge passes inference's
  family/model/quota-group result as data; legacy direct account callers retain
  a compatibility fallback until their later migration.
- Recovery ports include the storage reads/repairs and the semantic operation
  for injecting synthetic tool results. The current filesystem and host-backed
  recovery code remains the implementation for now.
- Remove each legacy bridge when its destination module and host adapter own the
  corresponding behavior; Step 14 must leave no `legacy-bridges/` facade.
- Validation: `bun run test` passed (49 files / 1,147 tests);
  `bun run test:tui` passed after a clean build (13 tests); typecheck, lint,
  changed-file Prettier, and `git diff --check` passed. Focused smoke passed
  (5 files / 114 tests), covering plugin setup/routing, account administration
  and classification, request execution, and session recovery.
- Oracle follow-up confirmed the recovery port can represent synthetic tool
  results and found no remaining contract blocker. Independent review found no
  actionable findings. Public contracts and JSDoc were audited; no host-facing
  package exports changed.
- Completion commit: `refactor: define module contracts and legacy bridges`.

## 3. Introduce mechanical boundary checks

**Description:** Enforce new boundaries incrementally while legacy remains.
Make required automated suites gate normal CI.

**Acceptance criteria:**

- [x] Cross-module imports use deliberate public contracts; deep imports fail.
- [x] Modules cannot import adapters or app; platform cannot import any of them.
- [x] Circular dependencies are detected.
- [x] Legacy exceptions are explicit and scoped, not blanket exclusions.
- [x] A deliberately invalid import demonstrably fails boundary validation.
- [x] Full Vitest and native Bun TUI suites gate PRs; neither is silently skipped.

### Step 3 progress notes

- Added `bun run check:boundaries`, a TypeScript-resolved import check covering
  static imports, re-exports, literal dynamic imports (including options),
  CommonJS requires, `.js`-to-`.ts` paths, public module files, dependency
  direction, external package policy, and runtime-only cycles. Type-only edges
  still obey layer rules but do not form runtime cycles.
- Modules and platform permit the pure `zod` dependency; other external
  packages must be routed through an adapter/port or receive a reviewed,
  explicit allowance. Accounts and inference remain independent; inference may
  depend on session recovery's public API.
- Four exact legacy-bridge import allowances name their removal steps in
  `script/boundary-exceptions.json`. At Step 3, the pre-existing
  debug/logger/storage cycle was recorded as three exact edges with Step 4 as
  its removal checkpoint; Step 4 removed the cycle and its exception manifest.
- The invalid-fixture CLI smoke returned nonzero and identified the offending
  source line and private target. Checker fixtures passed (7 tests / 22
  expectations), including side-effect imports/re-exports, type-only versus
  runtime cycles, dynamic-import options, and exception scoping.
- CI now runs the boundary check and fixtures, full Vitest, and the native TUI
  suite; `test:tui` supplies the clean build previously run as a separate step.
  Vitest uses at most two workers to avoid host CPU-count-driven memory
  exhaustion without changing test selection.
- Validation: `bun run check:boundaries`, `bun run check:boundaries:test`,
  `bun run test` (49 files / 1,147 tests), and `bun run test:tui` (clean build
  / 13 tests) passed. Typecheck, lint, changed-file Prettier, and
  `git diff --check` passed.
- Oracle consultation found no remaining blocker. Review findings for package
  policy, exact cycle exceptions, empty imports/re-exports, and dynamic import
  options were resolved; final review found no actionable findings. Checker
  helpers and test helpers were JSDoc-audited; no product runtime behavior was
  changed.
- Completion commit: `build: enforce architecture boundaries and required test suites`.

## 4. Separate logging facilities from logging destinations

**Description:** Move neutral facilities into `platform/logging/`, file logging
into `adapters/filesystem/debug-log.ts`, and host behavior into its adapter.

**Acceptance criteria:**

- [x] Platform logging has no account/inference/vendor/host policy.
- [x] File paths and writes remain outside modules and platform logging.
- [x] Redaction, graceful failure, and debug flags retain their behavior.
- [x] `debug` and `debug_tui` remain independently effective.
- [x] Logging behavior tests and a built-package logging smoke pass.

### Step 4 progress notes

- Moved structured log events, sink dispatch, debug-flag policy, and neutral
  safe formatting into `src/platform/logging/`. Console and OpenCode TUI
  delivery now live in `src/adapters/opencode/logging.ts`; file path selection,
  retention, timestamped writes, and config ignore updates live in
  `src/adapters/filesystem/`.
- `plugin/logger.ts` remains the compatibility facade; `plugin/debug.ts` keeps
  Antigravity request/account trace context and header redaction. The storage
  module retains its existing `.gitignore` exports and reporting via wrappers;
  account storage behavior was not moved.
- Removed the Step 3 runtime-cycle exception after breaking the debug → storage
  edge. The boundary checker passes with no cycle allowance. Debug `close()`
  waits for the file stream to close; reinitialization and explicit disposal
  release the active destination.
- Existing behavior remains covered: file/TUI/console flags are independent;
  request Authorization values remain redacted; text previews remain bounded;
  file timestamps, 25-log retention, and best-effort failures are tested.
  Built-artifact smoke passed for file-only and TUI-only output, redaction, and
  an unavailable file destination.
- Anchored the local `/opencode/` ignore rule to the repository root after
  review found it also ignored the required nested
  `src/adapters/opencode/logging.ts` implementation.
- Validation: `bun run check:boundaries`, boundary checker fixtures (7 tests /
  22 expectations), `bun run test` (52 files / 1,152 tests), `bun run test:tui`
  (clean build / 13 tests), and `bun run test:logging:smoke` passed. Typecheck,
  lint, changed-file Prettier, and `git diff --check` passed.
- Oracle found no remaining blocker. Review findings about stream disposal and
  smoke cleanup were resolved. The debug-policy finding was checked against
  baseline runtime behavior and normative rules: runtime already enabled
  `debug_tui` independently, and the new platform policy preserves that
  required behavior. Runtime functions and new test helpers were JSDoc-audited.
- Completion commit: `refactor: separate logging facilities from destinations`.

## 5. Extract account persistence

**Description:** Separate accounts persistence policy/contracts from
`adapters/filesystem/account-store.ts` implementation.

**Acceptance criteria:**

- [x] Accounts needs no filesystem or locking implementation knowledge.
- [x] Store versions, paths, deduplication, and migrations remain compatible.
- [x] Replace transactions, atomic tombstones, and stale-save protection remain.
- [x] Unknown/stale mutation targets fail closed without writes.
- [x] Persistence smoke uses an isolated store, never real accounts.

### Step 5 progress notes

- Moved persisted account types, V1→V4 migrations, deduplication, merge and
  replacement policy, and generation-aware tombstones to
  `src/modules/accounts/persistence/`. The account module has no filesystem,
  locking, path, or Node crypto dependency; token fingerprinting is supplied as
  a ported function.
- `src/adapters/filesystem/account-store.ts` implements the account persistence
  port and owns config paths, Windows legacy-path migration, permissions,
  locking, parsing/writes, and atomic replacement. The existing
  `src/plugin/storage.ts` remains a compatibility facade for later migration
  steps; account pool/selection and administration were not relocated.
- Preserved the explicit `clearTombstones` full-replacement path, including its
  intentional no-read behavior for corrupt stores. Ordinary merge, replace,
  and update transactions still fail closed on unreadable data. Regression
  coverage also protects no-op writes, failed mutations, stale-save deletion,
  re-add generations, and stale/unknown mutation targets.
- Added `bun run test:account-store:smoke`, exercised against built modules and
  a temporary `OPENCODE_CONFIG_DIR` with synthetic credentials only. It passed
  v2 migration/persistence, tombstone protection against a stale save, and
  corrupt-store preservation. The existing built logging smoke also passed.
- Validation: `bun run check:boundaries`, boundary fixtures (7 tests / 22
  expectations), `bun run test` (53 files / 1,157 tests), `bun run test:tui`
  (clean build / 13 tests), `bun run test:account-store:smoke`, and
  `bun run test:logging:smoke` passed. Typecheck, lint, changed-file Prettier,
  and `git diff --check` passed.
- Oracle found no remaining blocker. Review findings were resolved: the
  migration save merges against freshly read, locked disk tombstones; explicit
  `clearTombstones` no-read replacement matches baseline behavior and is tested.
  Runtime functions and test helpers were JSDoc-audited.
- Completion commit: `refactor: separate account persistence policy from filesystem storage`.

## 6. Migrate account pool and selection

**Description:** Move pool ownership into `account-pool.ts` and selection,
health, cooldown, and rotation policies into `selection/`.

**Acceptance criteria:**

- [x] Sticky, round-robin, and hybrid strategies preserve behavior.
- [x] Limits, durable identity, and bookkeeping remain unchanged.
- [x] Selection depends on neither inference internals nor transports.
- [x] Failure and rate-limit state have explicit ownership.
- [x] Behavioral tests cover rotation, exhaustion, and cancellation with
      controlled time and independently derived expectations.

### Step 6 progress notes

- Moved the account manager implementation into
  `src/modules/accounts/account-pool.ts`; injected time, randomness, persistence,
  identity, fingerprint, and logging dependencies. Pool membership, family
  cursors, stable IDs, failure bookkeeping, and transactional save/tombstone
  behavior remain in the accounts module. The plugin-facing
  `src/plugin/accounts.ts` facade and engine route remain intact.
- Moved health/token-bucket trackers, hybrid selection, backoff classification,
  and retry policy into `src/modules/accounts/selection/`. Kept the shared
  index-keyed trackers and setup configuration; `src/plugin/rotation.ts` remains
  a compatibility facade. The account module has no inference or transport
  implementation imports.
- Moved selection tests with the policy and replaced stochastic range loops
  with controlled randomness/time. Added pool tests for sticky, round-robin,
  hybrid, cooldown exhaustion/recovery, and an engine integration test proving
  cancellation clears an active exhaustion wait before request dispatch.
- Extended the built-package account-store smoke to construct the module pool
  against an isolated synthetic config directory and verify selection and
  persisted bookkeeping, in addition to existing migration, stale-delete, and
  corrupt-store checks. No real account files are read or written.
- Updated system, subsystem, lifecycle, testing, and developer architecture
  references; audited runtime/test-helper JSDoc.
- Validation: `bun run test` (55 files / 1,166 tests), `bun run test:tui`
  (clean build / 13 tests), typecheck, lint, boundary check and fixtures
  (7 tests / 22 expectations), changed-file Prettier, `git diff --check`,
  account-store/pool smoke, and logging smoke all passed.
- Oracle found no blocker. Review's cancellation-test finding was fixed by
  proving the exhaustion timer is pending before abort; Oracle and review
  follow-up confirmed the active-wait coverage. No unresolved findings remain.
- Completion commit: `refactor: migrate account pool and selection policies`.

## 7. Extract Antigravity account communication

**Description:** Establish adapter OAuth/token/project/quota clients and connect
account policies through ports.

**Acceptance criteria:**

- [ ] HTTP requests, headers, endpoints, and wire parsing live in the adapter.
- [ ] Scheduling, quota decisions, and eligibility stay module-owned.
- [ ] One unified token-refresh path remains.
- [ ] OAuth state checks, degraded discovery, and `invalid_grant` cleanup remain.
- [ ] Quota zero/unknown/windows/last-good-cache semantics remain unchanged.
- [ ] Verification transport has an explicit Antigravity integration owner.

## 8. Migrate account administration and lifecycle policies

**Description:** Move admin use cases into `account-admin.ts` and quota,
verification, and refresh policies into their accounts subdirectories.

**Acceptance criteria:**

- [ ] Administration does not depend directly on host clients.
- [ ] Credential-free results are distinct from RPC schemas/TUI presentation.
- [ ] Refresh queue start/stop/replacement ordering is preserved.
- [ ] Mutations/auth changes still invalidate and reset the manager correctly.
- [ ] List/quota/verify/enable/disable/select/delete/delete-all contracts remain.
- [ ] Admin smoke covers success, stale targets, and failure handling.

## 9. Migrate session recovery

**Description:** Separate detection/repair; make `storage.ts` express recovery
storage needs rather than filesystem implementation.

**Acceptance criteria:**

- [ ] Recovery knows neither host clients nor host message-file layouts.
- [ ] Adapters provide message access/execution through explicit contracts.
- [ ] In-request repair and session-error recovery remain distinct and work.
- [ ] Gates, auto-resume, deduplication, tool results, and toast rules remain.
- [ ] Provider-agnostic `session.retry` remains provider-agnostic.
- [ ] Smoke covers interrupted tools and disabled recovery.

## 10. Migrate inference transforms and signature ownership

**Description:** Move transformations, model resolution, sanitization, and
signature policy into inference; separate disk signature persistence.

**Acceptance criteria:**

- [ ] Pure transforms remain pure.
- [ ] Inference owns signature policy/memory; filesystem owns disk access.
- [ ] Claude stripping/reinjection and Gemini signature/order rules remain.
- [ ] Cache-miss behavior, schema cleaning, and search/tool mutex remain.
- [ ] Inference accesses recovery only through its public API.
- [ ] Tests use cohesive public behavior, not `__testExports` access.

## 11. Migrate inference request, response, and streaming pipelines

**Description:** Complete inference pipelines and extract communication into
`adapters/antigravity/inference-client.ts`.

**Acceptance criteria:**

- [ ] The client owns communication, not selection or app orchestration.
- [ ] Inference does not call concrete HTTP/filesystem implementations.
- [ ] SSE, reasoning conversion, signatures, and cleanup remain compatible.
- [ ] Fallback, aborts, empty responses, and error classification retain behavior.
- [ ] Streaming/non-streaming smoke passes for affected model families.
- [ ] Wire-envelope handling versus inference policy is explicitly reviewed.

## 12. Extract application execution and composition

**Description:** Split engine responsibilities into their owners; coordinate
modules in `execute-request.ts` and wire adapters in `composition.ts`.

**Acceptance criteria:**

- [ ] Exactly one request execution path remains active.
- [ ] Path-specific native-engine requirements and documentation are reconciled
      with its new location before legacy removal, preserving the single-router
      invariant and routing/auth-isolation behavior.
- [ ] Composition explicitly selects adapters and supplies module ports.
- [ ] Orchestration does not absorb module-internal policy.
- [ ] Host toasts/credentials use OpenCode-owned boundaries.
- [ ] Retry timing, quota protection, warmup, fallback, and bookkeeping match.
- [ ] Engine parity tests and end-to-end request smoke pass.

## 13. Consolidate OpenCode integration and packaging

**Description:** Move registration/RPC/TUI/config/hooks and isolated SDK
integration into `adapters/opencode/`.

**Acceptance criteria:**

- [ ] `plugin.ts` delegates composition/execution rather than implementing them.
- [ ] RPC omits absent optionals, uses durable ids, and is credential-free.
- [ ] TUI rendering, keymaps, controllers, and cleanup retain behavior.
- [ ] Existing config/settings remain compatible.
- [ ] Root, `./tui`, `./rpc`, and public OAuth exports remain usable.
- [ ] SDK URL and Solid/OpenTUI compilation resolve from the built package.
- [ ] Installed-host smoke covers routing, dialogs, mutations, and recovery.

## 14. Remove scaffolding and verify the final architecture

**Description:** Remove superseded implementations/facades and reconcile
maintained documentation with the completed architecture.

**Acceptance criteria:**

- [ ] Ownership matches the target; no unexplained legacy implementation remains.
- [ ] Temporary compatibility paths and boundary exemptions are removed.
- [ ] Boundary checks pass; no deep cross-module or module-to-adapter imports.
- [ ] Every runtime function/method has appropriate JSDoc.
- [ ] Full suites, typecheck, clean build, lint, and entrypoint checks pass.
- [ ] Required behavioral suites gate normal CI.
- [ ] Final installed-host and live request smoke pass.
- [ ] Oracle/review confirm dependency graph and behavior-preservation evidence.

## Execution rules

- Existing code is legacy-by-location, not wrong-by-default. Do not relocate
  merely to tidy the tree. Create a boundary before moving implementation.
- Split large steps into reviewable tasks; each task has the same completion gate.
- Separate relocation, boundary extraction, and behavioral redesign where possible.
- Temporary facades need a removal checkpoint; never add a parallel router.
- Move tests with behavioral owners; curate public APIs, not blanket barrels.
- Apply the testing audit incrementally without discarding essential regression,
  security, protocol, or failure-path coverage. Minimal means useful, not fewest.
- Do not change the OpenCode host or commit generated output.
- Do not start the next step before the current step is complete and committed.
