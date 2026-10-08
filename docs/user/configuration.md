# Configuration

Optional settings live in `antigravity.json`. Most users need nothing beyond
the `$schema` line.

Config file precedence (lowest to highest):

1. Schema defaults
2. User file: `~/.config/opencode/antigravity.json`
   (`OPENCODE_CONFIG_DIR` overrides the config directory when set)
3. Project file: `.opencode/antigravity.json` in the project root
4. `OPENCODE_ANTIGRAVITY_*` environment variables

```jsonc
{
  "$schema": "https://raw.githubusercontent.com/BearingMe/opencode-v2-antigravity-auth/main/assets/antigravity.schema.json",
}
```

Config files are validated as a whole: if any value fails validation, that
file is ignored and lower-precedence settings remain (a warning names the
offending keys).
Environment overrides are applied individually — an invalid env value warns
and is ignored on its own.

## Model behavior

| Option             | Default      | What it does                                                                                                                                                    |
| ------------------ | ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `keep_thinking`    | `false`      | Preserve Claude thinking blocks across turns via signature caching. Warning: may reduce stability. Default strips thinking so Claude re-thinks fresh each turn. |
| `session_recovery` | `true`       | Auto-recover from interrupted tool calls                                                                                                                        |
| `auto_resume`      | `false`      | Auto-send the resume prompt after recovery                                                                                                                      |
| `resume_text`      | `"continue"` | Text sent when `auto_resume` is on                                                                                                                              |

Legacy `cli_first` and `quota_fallback` settings no longer affect routing and
can be removed from existing config files. Supported Gemini OAuth requests use
Antigravity across the account pool.

## Account rotation

| Option                         | Default         | What it does                                                                                                           |
| ------------------------------ | --------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `account_selection_strategy`   | `"hybrid"`      | `sticky` (one account until rate-limited), `round-robin`, or `hybrid` (health + token bucket + stickiness)             |
| `switch_on_first_rate_limit`   | `true`          | Switch account immediately on first 429                                                                                |
| `pid_offset_enabled`           | `false`         | Spread parallel sessions across accounts by process ID                                                                 |
| `scheduling_mode`              | `"cache_first"` | `cache_first` (wait briefly, preserve prompt cache), `balance` (switch immediately), `performance_first` (round-robin) |
| `max_cache_first_wait_seconds` | `60`            | Max wait in `cache_first` mode before switching                                                                        |
| `failure_ttl_seconds`          | `3600`          | Old failures stop penalizing an account after this long                                                                |

| Your setup                  | Recommended                              |
| --------------------------- | ---------------------------------------- |
| 1 account                   | `"account_selection_strategy": "sticky"` |
| 2–5 accounts                | Default `hybrid`                         |
| 5+ accounts, max throughput | `"round-robin"`                          |
| Parallel agents             | Add `"pid_offset_enabled": true`         |

## Quota protection

| Option                           | Default  | What it does                                                                                                                                                                   |
| -------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `soft_quota_threshold_percent`   | `90`     | Skip an account once its quota usage exceeds this percent. `100` disables. Unknown/stale readings fail open (the account stays usable).                                        |
| `quota_refresh_interval_minutes` | `15`     | Refresh quota cache after successful requests when older than this. `0` disables background refresh.                                                                           |
| `soft_quota_cache_ttl_minutes`   | `"auto"` | Freshness window (`"auto"` = max(2 × refresh interval, 10 min)), or a fixed 1–120 min TTL.                                                                                     |
| `max_rate_limit_wait_seconds`    | `300`    | Cap on waiting for quota/rate-limit reset (`0` = unlimited). When every account is over threshold, the plugin waits for the earliest reset or errors once the cap is exceeded. |

## App behavior

| Option        | Default       | What it does                                                                                                                                                                                                                                                                                       |
| ------------- | ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `quiet_mode`  | `false`       | Hide routine toasts, including recovery-success toasts (`v2-plugin.ts` gates them on `!quiet_mode`). Env: `OPENCODE_ANTIGRAVITY_QUIET=1`.                                                                                                                                                          |
| `toast_scope` | `"root_only"` | `"root_only"` silences subagent/child-session toasts; `"all"` shows them. Env: `OPENCODE_ANTIGRAVITY_TOAST_SCOPE=all`. Note: request-path toasts cannot know the session, so they fail open (always show).                                                                                         |
| `debug`       | `false`       | File logging to `~/.config/opencode/antigravity-logs/` (or `log_dir`). Env: `OPENCODE_ANTIGRAVITY_DEBUG=1`, or `=2` / `=verbose` for verbose output.                                                                                                                                               |
| `debug_tui`   | `false`       | Show logs in the TUI log panel. Fully independent of `debug` — either sink works alone (covered by `debug.test.ts`). Env: `OPENCODE_ANTIGRAVITY_DEBUG_TUI=1`.                                                                                                                                      |
| `log_dir`     | OS default    | Custom directory for debug logs. Env: `OPENCODE_ANTIGRAVITY_LOG_DIR=/path/to/logs`.                                                                                                                                                                                                                |
| `auto_update` | `true`        | Version check with toast; rewrites a pinned install when applicable. Never installs packages itself. Known limitation: the checker still reads the legacy `plugin` (singular) config key and queries npm dist-tags, so with local-path installs (and until the fork is published) it stays silent. |

Debug logs can include request and response content. Keep debug logging off
unless troubleshooting, and treat generated logs as sensitive local data.
On POSIX systems, log files are created with owner-only permissions; Windows
uses the permissions inherited from the configured log directory.

## Advanced (defaults are fine for most users)

| Option                                                                                           | Default                                                                  |
| ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------ |
| `empty_response_max_attempts`                                                                    | `4`                                                                      |
| `empty_response_retry_delay_ms`                                                                  | `2000`                                                                   |
| `tool_id_recovery`                                                                               | `true`                                                                   |
| `claude_tool_hardening`                                                                          | `true`                                                                   |
| `claude_prompt_auto_caching`                                                                     | `false`                                                                  |
| `proactive_token_refresh`                                                                        | `true`                                                                   |
| `proactive_refresh_buffer_seconds`                                                               | `1800`                                                                   |
| `proactive_refresh_check_interval_seconds`                                                       | `300`                                                                    |
| `signature_cache.enabled` / `memory_ttl_seconds` / `disk_ttl_seconds` / `write_interval_seconds` | `true` / `3600` / `172800` / `60` (only used with `keep_thinking: true`) |
| `health_score.*`, `token_bucket.*`                                                               | Tuning for the `hybrid` strategy                                         |

The JSON schema (`assets/antigravity.schema.json`) is the authoritative
reference for every key. When this guide and the schema disagree, the schema
and `src/adapters/opencode/config/schema.ts` win.
