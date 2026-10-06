# AGENTS.md

Guidance for AI agents working with this repository.

## Overview

OpenCode V2 plugin for Google Antigravity OAuth. Routes `antigravity-*` /
OAuth-routed `gemini-*` models through the AI SDK hook and fetch bridge into
a single native engine, transforming them to Antigravity format with auth,
quota, rotation, and recovery.

## Migration tracking (only when `specs/` exists)

- If the repository-root `specs/` directory exists, read
  `specs/architecture-migration.md` and `specs/testing-rules.md` before
  migration or test work. Otherwise, ignore this section; do not create the
  directory solely to satisfy this instruction.
- Follow the migration step order, acceptance criteria, and definition of
  done. Update its progress tracker with verified results; never mark an
  unrun, failing, or blocked check as passing.
- Keep the smallest suite that detects meaningful behavioral regressions.
  Apply the testing hard rules rather than chasing coverage or test counts.
- Each completed task requires all tests passing, Oracle consultation,
  review with blocking findings resolved, a passing scope-appropriate smoke
  test, documented functions/methods, and a scoped conventional commit.
  Do not stage unrelated work or bypass failing commit hooks.

## Build & Test Commands

Package and workflow scripts use Bun (`npx --yes bun@1.4.2` if bun is not directly in PATH):

```bash
bun install                          # Install dependencies (or: npx --yes bun@1.4.2 install)
bun run build                        # Clean dist via prebuild, then compile (tsc -p tsconfig.build.json)
bun run typecheck                    # Type-check only (tsc --noEmit)
bun run test                         # Run all tests (vitest run)
bunx vitest run src/plugin/auth.test.ts          # Single test file (or: npx --yes bun@1.4.2 x vitest ...)
bunx vitest run -t "test name here"              # Single test by name
bunx vitest --watch src/plugin/auth.test.ts      # Watch mode, single file
bun run test:coverage                # Coverage report
bun run test:e2e:models              # E2E: model availability check (needs real quota)
bun run test:e2e:regression          # E2E: regression suite (needs real quota)
bun run lint                         # Check code with ESLint
bun run lint:fix                     # Fix ESLint issues
bun run format                       # Format with Prettier
bun run format:check                 # Verify formatting with Prettier
```

Git hooks managed via Husky + lint-staged (pre-commit: eslint --fix + prettier) and commitlint (commit-msg: conventional commits).

## TypeScript Configuration

- `strict: true` with extra strictness: `noUncheckedIndexedAccess`, `noImplicitOverride`, `noFallthroughCasesInSwitch`
- `verbatimModuleSyntax: true` — use `import type` for type-only imports
- `target: ESNext`, `module: Preserve`, `moduleResolution: bundler`
- `allowImportingTsExtensions: true` for `typecheck` (`tsconfig.json`) —
  `tsconfig.build.json` sets it to `false` for emit (see Imports exception)
- No path aliases — all imports are relative

## Code Style

### Imports

- Use `import type { ... }` for type-only imports (enforced by `verbatimModuleSyntax`)
- Named imports only — no default imports in src/
- Relative paths; test sources may use `.ts` extensions (`import { foo } from "./bar.ts"`)
- Order: node builtins > external packages > local modules
- Exception: `tsconfig.build.json` sets `allowImportingTsExtensions: false`
  (TS5097 under emit), so NON-TEST runtime sources MUST use emit-compatible
  imports (`.js`-suffixed or extensionless, e.g. `./bar.js`); `.ts`-suffixed
  imports break `bun run build` even though `typecheck` accepts them

### Exports

