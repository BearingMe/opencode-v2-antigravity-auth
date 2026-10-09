# Maintainer operations

## First npm release

The first public version is `0.1.0`; `package.json` already has that version.
Do not publish from this release branch. Merge the release PR to `main` first,
then publish the exact `v0.1.0` commit.

Before creating the GitHub tag:

1. Confirm the npm identity and package name from the account that will own it:
   `npm whoami` and `npm view opencode-v2-antigravity-auth`. Stop if the account
   is unexpected or the package name is already taken. A registry 404 means no
   public package was found at check time; recheck immediately before publish.
2. Review the release PR and wait for its checks. Confirm `package.json` is
   still `0.1.0` and the changelog date matches the actual release date.
3. After merge, update local `main`, verify it is clean, and create the tag from
   that commit:
   ```bash
   git switch main
   git pull --ff-only origin main
   git status --short --branch
   git tag -a v0.1.0 -m "v0.1.0"
   git push origin v0.1.0
   ```
4. On GitHub, draft a release for the existing `v0.1.0` tag, target `main`, and
   use the `0.1.0` changelog entry as the notes. Leave it as a draft until npm
   publication has succeeded; this repository has no release workflow that
   publishes npm automatically.

Before the one-time public publish, authenticate locally with npm's browser
flow (`npm login --auth-type=web`), then confirm `npm whoami` again. From a clean
checkout of the tag, run the checks below and inspect `npm pack --dry-run`.
Only then run `npm publish --access public`. Do not paste or commit npm tokens.
Local publishing does not create GitHub provenance; after the first publish,
configure npm trusted publishing for GitHub Actions before automating later
releases. Do not add a publish workflow until its npm trusted-publisher settings
and GitHub approval protections are configured.

After publishing, verify `npm view opencode-v2-antigravity-auth@0.1.0 version`
and install the published version in a scratch OpenCode config before publishing
the GitHub release. npm versions are immutable; if anything looks wrong, stop
and investigate rather than trying to overwrite `0.1.0`.

## Packaging

Published files (`package.json` `files`): `dist/`, `README.md`, `LICENSE.md`.
Entry points: `.` (`dist/index.js`), `./tui` (`dist/src/tui.js`), `./rpc`
(`dist/src/rpc.js`). The host auto-loads only `.` and `./tui` — keep RPC
handlers registered from the production server setup.

Before publishing or testing a tarball:

```bash
bun run clean && bun run build
bun run typecheck
bun run test
bun run test:tui
npm pack --dry-run
```

Verify the dry-run manifest includes the package entry points and license, and
contains no stale modules or unrelated repository files. Then exercise the packaged-install check in
[manual-testing.md](manual-testing.md) with a scratch `OPENCODE_CONFIG_DIR`.

## `dist/` hygiene

`dist/` is gitignored build output, but stale files survive incremental
builds: removed sources previously lingered as compiled `dist/` output
until a clean rebuild. `bun run build` cleans via `prebuild`, so:

- Never hand-delete individual `dist/` files — clean the directory and
  rebuild (`bun run clean && bun run build`).
- `prebuild` runs `clean` automatically; use plain `tsc` only when you
  intentionally want an incremental build.
- Do not commit `dist/` contents; the stale-module class of bug is a
  packaging issue, not a source issue.

## Version and changelog

- For this first release, `package.json` is already `0.1.0`; confirm the
  `CHANGELOG.md` release date on the day of publication. For future releases,
  bump the version and add the matching changelog entry together, preserving an
  `## [Unreleased]` section for work after the release.
- The auto-update checker only rewrites the plugin pin and invalidates the
  install cache — it never installs packages.

## Standalone quota diagnostic

`scripts/check-quota.mjs` can inspect quota outside OpenCode and is not run by
CI. Its duplicated OAuth client secret is an accepted compatibility risk
documented in [the external contract notes](../specs/06-external-testing-compat.md).
Do not treat the removed self-hosted triage workflow as plugin behavior.
