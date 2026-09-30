# Maintainer operations

## Publication status

The fork (`opencode-v2-antigravity-auth`, `0.1.0`) is **not published yet**.
Until the first `npm publish`:

- Users install from a local path (`/absolute/path` or `file://` URL);
  registry pins like `opencode-v2-antigravity-auth@latest` will not resolve.
- The auto-update checker stays silent: it queries npm dist-tags for a
  package that does not exist there, and all checker failures are
  no-throw by design.
- Releases are manual for now: the release/beta/republish/dist-tag
  workflows were removed (the package is unpublished and the triage bot
  needed a provisioned self-hosted runner). Only `test.yml` runs in CI
  (typecheck + tests + build on `main` pushes and PRs). To cut a release:
  bump `version` in `package.json`, add the `CHANGELOG.md` entry, push,
  tag `v<version>`, and run `npm publish --access public --provenance`
  with `NPM_TOKEN` configured.

## Packaging

Published files (`package.json` `files`): `dist/`, `README.md`, `LICENSE`.
Entry points: `.` (`dist/index.js`), `./tui` (`dist/src/tui.js`), `./rpc`
(`dist/src/rpc.js`). The host auto-loads only `.` and `./tui` — keep RPC
handlers registered from the production server setup.

Before publishing or testing a tarball:

```bash
bun run clean && bun run build
bun run typecheck
bun run test
```

Verify the tarball contains the entry points and no stale modules (see
below), then exercise the packaged-install check in
[manual-testing.md](manual-testing.md) with a scratch `OPENCODE_CONFIG_DIR`.

## `dist/` hygiene

`dist/` is gitignored build output, but stale files survive incremental
builds: removed sources (V1 `plugin.ts`, `cli.ts`, `server.ts`, `ui/`,
`plugin/search.ts`) previously lingered as compiled `dist/src/plugin*.js`
until a clean rebuild. `bun run build` does not clean by itself, so:

- Never hand-delete individual `dist/` files — clean the directory and
  rebuild (`bun run clean && bun run build`).
- `prebuild` runs `clean` automatically; use plain `tsc` only when you
  intentionally want an incremental build.
- Do not commit `dist/` contents; the stale-module class of bug is a
  packaging issue, not a source issue.

## Version and changelog

- Bump versions and add `CHANGELOG.md` entries together. Keep an
  `## [Unreleased]` section for the V2, account-management, RPC, and
  persistence changes until the next release cut.
- The auto-update checker only rewrites the plugin pin and invalidates the
  install cache — it never installs packages.

## Triage runner (removed)

The self-hosted triage workflow (`.github/workflows/issue-triage.yml`) was
removed — it required a provisioned runner with a hardcoded checkout path.
`scripts/` (Pi-runner setup, auth helpers, quota checker) is retained but
currently unreferenced by CI; `scripts/check-quota.mjs` remains useful
standalone for debugging quota outside OpenCode. Do not treat triage
automation as plugin behavior in user docs.
