# Incremental architecture migration

## Status and scope

The target tree below is the final destination, not a file-move order.
Establish boundaries first, migrate behind them, then remove legacy locations.
Preserve behavior; perform redesigns separately.

Planning consultation with Oracle has occurred. No migration step is complete
yet. This document records the approved sequence, not proof of implementation.
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

| Step | Title                                 | Status  | Evidence / commit |
| ---- | ------------------------------------- | ------- | ----------------- |
| 1    | Baseline and ownership map            | pending | —                 |
| 2    | Public APIs and ports                 | pending | —                 |
| 3    | Mechanical boundary checks            | pending | —                 |
| 4    | Logging separation                    | pending | —                 |
| 5    | Account persistence                   | pending | —                 |
| 6    | Account pool and selection            | pending | —                 |
| 7    | Antigravity account communication     | pending | —                 |
| 8    | Account administration and lifecycle  | pending | —                 |
| 9    | Session recovery                      | pending | —                 |
| 10   | Inference transforms and signatures   | pending | —                 |
| 11   | Inference pipelines and client        | pending | —                 |
| 12   | Application execution and composition | pending | —                 |
| 13   | OpenCode integration and packaging    | pending | —                 |
| 14   | Final architecture verification       | pending | —                 |

## 1. Establish the migration baseline and ownership map

**Description:** Map every runtime file to the target architecture and capture
behavioral, packaging, and test contracts before changing implementations.

**Acceptance criteria:**

- [ ] Every runtime file has an intended owner, including constants, types,
      config, fingerprints, image saving, errors, version checks, and the SDK.
- [ ] The proposed dependency graph is acyclic.
- [ ] Current test/build/typecheck/lint results distinguish existing failures
      from migration regressions; failures still block completion.
- [ ] Baseline smoke covers loading, routing, account management, and recovery.
- [ ] Public exports and persisted-data formats are inventoried.
- [ ] A behavioral test audit identifies meaningful invariants, redundant tests,
      private-helper coupling, nondeterminism, and required suites missing from CI.
      Deletions require a fault-detection rationale, not a target test count.

## 2. Establish public module APIs and ports

**Description:** Define narrow contracts before migrating implementations.
Legacy implementation may initially satisfy these contracts.

**Acceptance criteria:**

- [ ] Accounts exposes deliberate pool/admin operations through `index.ts`.
- [ ] Accounts and inference define external dependencies through `ports.ts`.
- [ ] Recovery exposes detection, repair, and storage contracts publicly.
- [ ] Contracts do not expose host-client types, filesystem paths, or adapters.
- [ ] Classification ownership is explicit; accounts receives needed model
      classification instead of importing inference internals.
- [ ] Boundaries preserve behavior without introducing a second execution path.

## 3. Introduce mechanical boundary checks

**Description:** Enforce new boundaries incrementally while legacy remains.
Make required automated suites gate normal CI.

**Acceptance criteria:**

- [ ] Cross-module imports use deliberate public contracts; deep imports fail.
- [ ] Modules cannot import adapters or app; platform cannot import any of them.
- [ ] Circular dependencies are detected.
- [ ] Legacy exceptions are explicit and scoped, not blanket exclusions.
- [ ] A deliberately invalid import demonstrably fails boundary validation.
- [ ] Full Vitest and native Bun TUI suites gate PRs; neither is silently skipped.

## 4. Separate logging facilities from logging destinations

**Description:** Move neutral facilities into `platform/logging/`, file logging
into `adapters/filesystem/debug-log.ts`, and host behavior into its adapter.

**Acceptance criteria:**

- [ ] Platform logging has no account/inference/vendor/host policy.
- [ ] File paths and writes remain outside modules and platform logging.
- [ ] Redaction, graceful failure, and debug flags retain their behavior.
- [ ] `debug` and `debug_tui` remain independently effective.
- [ ] Logging behavior tests and a built-package logging smoke pass.

## 5. Extract account persistence

**Description:** Separate accounts persistence policy/contracts from
`adapters/filesystem/account-store.ts` implementation.

**Acceptance criteria:**

- [ ] Accounts needs no filesystem or locking implementation knowledge.
- [ ] Store versions, paths, deduplication, and migrations remain compatible.
- [ ] Replace transactions, atomic tombstones, and stale-save protection remain.
- [ ] Unknown/stale mutation targets fail closed without writes.
- [ ] Persistence smoke uses an isolated store, never real accounts.

## 6. Migrate account pool and selection

**Description:** Move pool ownership into `account-pool.ts` and selection,
health, cooldown, and rotation policies into `selection/`.

**Acceptance criteria:**

- [ ] Sticky, round-robin, and hybrid strategies preserve behavior.
- [ ] Limits, durable identity, and bookkeeping remain unchanged.
- [ ] Selection depends on neither inference internals nor transports.
- [ ] Failure and rate-limit state have explicit ownership.
- [ ] Behavioral tests cover rotation, exhaustion, and cancellation with
      controlled time and independently derived expectations.

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
