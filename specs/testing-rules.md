# Testing hard rules

Keep the smallest suite that detects plausible behavioral regressions. Test
requirements and boundaries, not implementation shape. These rules govern test
work during the migration; they do not authorize a wholesale test rewrite.

Examples below include original audit targets and their current status. Validate
each finding before deleting or rewriting a test. Existing
behavioral requirements remain in `docs/specs/00-07`.

## Behavior and contracts

1. Do not test private/internal helpers through `__testExports`. The request
   adapter tests exercise exported behavior; do not add a test-only API.
2. Do not write runtime tests for TypeScript types. The former runtime
   `HeaderSet` checks were removed; use typechecking or compile-time type tests
   for type contracts.
3. Do not test language/runtime guarantees. Audit generic Error inheritance,
   throw/catch, and trivial assigned-field cases in `src/modules/inference/errors.test.ts`.
4. Do not test constructor plumbing unless it is behavior. Assigned fields and
   preserved references matter only when they are explicit contracts.
5. Do not assert exact internal strings unless the string is contractual.
   Internal session keys and default error wording need semantic assertions.
6. Do not copy production constants into tests merely to assert them back.
   Derive expectations from a spec, protocol, invariant, or independent example.
7. Do not use randomness to prove correctness. Control/inject randomness or
   exhaust allowed cases; repeated lucky header generation proves no invariant.
8. Do not put loops/branching in assertions without a strong reason. Prefer
   explicit input/output cases, `it.each`, or deliberate property-based tests.
9. Do not use `JSON.stringify(...).not.toContain(secret)` as the sole security
   assertion. Primarily verify allowed DTO/RPC/serialized fields and omission or
   rejection of credential-bearing fields at the boundary; scans supplement it.
10. Do not mock internal modules merely for convenience. Mock external boundaries
    such as filesystem, clock, network, OpenCode, or Antigravity.
11. Do not assert `toHaveBeenCalledWith` unless the interaction is contractual.
    Host hook registration qualifies; arbitrary internal call choreography does not.
12. Do not casually bypass fixture types with `as any` or `as unknown as`.
    Normal fixtures must satisfy real types. Malformed-input tests should enter
    through an unknown-input boundary; any unavoidable cast needs justification.
    The repository's stricter ban on `as any` still applies.

## Determinism and test size

13. Do not mutate globals, environment, fake time, or module state without
    guaranteed cleanup. Use teardown appropriate to the runner: `afterEach`,
    `vi.restoreAllMocks`, `vi.unstubAllGlobals`, `vi.unstubAllEnvs`, and
    `vi.useRealTimers` where applicable. Restore state those APIs do not cover.
14. Do not use the real clock for time-dependent behavior. Control refresh,
    cooldown, rotation, and quota time deterministically.
15. Do not build catch-all suites around giant production files. Split tests
    along extracted behavioral boundaries. Audit `request-helpers.test.ts`,
    `accounts.test.ts`, `gemini.test.ts`, `account-service.test.ts`, and
    `request.test.ts`; file size alone is not a deletion criterion.
16. Do not give one test several unrelated responsibilities. Each test should
    normally have one semantic reason to fail; several related assertions are fine.
17. Do not require one test per method. Test behaviors, which may span methods.
18. Do not assert entire internal objects when only a few properties matter.
    Use relevant invariants or `toMatchObject`; exact equality is appropriate
    for actual wire-format and other exact contracts.
19. Do not depend on execution order or leftover state. Tests must run
    independently; use isolated reruns to investigate pollution or flakes.
20. Do not leave important automated suites outside normal CI. Vitest currently
    includes `src/**/*.test.{ts,tsx}`; native `test/tui/tui-quota-render.test.ts` uses
    `bun run test:tui`, which gates PRs in `.github/workflows/test.yml` and runs
    with a clean package build.

## Review and fault-detection value

21. Do not accept AI-written tests merely because they compile and pass. Execute
    and review them for oracle quality, determinism, and fault-detection value.
22. Do not derive the test oracle solely from the implementation being tested.
    Supply requirements, specs, bug reports, invariants, protocols, or examples.
23. Do not optimize for coverage alone. For critical pure logic, use mutation
    testing when useful to assess fault detection, not to force change detectors.
24. Do not add a regression test that also passes against the known-broken code.
    Demonstrate failure before the fix and success afterward when feasible;
    document any limitation instead of claiming that evidence exists.
25. Do not generate near-duplicate happy paths. Prioritize boundaries, invalid
    states, failure paths, and meaningful equivalence classes.
26. Do not change production merely to expose implementation details to tests.
    Reconsider the boundary before adding test-only exports/getters/functions.
27. Do not retain a test just because it exists. Delete or rewrite tests with no
    plausible regression-detection value, explaining what remains protected.

## Completion

All tests must pass before a task is complete, including both automated runners.
Do not skip, weaken, or remove a meaningful failing test to get green results.
Use the full definition of done in
[architecture-migration.md](architecture-migration.md), including consultation,
review, smoke testing, function/method documentation, and a scoped commit.
