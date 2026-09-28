# AGENTS.md

Guidance for AI agents working with this repository.

## Overview

OpenCode plugin for Google Antigravity OAuth. Intercepts `fetch()` calls to `generativelanguage.googleapis.com`, transforms them to Antigravity format, and handles auth, quota, recovery, and multi-account rotation.

## Build & Test Commands

Package and workflow scripts use Bun (`npx --yes bun@1.4.2` if bun is not directly in PATH):

```bash
bun install                          # Install dependencies (or: npx --yes bun@1.4.2 install)
bun run build                        # Compile (tsc -p tsconfig.build.json)
bun run typecheck                    # Type-check only (tsc --noEmit)
bun run test                         # Run all tests (vitest run)
bunx vitest run src/plugin/auth.test.ts          # Single test file (or: npx --yes bun@1.4.2 x vitest ...)
bunx vitest run -t "test name here"              # Single test by name
bunx vitest --watch src/plugin/auth.test.ts      # Watch mode, single file
bun run test:coverage                # Coverage report
bun run test:e2e:models              # E2E: model availability check
bun run test:e2e:regression          # E2E: regression suite
```

No linter or formatter is configured. Style is enforced by convention (see below).

## TypeScript Configuration

- `strict: true` with extra strictness: `noUncheckedIndexedAccess`, `noImplicitOverride`, `noFallthroughCasesInSwitch`
- `verbatimModuleSyntax: true` — use `import type` for type-only imports
- `target: ESNext`, `module: Preserve`, `moduleResolution: bundler`
- `allowImportingTsExtensions: true` — use `.ts` extensions in imports
- No path aliases — all imports are relative

## Code Style

### Imports
- Use `import type { ... }` for type-only imports (enforced by `verbatimModuleSyntax`)
- Named imports only — no default imports in src/
- Relative paths with `.ts` extensions: `import { foo } from "./bar.ts"`
- Order: node builtins > external packages > local modules

### Exports
- Named exports only in src/ — no default exports
- Barrel files (index.ts) for module surfaces

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
├── plugin.ts                # Main entry, fetch interceptor
├── constants.ts             # Endpoints, headers, API config, system prompts
├── antigravity/oauth.ts     # OAuth token exchange
└── plugin/
    ├── auth.ts              # Token validation & refresh
    ├── request.ts           # Request transformation (core logic)
    ├── request-helpers.ts   # Schema cleaning, thinking filters
    ├── thinking-recovery.ts # Turn boundary detection
    ├── recovery.ts          # Session recovery (tool_result_missing)
    ├── quota.ts             # Quota checking (API usage stats)
    ├── cache.ts             # Auth & signature caching
    ├── accounts.ts          # Multi-account management & storage
    ├── storage.ts           # Persistent storage schemas (Zod)
    ├── fingerprint.ts       # Device fingerprint generation & headers
    ├── project.ts           # Managed project context resolution
    └── debug.ts             # Debug logging utilities
