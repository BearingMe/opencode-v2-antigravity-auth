# 04 — State, Configuration, Lifecycle

## State and ownership

| State | Owner | Persistence | Invalidation |
|---|---|---|---|
| Account pool (`refreshToken, projectId, managedProjectId, email, enabled, rateLimits, cooldowns, fingerprints, cachedQuota, verification`) | `plugin/accounts.ts :: AccountManager`, persisted by `plugin/storage.ts` | `antigravity-accounts.json` v4, 0600, lockfile-guarded atomic writes | `invalid_grant` evicts; `saveAccountsReplace` for deletes; `clearAccounts` on non-OAuth loader |
| OAuth session (`currentAuth`, native manager) | `v2-plugin.ts :: setup` closure | Memory only | Auth change / account mutation resets native manager (stops refresh queue, clears cached state) |
| Project context cache | `plugin/project.ts` keyed by refresh (+pending dedup) | Memory | `invalidateProjectContextCache` on refresh rotation / `invalid_grant` |
| Auth cache (refresh→details, prefer unexpired) | `plugin/cache.ts` | Memory | `clearCachedAuth` on `invalid_grant` |
| Thinking-signature cache | `plugin/cache.ts` + `cache/signature-cache.ts` + `stores/signature-store.ts` | Memory (1 h, 100/session, expiry-then-oldest-quarter evict) + disk (48 h, 60 s write batch, `sessionId:modelId` keys, version 1.0) | TTL; `keep_thinking=false` disables disk init |
| Health / token-bucket trackers | `plugin/rotation.ts` singletons | Memory (time-decayed) | `initHealthTracker/initTokenTracker` on setup |
| Rate-limit / failure maps, warmup sets, toast cooldowns, child-session tracker | `plugin/engine.ts` module level + `v2-plugin.ts :: createChildSessionTracker` | Memory, bounded (warmup 1000 LRU, toasts 100, 5 s cooldown, child sessions 1000 with oldest eviction, duplicate-at-capacity safe) | Time-based reset (dedup 2 s, state 120 s, failure 120 s) |
| Proactive refresh queue | `plugin/refresh-queue.ts` | Memory timers (5 s initial + interval; buffer 1800 s default, check 300 s) | `stop()` on teardown / loader re-entry |
| Update-check once-flag | `hooks/auto-update-checker/index.ts` closure | Memory per plugin instance | N/A (once per instance) |

### Rule: R-STATE-DELETE-USES-REPLACE

**Requirement:** Account deletion and `delete_all` MUST use
`saveAccountsReplace`. `saveAccounts` (merge-by-refreshToken) MUST NOT be
used for deletes — it can resurrect deleted accounts.

**Status:** Explicit (implementation + test evidence).

### Rule: R-STATE-PACKED-REFRESH

**Requirement:** All persisted/compared refresh values MUST round-trip
through `parseRefreshParts / formatRefreshParts`. Code MUST accept the
2-segment `refresh|project` form (written by `antigravity/oauth.ts`) as
well as the 3-segment form with `managedProjectId`.

**Status:** Explicit.

## Configuration

Sources (precedence): user `~/.config/opencode/antigravity.json` THEN
project `.opencode/antigravity.json` (partial Zod, `signature_cache`
deep-merged) — `plugin/config/loader.ts :: loadConfig`; runtime singleton
`initRuntimeConfig / getKeepThinking`.

Key knobs and defaults (`config/schema.ts :: DEFAULT_CONFIG`): `quiet_mode`,
`toast_scope root_only|all`, `debug/debug_tui/log_dir`, `keep_thinking`,
`session_recovery/auto_resume/resume_text`, `signature_cache{enabled,
memory/disk/write}`, empty-response retries, `tool_id_recovery`,
`claude_tool_hardening/prompt_auto_caching`, proactive refresh
`{enabled, buffer 1800 s, interval 300 s}`, `max_rate_limit_wait 300 s`,
`cli_first`, `account_selection sticky|round-robin|hybrid` (default hybrid),
`pid_offset`, `switch_on_first`, scheduling `cache_first|balance|
performance_first`, `max_cache_first 60`, `failure_ttl 3600`,
soft quota `soft_quota 90` / `quota_refresh 15` / ttl-auto,
health/token-bucket params, `auto_update`, `claude_prompt_auto_caching`
(1.6.0, default off).
`quota_fallback` is deprecated and ignored (Gemini fallback across pools is
always on; see `quota-fallback.test.ts`).
Header-normalization note (1.5.0): `x-goog-user-project` is stripped for all
styles. Debug-sink split (1.6.0): `debug` = file only, `debug_tui` = TUI only.

Validation: Zod partial schemas; malformed JSONC in the update checker is
tolerated (`continue` / null, no-throw — `checker.test.ts`).

## Lifecycle

Init (V2 `setup`): load config → runtime config
→ debug → logger → `await initAntigravityVersion()` (non-blocking intent but
awaited; falls back to `1.18.3`) → health/token trackers → disk signature
cache (if `keep_thinking`) → recovery hook → update-checker hook →
event handler → auth loader (builds `AccountManager`, starts refresh queue).

Runtime events: `session.created` (child detection + update check),
`session.error` (recovery + optional resume), V2 `session.retry`
(forward to legacy), V2 event-subscription fan-out (all events to legacy
with `session.created` reshaped to `{info:{parentID}}`).

### Rule: R-LIFECYCLE-ROOT-ONLY-CHILD

**Requirement:** Child sessions (`session.created` with `info.parentID`)
MUST NOT initiate update checks and SHOULD have toasts suppressed when
`toast_scope=root_only`. Detecting a child session MUST NOT consume the
update-checker once-flag (a later root session MUST still check).

**Project evidence:** `src/v2-plugin.ts` event handling +
`hooks/auto-update-checker/index.ts`; `index.test.ts` ::
once-per-instance, child ignored.

**Status:** Explicit.

Teardown: abort event loop, `disposeAntigravityRuntimeResources()`.
