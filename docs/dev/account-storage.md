# Account storage

## File and schema

- Location: `antigravity-accounts.json` under `OPENCODE_CONFIG_DIR` or
  `~/.config/opencode/` (all platforms). Legacy Windows
  `%APPDATA%\opencode\` installs migrate (rename, then copy fallback).
- Schema version: **v4** (migrations v1 → v4 run on load). File mode `0600`.
- Cap: **10 accounts**. Dedupe by refresh token, then case-insensitive
  email (newest `lastUsed`/`addedAt` wins). Cancelling OAuth writes nothing.
- Per-account state: refresh token, `projectId`/`managedProjectId`, email,
  `enabled`, rate-limit/cooldown maps, consecutive-failure counters,
  fingerprint + history (max 5), cached quota + timestamp, verification
  fields, durable opaque `id`.
- Cursors: global `activeIndex` plus per-family `activeIndexByFamily`
  (`claude`, `gemini`).

The v3-shaped example that used to appear in user docs is obsolete; do not
restore it. Pre-id accounts report a deterministic token fingerprint until a
service write backfills a durable id — that fallback never resolves as a
mutation target (fail closed).

## Transaction discipline

- All `account-service.ts` writes (`persistOAuthAccount`, `mutateAccount`,
  `verifyAccount`, `persistRefreshRotation`, quota-rotation persistence) run
  as single-lock `updateAccounts` read-modify-write transactions that
  **replace** the file without merging.
- `AccountManager.saveToDisk` also writes through `updateAccounts`: disk is
  the source of truth for membership, tombstoned entries are never
  re-appended, and only tokens the manager refreshed itself are written back
  (a stale untouched token never clobbers a newer service rotation).
- Deletions (`mutateAccount` delete, `deleteAllAccounts`, manager
  `removeAccount` for `invalid_grant` eviction) tombstone the removed
  identity **in the same transaction**; every load/persist path filters
  tombstoned entries.
- Rule: deletes must use replace semantics, never merging save. The merging
  saver exists for token-rotation paths only; using it for deletes
  resurrects removed accounts.

## Tombstones

- Removed accounts leave credential-free tombstones (`removedAccounts`):
  durable `id` when known, refresh-token fingerprint, normalized email,
  `removedAt`. Matching is generation-aware (`storage.ts ::
tombstoneMatchesAccount`): equal ids match only with a corroborating
  token fingerprint or email; equal token fingerprints always match (the
  credential identifies itself across the pre-id upgrade path); email alone
  matches only as a legacy fallback when neither side has id or token
  material. In particular, a re-added generation (fresh id and fresh token
  under the same email) never matches the stale deletion, so a stale save
  cannot poison it — and a fresh OAuth login for the same identity clears
  its tombstone through the dedupe path.
- Retention is bounded at `MAX_TOMBSTONES` (50): protection covers the 50
  most recent deletions. Past that, the oldest identity could reappear via a
  stale snapshot — accepted to keep the file small given the 10-account cap.
  There is no "unreappearable" subset worth pruning preferentially.

## Credential source

`getAuth()` in `src/v2-plugin.ts` resolves the active host `antigravity`
connection first, then the in-memory `currentAuth`, then the selected saved
account. It never reads OpenCode's `google` connection. This integration only
registers the plugin's own OAuth method; a non-OAuth active Antigravity
connection defensively returns `{ type: "none" }` rather than silently using
a saved OAuth account.

Consequences:

- Account mutations persist to the plugin store. The native engine selects
  from that account pool; the integration credential only supplies OAuth
  identity for the request path.
- The server plugin context exposes only `connection.active` /
  `connection.resolve` (no credential removal). The plugin must not touch
  OpenCode's Google credentials. Tombstones cover the plugin store only.

## Refresh packing

All persisted/compared refresh values round-trip through
`parseRefreshParts` / `formatRefreshParts`. Accept the 2-segment
`refresh|project` form (written by the OAuth exchange) as well as the
3-segment form with `managedProjectId`. The authorize callback re-packs as
`` `${refresh}|${projectId}` `` while also formatting `currentAuth` — keep
parsing tolerant; do not "simplify" this into a single encoding without
handling both forms.