```

## Key Design Patterns

### 1. Request Interception
Plugin intercepts `fetch()` for `generativelanguage.googleapis.com`, transforms to Antigravity format. Two header styles: `antigravity` (Electron-style UA + fingerprint) and `gemini-cli` (nodejs-client UA).

### 2. Claude Thinking Blocks
ALL thinking blocks are stripped from outgoing requests for Claude models. Claude generates fresh thinking each turn. This eliminates signature validation errors.

### 3. Session Recovery
When tool execution is interrupted (ESC/timeout), the plugin injects synthetic `tool_result` blocks to recover the session without starting over.

### 4. Schema Sanitization
Tool schemas are cleaned via allowlist. Unsupported fields (`const`, `$ref`, `$defs`) are removed or converted to Antigravity-compatible format.

### 5. Multi-Account Load Balancing
Accounts rotate on rate limits. Gemini has dual quota pools (Antigravity headers + Gemini CLI headers). Fingerprints are per-account and regenerated on capacity exhaustion.

### 6. Fingerprint System
Per-account device fingerprints stored in `antigravity-accounts.json`. Each fingerprint includes deviceId, sessionToken, userAgent, and a reduced clientMetadata (ideType, platform, pluginType — no osVersion, arch, or sqmId). The only header composed is `User-Agent`, built by `buildFingerprintHeaders()` in `fingerprint.ts` and applied on the antigravity request path in `request.ts`. History tracked (max 5), restorable.

## Dependencies

- `zod ^4` — schema validation (NOT zod v3)
- `@opencode-ai/plugin` — OpenCode plugin interface
- `@openauthjs/openauth` — OAuth client
- `proper-lockfile` — file locking for concurrent access
- `xdg-basedir` — XDG directory resolution

## Testing

- Framework: **Vitest 3** with native ESM
- Config: `vitest.config.ts`
- Tests colocated: `src/plugin/foo.test.ts` next to `src/plugin/foo.ts`
- Use `describe`/`it`/`expect` — standard Vitest API
- Mock with `vi.fn()`, `vi.spyOn()`, `vi.mock()`

## Oracle

Oracle is a high-confidence technical advisor for difficult reasoning, consequential decisions, and resolving uncertainty. It complements repository exploration and documentation retrieval rather than replacing them.

### When to use Oracle

Consult Oracle when the task involves:

- consequential architectural or design decisions
- ambiguity that remains after reasonable exploration
- reasoning across multiple subsystems or sources of evidence
- conflicting code, documentation, requirements, or assumptions
- subtle correctness, concurrency, security, migration, or data-integrity concerns
- unfamiliar systems where choosing the wrong approach would be expensive
- debugging where evidence has been gathered but the underlying cause remains unclear
- validating an important assumption before committing to it
- challenging a proposed approach when an independent technical assessment would materially reduce risk

Do not use Oracle for routine retrieval or mechanical work. Finding files, symbols, implementations, usages, documentation, or straightforward facts should normally be handled through repository exploration or documentation tools.

A useful distinction:

- **Explore** answers: *What exists? Where is it? How is it currently implemented?*
- **Documentation tools** answer: *What does the external API/library officially support?*
- **Oracle** answers: *Given the evidence and constraints, what is actually going on, what assumptions are safe, and what approach should we take?*

### How to use Oracle

Do the cheap investigation first. Gather the relevant code, documentation, errors, constraints, attempted approaches, and competing hypotheses before consulting Oracle.

Ask focused, decision-oriented questions with enough context for Oracle to reason about the problem. Prefer:

> "The plan assumes `SessionStore` supports concurrent writes, but its implementation performs an unlocked read-modify-write and these call sites invoke it concurrently. Is that assumption valid? What invariant should the implementation preserve?"

over:

> "Look at the session system."

Treat Oracle's output as expert advice, not authority. Verify its claims against available evidence when practical, and do not follow recommendations that conflict with stronger repository or authoritative documentation evidence.

### Planning

During planning, use Oracle to resolve uncertainties that materially affect the architecture or implementation strategy. Incorporate useful conclusions, assumptions, constraints, and caveats into the plan so downstream workers do not need to rediscover them.

### Implementation

During implementation, follow the plan and repository evidence by default. Consult Oracle when new evidence invalidates an important assumption, exposes a consequential ambiguity, or forces a significant design choice not addressed by the plan.

If Oracle's conclusion would substantially change the approved plan, escalate the issue rather than silently redesigning the system.

### Principle

Use Oracle for **reasoning, not retrieval**.

Explore first, retrieve authoritative documentation when needed, then use Oracle where judgment remains valuable. Oracle should reduce uncertainty on decisions that matter, not become an expensive substitute for ordinary investigation.

## Documentation

- [README.md](README.md) — Installation & usage
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — Detailed architecture guide
- [docs/ANTIGRAVITY_API_SPEC.md](docs/ANTIGRAVITY_API_SPEC.md) — API reference
- [CHANGELOG.md](CHANGELOG.md) — Version history