- Named exports only in src/ — no default exports (sole runtime entrypoint
  exceptions are `src/v2-plugin.ts` and `src/tui.ts`, which re-export the
  adapter's `Plugin.define` values for the OpenCode V2 contracts)

### Naming

- `camelCase` for functions, variables, parameters
- `PascalCase` for types, interfaces, classes, enums
- `UPPER_SNAKE_CASE` for constants
- `kebab-case` for file names (e.g., `request-helpers.ts`, `account-pool.ts`)
- Test files: `*.test.ts` colocated with source

### Types

- No `I` prefix on interfaces, no `Type` suffix
- Use `z.infer<typeof Schema>` for Zod-derived types
- Extract to `types.ts` when shared, inline when local
- Discriminated unions preferred over boolean flags
- Never use `as any`, `@ts-ignore`, or `@ts-expect-error`

### Functions

- `export function` for public APIs
- Arrow functions for callbacks, factories, and inline closures
- Async functions with targeted try/catch (not blanket)

### Error Handling

- Defensive try/catch with graceful degradation (fallback values, not crashes)
- Custom error classes with metadata when domain-specific
- Catch `unknown`, log, and convert to domain errors — never empty catch blocks
- Rate limit / quota errors trigger account rotation, not failure

### Formatting

- 2-space indentation
- Double quotes for strings
- Trailing commas in multiline constructs
- No semicolons (project convention)

### Logging

- `createLogger("module-name")` for structured logging
- `console.log` only for CLI/user-facing output

### Documentation

- No file headers in `src/` modules
- Every exported symbol and private helper uses JSDoc (`/** ... */`)
- Document all runtime functions and methods, including constructors and
  private methods, when they are in the task's scope.
- For `*.test.ts`, document helper functions only (not `describe` or `it` blocks)
- Format:
  ```ts
  /**
   * <one to three lines description>
   *
   * @example <example>
   * @throws <throw when applied>
   * @deprecated <keep existing only>
   */
  ```
- Omit `@param`, `@returns`, and trailing double-space line breaks
- Use blank lines between sections, never trailing spaces
- Include `@example`, `@throws`, and `@deprecated` only when applicable

## Module Structure

```
src/
├── v2-plugin.ts / tui.ts / rpc.ts / google-sdk.ts # Compatibility entrypoints
├── constants.ts               # Endpoints, headers, OAuth identity, model routing
├── antigravity/oauth.ts       # PKCE authorize URL + code exchange + project discovery
├── app/
│   ├── composition.ts          # Selects OpenCode, account, inference, and transport adapters
│   └── execute-request.ts      # Single request execution and retry orchestration
├── adapters/
│   ├── filesystem/            # Account and recovery stores
│   └── opencode/
│       ├── plugin.ts          # V2 server registration and host lifecycle wiring
│       ├── account-pool.ts    # OpenCode/filesystem dependencies for the account pool
│       ├── rpc.ts             # Credential-free AntigravityAccounts contract
│       ├── tui/               # /antigravity host dialogs and controller
│       ├── config/            # OpenCode config, model registration, and settings
│       └── hooks/             # Host event integrations, including update checks
├── modules/session-recovery/  # Error policy, session repair, and request-time turn repair
└── plugin/
    ├── account-service.ts     # Shared account store service (tool + RPC backend)
    ├── account-ui-format.ts   # Quota bars, countdowns, one-liners (pure)
    ├── auth.ts / token.ts     # Refresh-part packing + unified refresh path
    ├── verify.ts / verification.ts  # Access verification + error helpers
    ├── request.ts / request-helpers.ts  # Transform core + schema/thinking utils
    ├── core/streaming/        # SSE transformer
    ├── quota.ts               # Antigravity per-model + grouped quota probing
    ├── fingerprint.ts / project.ts  # Device fingerprints + managed project context
    ├── refresh-queue.ts          # Proactive refresh queue composition
    ├── cache/ / stores/       # Signature caches (memory + disk)
    └── debug.ts / logger.ts / logging-utils.ts / version.ts / errors.ts / types.ts
```

> Historical: V1 `src/plugin.ts`, `cli.ts`, `server.ts`, `ui/`, and
> `plugin/search.ts` (`google_search` tool) were removed; the D-SEARCH-MUTEX
> guard for model-declared web search stays in the request pipeline.

## Key Design Patterns

### 1. Request Routing

AI SDK hook + fetch bridge for `generativelanguage.googleapis.com` model
paths only; single native engine (`executeAntigravityRequest`) routes OAuth
Gemini and Claude models through Antigravity. Ordinary Google API-key
connections keep their configured route.

### 2. Claude Thinking Blocks

Outgoing Claude requests strip ALL thinking blocks by default
(`keep_thinking: false`); Claude re-thinks fresh each turn. With
`keep_thinking: true`, cached signatures are re-injected (first assistant
message of a turn only).

### 3. Session Recovery

Two layers: in-request turn repair plus session recovery. The provider-agnostic
V2 `context` hook inserts canonical cancelled tool-result messages into
outgoing model history for dangling calls; this does not rewrite persisted
history. Session-error recovery repairs thinking blocks through the filesystem
adapter. Gated by `session_recovery`; optional `auto_resume` for thinking
repairs.

### 4. Schema Sanitization

Tool schemas are cleaned via allowlist. Unsupported fields (`const`, `$ref`,
`$defs`) are removed or converted to Antigravity-compatible format.

### 5. Multi-Account Load Balancing

Up to 10 accounts rotate on rate limits (sticky/round-robin/hybrid).
Gemini-only cross-pool fallback; Claude always Antigravity. All
`account-service.ts` writes are single-lock replace transactions; deletes
tombstone the identity (bounded, 50) so stale saves cannot resurrect it.

### 6. Account UI

Login (`opencode auth login`, one account per run) only adds/reconnects;
`/antigravity` manages via the credential-free `AntigravityAccounts` RPC
(`list`, `quota`, `verify`, `mutate`, `deleteAll`, `ping`). Mutations use
durable ids, omit `undefined` optionals, and fail closed on stale targets.

### 7. Host Boundary Rule

Never modify or couple to the OpenCode host application itself. OpenCode is an
external runtime host; this repository is strictly an out-of-tree plugin that
integrates solely through public `@opencode/plugin` APIs, typed RPC, and TUI
surfaces. Do not attempt to patch or touch OpenCode core codebase.

## Dependencies

- `zod ^4` — schema validation (NOT zod v3)
- `@opencode/plugin` — OpenCode V2 plugin interface
- `@opencode/schema` — provider/model/integration schemas
- `@openauthjs/openauth` — OAuth PKCE helpers
- `effect` — RPC/schema runtime
- `proper-lockfile` — file locking for concurrent access
- `xdg-basedir` — XDG directory resolution

## Testing

- Framework: **Vitest 3** with native ESM
- Config: `vitest.config.ts`
- Tests colocated: `src/plugin/foo.test.ts` next to `src/plugin/foo.ts`
- Use `describe`/`it`/`expect` — standard Vitest API
- Mock with `vi.fn()`, `vi.spyOn()`, `vi.mock()`
- The full `/antigravity` dialog/toast flow has no automated coverage by
  design — verify by hand via `docs/dev/manual-testing.md`

## Documentation Rules

- User guides (`docs/user/`) describe what users can do. Developer guides
  (`docs/dev/`) describe how it works and how it is verified. Normative
  rules live in `docs/specs/00-07` — link to them, do not duplicate them.
- Task plans, progress reports, transcripts, and investigation dumps do NOT
  belong in maintained docs. Keep temporary artifacts outside the repo;
  integrate only durable findings into an existing canonical document.
- Exception: when repository-root `specs/` exists, keep the requested
  migration plan, progress tracker, and migration testing rules there.
  `docs/specs/00-07` remains the source of existing behavioral requirements;
  the migration tracker does not override them.
- Never commit `dist/` (gitignored build output). Use
  `bun run clean && bun run build`; never hand-delete individual `dist/`
  files to fix staleness.

## Documentation

- [README.md](README.md) — Install, login, `/antigravity`, links
- [docs/README.md](docs/README.md) — Full doc index (user + dev)
- [docs/dev/README.md](docs/dev/README.md) — Developer map + host target
- [docs/specs/07-rule-index.md](docs/specs/07-rule-index.md) — Normative rule lookup
- [CHANGELOG.md](CHANGELOG.md) — Version history

### External quota implementation references

- [Antigravity-Manager](https://github.com/lbjlaq/Antigravity-Manager) —
  [PR 3185](https://github.com/lbjlaq/Antigravity-Manager/pull/3185) documents
  `retrieveUserQuotaSummary` and its grouped weekly/five-hour buckets.
- [OmniRoute](https://github.com/diegosouzapw/OmniRoute) —
  [`antigravityWeeklyQuota.ts`](https://github.com/diegosouzapw/OmniRoute/blob/main/open-sse/services/usage/antigravityWeeklyQuota.ts)
  contains an independent fetcher/parser for the summary response.

Both references reverse-engineer an undocumented Google endpoint. Treat them
as corroboration, not an API contract; verify fields against live Antigravity
responses before changing quota semantics.
