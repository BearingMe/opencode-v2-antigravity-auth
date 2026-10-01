# Testing

## Commands

```bash
bun install
bun run build          # tsc declarations/modules + Solid/OpenTUI view compilation
bun run typecheck      # tsc --noEmit
bun run test           # vitest run (full suite)
bun run test:tui       # clean build + native Bun rendering of the published view
bunx vitest run src/plugin/auth.test.ts   # single file
bunx vitest run -t "name"                 # single test by name
bun run test:coverage
bun run test:e2e:models      # live model availability (needs real quota)
bun run test:e2e:regression  # live regression (needs real quota)
```

No linter or formatter is configured; style is enforced by convention
(see `AGENTS.md`).

## What is covered

- `constants.test.ts`: Gemini CLI header pin, Antigravity UA format/platform
  alignment/never-Linux, header-set optionality.
- `v2-plugin.test.ts`: plugin id/setup, `normalizeFetchBody` behaviors,
  destination/path validation, OAuth callback parsing.
- `v2-plugin.accounts.test.ts`: delete-reselect, out-of-range no-write,
  list purity, blocked→disabled+URL, ok passthrough, error-without-disable.
- `v2-plugin.setup.test.ts`: full mocked V2 setup — registration, label,
  API-key passthrough, unauthenticated throw, authorize→persist, SDK route
  with `apiKey="antigravity-oauth"`, JSON-body routing, child-tracker
  duplicate-at-capacity.
- `rpc-transport.test.ts`: Effect-codec mirror of handler returns (host has
  no `@opencode/protocol` here); guards the omit-`undefined` transport rule.
- `tui-behavior.test.ts`: pure TUI gates (`isInvalidRpcResponse`,
  `isStaleMutate` — stale `{ ok: false }` takes the stale path, never the
  success toast), plus deferred missing-account notice acknowledgement,
  replacement, and unload regressions.
- `tui-quota-controller.test.ts`: overlap protection, returned error status,
  unexpected rejection/retry, late-result disposal, and navigation outcomes.
- `test/tui-quota-render.test.ts`: native Bun/OpenTUI rendering of the built
  account list verifies single-cell dot colors, the shared legend/login hint,
  disabled text fallback, search/no-match, readable light-theme input colors,
  selection, and Esc. Missing-account notice rendering and Enter/Esc commands
  are also checked. The built quota
  view (not mocked JSX): auto-refresh, loading, bar changes, failed-check
  retention, disabled accounts, full-width bars, aligned metadata, resizing,
  narrow layout, refresh-only footer, Esc command, and cleanup. The browser
  resolution condition selects Solid's reactive runtime under Bun.
- Optional host fixture verification: `antigravity-package.test.tsx` is
  opt-in in the separate test checkout. Set `ANTIGRAVITY_TUI_ENTRY`
  to the packed/installed plugin's `dist/src/tui.js`, then run the test from
  `packages/tui`. This exercises real host keymap input, dialog replacement,
  and cleanup with fixture RPC data. It skips when the installed artifact
  path is absent.
- `plugin/*` + subdirs: 20+ colocated suites — model resolution, schema and
  cross-model sanitization, quota fallback (Antigravity-first), rotation and
  hybrid selection, recovery and thinking-recovery, token, storage (v1–v4,
  tombstones, replace semantics), cache, debug/logger, verification,
  version, account-service presentation, account UI formatting.
- `engine.test.ts`: native-engine parity (routing, quota fallback, warmup
  URL, wait formatting, unified-refresh delegation).
- `hooks/auto-update-checker`: config/JSONC/entry forms, prerelease skip,
  toast-only mode, once-per-instance, child ignore, local-dev warning.

## Known gaps (do not file as regressions)

- No tests in `src/antigravity/`; `script/` E2E is excluded from typecheck
  and live-endpoint E2E needs real quota.
- The full installed host dialog stack, keyboard dispatch, and browser
  lifecycle still require [manual-testing.md](manual-testing.md). Native
  renderer/controller tests do not establish those integration behaviors.
- Live successful-OAuth completion, post-success login rendering, the
  at-cap login branch, and host credential-store state after login are
  covered by unit tests only, not live runs (user participation required).
- Version compatibility: observed host target is v2.0.18 (pinned
  `@opencode/plugin` / `@opencode/schema` 2.0.18). The codebase uses
  `provider.transform` / `model.transform`, matching the current V2 plugin
  docs — there is no `catalog.transform` naming gap; treat any such claim
  as stale.

## Conventions

- Vitest 3, native ESM; tests colocated (`src/plugin/foo.test.ts`).
- `describe`/`it`/`expect`; `vi.fn()`/`vi.spyOn()`/`vi.mock()`.
- Never use `as any`, `@ts-ignore`, or `@ts-expect-error`.
