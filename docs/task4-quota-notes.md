# Task 4 — Quota presentation notes

Source of truth for what `/antigravity` quota figures mean, where each value
comes from, and what is deliberately not shown. All displayed figures have a
real source; anything else renders as unknown.

## Field-source table

| DTO field | Source | Notes |
| --- | --- | --- |
| `groups.<claude\|gemini-pro\|gemini-flash>.remainingFraction` | `fetchAvailableModels` → `quotaInfo.remainingFraction`, aggregated per group in `src/plugin/quota.ts` (`aggregateQuota`) | Finite `0..1` only. Valid `0` (exhausted) and `1` (full) preserved. |
| `groups.*.consumedPercent` | Derived: `(1 - remainingFraction) * 100`, rounded to 0.1 | `null` whenever the fraction is unknown. |
| `groups.*.resetTime` | `fetchAvailableModels` → `quotaInfo.resetTime`, earliest timestamp per group | Parsed to epoch ms; unparseable/missing → `null`. |
| `checkedAt` | `Date.now()` at presentation build when the fresh check was usable; otherwise `cachedQuotaUpdatedAt` | See definitions below. |
| `freshness` | `staleAfterMs` (default 15 min) vs `cachedQuotaUpdatedAt` | `fresh` \| `stale` \| `unchecked`. |
| `status` | DTO-level rollup | `ok` \| `error` \| `unknown`. See definitions below. |
| `verificationRequired`, `cooldownUntil`, `coolingDown` | Plugin store (`verificationRequired`, `coolingDownUntil`) | Orthogonal to quota; shown alongside it. |
| `selectedByFamily` | Plugin store family cursors | Which account routes `claude` / `gemini` traffic. |

## Unknown semantics

- Missing, non-finite (`NaN`, `Infinity`), or out-of-range (`< 0`, `> 1`)
  fractions are **unknown (`null`)**, never `0` or clamped. `0` means
  genuinely exhausted; `null` means "no usable reading".
- A group absent from the `fetchAvailableModels` response stays `null`.
- `aggregateQuota` takes the minimum fraction per group across the group's
  models; models without a usable fraction do not drag the group to zero.
- An account whose refresh failed or returned no known quota is labeled
  `error` / `unknown`, never rendered as a full or empty bar.

## `checkedAt` / `freshness` / `status` definitions

- `useFreshQuota` is true only when a refresh was attempted, a result came
  back, its status is not `"error"`, and its quota has no `error`.
- `checkedAt = useFreshQuota ? now : cachedAt`, where `cachedAt` is
  `cachedQuotaUpdatedAt` (or `null` when never cached). A failed refresh over
  cached data therefore keeps `checkedAt == cachedQuotaUpdatedAt`: the DTO
  shows the last good reading, timestamped as such.
- `status`: `error` when the attempted check failed (missing result, result
  `status === "error"`, or `quota.error` set); else `ok` when at least one
  group has a known fraction; else `unknown`.
- `freshness`: `fresh` when the displayed values come from a usable fresh
  check; otherwise `unchecked` when nothing was ever cached, or
  `stale`/`fresh` by comparing `cachedAt` against `staleAfterMs`.
  A failed refresh still shows cached values (with `status: "error"`) so
  partial results survive individual account failures.

## No weekly / five-hour evidence

The `retrieveUserQuota` buckets carry a `tokenType` field, but no code path
consumes it: `aggregateGeminiCliQuota` reads only `modelId`,
`remainingFraction`, and `resetTime`, and `fetchAvailableModels` exposes no
window labels at all. There is no authoritative field backing separate
weekly vs five-hour limits, so the presentation shows only the supported
per-group fractions and reset timestamps — no weekly/five-hour sections.

## CLI-pool gap

The Gemini-CLI pool (`geminiCliQuota`: `retrieveUserQuota` buckets for
`gemini-3-*` / `gemini-2.5-pro`) is fetched for routing fallback but is
**intentionally not represented** in `QuotaPresentation`, which models only
the Antigravity `fetchAvailableModels` groups. Its buckets use a separate
model list and reset semantics; folding them into the same bars would
misattribute one pool's consumption to the other.

## Cancellation scope: fetch-abort only

- `checkAccountsQuota` accepts an optional 4th param `quotaSignal` used
  **only** for the two quota fetch calls (`fetchAvailableModels`,
  `fetchGeminiCliQuota`), combined with the internal 10 s timeout via
  `AbortSignal.any`. Token refresh and project-context resolution are
  untouched and always run to completion.
- `checkSingleAccountQuota` creates one `AbortController` per account, passes
  its signal through, and aborts on the per-account timeout while keeping the
  `Promise.race` shape — so a hung fetch releases its socket instead of
  lingering after the presentation has moved on. Other accounts still resolve
  independently (partial results).

## Timeout bounds

| Bound | Value | Where |
| --- | --- | --- |
| Per-fetch internal timeout | 10 s (`FETCH_TIMEOUT_MS`) | `fetchWithTimeout` in `src/plugin/quota.ts` |
| Per-account presentation timeout | `timeoutMs` option, clamped to 1–30 s (default 12 s) | `boundedTimeout` in `src/plugin/account-service.ts` |
| Staleness threshold | `staleAfterMs` option (default 15 min) | `getQuotaPresentation` in `src/plugin/account-service.ts` |

Timed-out accounts resolve to `undefined` and surface as `error` (or cached
fallback) without failing the whole refresh.

## Bug B investigation (2026-09-30): no pool/window regrouping

A user report claimed Antigravity splits quota into Google-models vs
Claude/GPT-OSS pools with 5-hour and weekly windows, and that the
`claude` / `gemini-pro` / `gemini-flash` grouping is wrong. Evidence
review found no such shape anywhere in the repo, so no regrouping was
made — inventing vendor fields would be guessing.

Real shapes established from code (no live probe is possible here):

- `fetchAvailableModels` (`src/plugin/quota.ts`): returns
  `{ models: Record<modelId, { quotaInfo?: { remainingFraction?: number,
  resetTime?: string }, displayName?: string, modelName?: string }> }`.
  No pool, window, or duration labels exist on any field.
- `retrieveUserQuota` buckets: `{ remainingAmount?, remainingFraction?,
  resetTime?, tokenType?, modelId? }`. `tokenType` is present but no code
  consumes it and no fixture documents its values, so it cannot back a
  5-hour vs weekly split.
- Grouping (`classifyQuotaGroup`) is purely a model-name-substring
  aggregation for display; it creates no vendor pools and claims none.

Grouping therefore stays `claude` / `gemini-pro` / `gemini-flash` with
unknown-not-zero semantics unchanged (service presentation, RPC schema,
and TUI render untouched).

Live data needed from the user to revisit this (one anonymized capture
each, tokens redacted):

1. Raw `fetchAvailableModels` response JSON: the full `models` map
   including any `gpt-oss` entries and their `quotaInfo` values.
2. Raw `retrieveUserQuota` response JSON: bucket `tokenType` values and
   `resetTime` samples per `modelId`.
3. Which Antigravity surface shows "5-hour" and "weekly" labels, and
   which models each label covers.
