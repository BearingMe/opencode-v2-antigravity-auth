# AGENTS.md

Guidance for AI agents working with this repository.

## Overview

OpenCode V2 plugin for Google Antigravity OAuth. Routes `antigravity-*` /
OAuth-routed `gemini-*` models through the AI SDK hook and fetch bridge into
a single native engine, transforming them to Antigravity format with auth,
quota, rotation, and recovery.

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

- Named exports only in src/ — no default exports (sole exceptions:
  `src/v2-plugin.ts` and `src/tui.ts` default-export `Plugin.define`, as
  required by the OpenCode V2 server / TUI plugin contracts)

### Naming

- `camelCase` for functions, variables, parameters
- `PascalCase` for types, interfaces, classes, enums
- `UPPER_SNAKE_CASE` for constants
- `kebab-case` for file names (e.g., `request-helpers.ts`, `thinking-recovery.ts`)
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

## Module Structure

```
src/
├── v2-plugin.ts               # V2 entry: integration/provider/model/aisdk/tool/session/event wiring
├── google-sdk.ts              # Isolated AISDK module (hook routing key)
├── rpc.ts                     # AntigravityAccounts RPC contract (credential-free)
├── tui.ts                     # /antigravity dialog UI (host-rendered dialogs only)
├── constants.ts               # Endpoints, headers, OAuth identity, model routing
├── antigravity/oauth.ts       # PKCE authorize URL + code exchange + project discovery
├── hooks/auto-update-checker/ # Version check (root sessions only; never installs)
└── plugin/
    ├── engine.ts              # Native request/rotation engine (sole router)
    ├── account-service.ts     # Shared account store service (tool + RPC backend)
    ├── account-ui-format.ts   # Quota bars, countdowns, one-liners (pure)
    ├── auth.ts / token.ts     # Refresh-part packing + unified refresh path
    ├── verify.ts / verification.ts  # Access verification + error helpers
    ├── request.ts / request-helpers.ts  # Transform core + schema/thinking utils
    ├── transform/             # Pure per-family transforms (claude/gemini/sanitizer/resolver)
    ├── core/streaming/        # SSE transformer
    ├── thinking-recovery.ts / recovery/  # Turn repair + session-error hook
    ├── quota.ts               # fetchAvailableModels + Gemini CLI quota probing
    ├── accounts.ts / storage.ts  # Pool manager + v4 persistent store (tombstones)
    ├── fingerprint.ts / project.ts  # Device fingerprints + managed project context
    ├── refresh-queue.ts / rotation.ts  # Proactive refresh + health/token-bucket scoring
    ├── config/                # Zod schema, loader, model definitions, opencode.json updater
    ├── cache/ / stores/       # Signature caches (memory + disk)
    └── debug.ts / logger.ts / logging-utils.ts / version.ts / errors.ts / types.ts
```

> Historical: V1 `src/plugin.ts`, `cli.ts`, `server.ts`, `ui/`, and
> `plugin/search.ts` (`google_search` tool) were removed; the D-SEARCH-MUTEX
> guard for model-declared web search stays in the request pipeline.

## Key Design Patterns

### 1. Request Routing

AI SDK hook + fetch bridge for `generativelanguage.googleapis.com` model
paths only; single native engine (`executeAntigravityRequest`). Two header
styles: `antigravity` and `gemini-cli` (dual Gemini quota pools).

### 2. Claude Thinking Blocks

Outgoing Claude requests strip ALL thinking blocks by default
(`keep_thinking: false`); Claude re-thinks fresh each turn. With
`keep_thinking: true`, cached signatures are re-injected (first assistant
message of a turn only).

### 3. Session Recovery

Two layers: in-request turn repair plus the session-error hook, which injects
synthetic `tool_result` blocks after interrupted tool execution. Gated by
`session_recovery`; optional `auto_resume`.

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
- Never commit `dist/` (gitignored build output). Use
  `bun run clean && bun run build`; never hand-delete individual `dist/`
  files to fix staleness.

## Documentation

- [README.md](README.md) — Install, login, `/antigravity`, links
- [docs/README.md](docs/README.md) — Full doc index (user + dev)
- [docs/dev/README.md](docs/dev/README.md) — Developer map + host target
- [docs/specs/07-rule-index.md](docs/specs/07-rule-index.md) — Normative rule lookup
- [CHANGELOG.md](CHANGELOG.md) — Version history
