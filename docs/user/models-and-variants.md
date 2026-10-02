# Models and variants

Models are registered automatically by the plugin on the `google` provider.
Explicit model definitions are optional; the inventory below matches
`src/plugin/config/models.ts`.

## Antigravity models

| Model                                  | Variants                           | Notes                                            |
| -------------------------------------- | ---------------------------------- | ------------------------------------------------ |
| `antigravity-gemini-3-pro`             | `low`, `high`                      | Gemini 3 Pro with thinking                       |
| `antigravity-gemini-3.1-pro`           | `low`, `high`                      | Gemini 3.1 Pro with thinking (rollout-dependent) |
| `antigravity-gemini-3-flash`           | `minimal`, `low`, `medium`, `high` | Gemini 3 Flash with thinking                     |
| `antigravity-claude-sonnet-4-6`        | —                                  | Claude Sonnet 4.6                                |
| `antigravity-claude-opus-4-6-thinking` | `low`, `max`                       | Claude Opus 4.6 with extended thinking           |

Gemini and Claude OAuth models use Antigravity. Verified legacy preview IDs
remain supported as compatibility aliases:

| Compatibility alias                  | Antigravity model    |
| ------------------------------------ | -------------------- |
| `gemini-3-flash-preview`             | `gemini-3-flash`     |
| `gemini-3-pro-preview`               | `gemini-3-pro-low`   |
| `gemini-3.1-pro-preview`             | `gemini-3.1-pro-low` |
| `gemini-3.1-pro-preview-customtools` | `gemini-3.1-pro-low` |

Gemini 2.5 IDs such as `gemini-2.5-flash`, `gemini-2.5-pro`, and
`gemini-2.5-flash-image` are not supported through Antigravity OAuth. Use a
registered `antigravity-gemini-*` model instead, or use those IDs with an
ordinary Google API-key connection. API-key connections are not rerouted by
this plugin; `gemini-2.5-flash-image` is only available through the Google API.

Use a variant like this:

```bash
opencode run "Hello" --model=google/antigravity-claude-opus-4-6-thinking --variant=max
```

## Variant formats

| Family   | Format                                            | Example                                            |
| -------- | ------------------------------------------------- | -------------------------------------------------- |
| Claude   | `thinkingConfig.thinkingBudget` (tokens)          | `{ "thinkingConfig": { "thinkingBudget": 8192 } }` |
| Gemini 3 | `thinkingLevel` (`minimal`/`low`/`medium`/`high`) | `{ "thinkingLevel": "high" }`                      |

Gemini 3 levels differ by model: Flash supports
`minimal`/`low`/`medium`/`high`; Pro supports `low`/`high`. The API rejects
invalid levels (for example `minimal` on Pro), so configure variants
accordingly. The legacy numeric `thinkingBudget` form for Gemini 3 still maps
to a level (≤8192 → low, ≤16384 → medium, above → high) but `thinkingLevel`
is preferred.

Claude budgets: `low` = 8192 tokens, `max` = 32768 tokens. Custom budgets
(for example 4096/16384/24576) are accepted.

Tier-suffixed names (for example `antigravity-gemini-3-pro-low`) remain
accepted for backward compatibility, but simplified names with variants are
recommended for a cleaner picker and customizable thinking budgets.

## Removed: dedicated search tool

Earlier versions registered a `google_search` tool. It no longer exists.
Model-declared web search is still sanitized by the request pipeline
(a `web_search` tool is dropped with a warning when it cannot be combined
with function declarations), following the native `{ googleSearch: {} }`
format. There is no search configuration to set.
