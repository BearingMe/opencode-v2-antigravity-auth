# Quota contract

Source of truth for what `/antigravity` quota figures mean, where each value
comes from, and what is deliberately not shown. Anything without a real
source renders as unknown.

## Field sources

| DTO field                                                     | Source                                                                                                                   | Notes                                                                                                                                                                                                                                                                                                                                   |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `groups.<claude\|gemini-pro\|gemini-flash>.remainingFraction` | `fetchAvailableModels` → `quotaInfo.remainingFraction`, aggregated per group in `src/plugin/quota.ts` (`aggregateQuota`) | Finite `0..1` only. Valid `0` (exhausted) and `1` (full) preserved.                                                                                                                                                                                                                                                                     |
| `groups.*.consumedPercent`                                    | Derived: `(1 - remainingFraction) * 100`, rounded to 0.1                                                                 | `null` whenever the fraction is unknown.                                                                                                                                                                                                                                                                                                |
| `groups.*.resetTime`                                          | `fetchAvailableModels` → `quotaInfo.resetTime`, earliest timestamp per group                                             | Parsed to epoch ms; unparseable/missing → `null`.                                                                                                                                                                                                                                                                                       |
| `checkedAt`                                                   | `Date.now()` at check start when the fresh check was usable; otherwise `cachedQuotaUpdatedAt`                            | The start timestamp orders concurrent checks; failed refreshes retain the last good reading's timestamp.                                                                                                                                                                                                                                |
| `freshness`                                                   | `staleAfterMs` (default 15 min) vs `cachedQuotaUpdatedAt`                                                                | `fresh` \| `stale` \| `unchecked`.                                                                                                                                                                                                                                                                                                      |
| `status`                                                      | DTO-level rollup                                                                                                         | `ok` \| `error` \| `unknown`. `error` when the attempted check failed (missing result, `status === "error"`, or `quota.error` set); else `ok` when at least one group has a known fraction; else `unknown`. A failed refresh still shows cached values (with `status: "error"`) so partial results survive individual account failures. |
| `verificationRequired`, `cooldownUntil`, `coolingDown`        | Plugin store                                                                                                             | Orthogonal to quota; shown alongside it.                                                                                                                                                                                                                                                                                                |
| `selectedByFamily`                                            | Plugin store family cursors                                                                                              | Which account routes `claude` / `gemini` traffic.                                                                                                                                                                                                                                                                                       |

## Unknown semantics

Successful presentation checks with usable fractions save a snapshot via
`updateAccounts`, matched by identity, original refresh token, and `addedAt`.
Concurrent deletes/reconnects are skipped; newer saved readings win. Failed
or entirely unknown results do not erase usable disk cache. Cache-only reads
perform no checks or writes. The TUI refreshes on mount and on request, not
on a polling timer.

Snapshot writes are best-effort. On persistence failure, the service logs a
credential-free warning and reloads the store before projecting quota. Fresh
readings survive when the checked identity/generation still matches; deletes,
reconnects, enabled state, and newer cache remain authoritative. An unavailable
store does not fall back to the pre-check account pool.

- Missing, non-finite (`NaN`, `Infinity`), or out-of-range (`< 0`, `> 1`)
  fractions are **unknown (`null`)**, never `0` or clamped. `0` means
  genuinely exhausted; `null` means "no usable reading".
- A group absent from the `fetchAvailableModels` response stays `null`.
- `aggregateQuota` takes the minimum fraction per group across the group's
  models; models without a usable fraction do not drag the group to zero.
- An account whose refresh failed or returned no known quota is labeled
  `error` / `unknown`, never rendered as a full or empty bar.

## What is not shown (deliberate)

- Quota presentation has no Gemini CLI pool. It displays only the Antigravity
  `fetchAvailableModels` groups: `claude`, `gemini-pro`, and `gemini-flash`.
- **No weekly / five-hour sections.** `fetchAvailableModels` exposes no
  window labels. Grouping stays `claude` / `gemini-pro` / `gemini-flash` (a
  model-name display aggregation, not vendor pools).

## Cancellation and timeouts

- Quota cancellation is fetch-abort only: the optional `quotaSignal` covers
  `fetchAvailableModels` combined with the internal 10 s timeout via
  `AbortSignal.any`. Token refresh and project-context resolution always run
  to completion.
- `checkSingleAccountQuota` aborts its per-account fetch on timeout while
  keeping the `Promise.race` shape, so a hung fetch releases its socket;
  other accounts still resolve independently (partial results).

| Bound                            | Value                                      | Where                                                     |
| -------------------------------- | ------------------------------------------ | --------------------------------------------------------- |
| Per-fetch internal timeout       | 10 s (`FETCH_TIMEOUT_MS`)                  | `fetchWithTimeout` in `src/plugin/quota.ts`               |
| Per-account presentation timeout | `timeoutMs`, clamped 1–30 s (default 12 s) | `boundedTimeout` in `src/plugin/account-service.ts`       |
| Staleness threshold              | `staleAfterMs` (default 15 min)            | `getQuotaPresentation` in `src/plugin/account-service.ts` |

Timed-out accounts resolve to `undefined` and surface as `error` (or cached
fallback) without failing the whole refresh.
