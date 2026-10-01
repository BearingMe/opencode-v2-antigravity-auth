# Models and variants

Models are registered automatically by the plugin on the `google` provider.
Explicit model definitions are optional; the inventory below matches
`src/plugin/config/models.ts`.

## Antigravity pool (default routing for Claude and Gemini)

| Model                                  | Variants                           | Notes                                            |
| -------------------------------------- | ---------------------------------- | ------------------------------------------------ |
| `antigravity-gemini-3-pro`             | `low`, `high`                      | Gemini 3 Pro with thinking                       |
| `antigravity-gemini-3.1-pro`           | `low`, `high`                      | Gemini 3.1 Pro with thinking (rollout-dependent) |
| `antigravity-gemini-3-flash`           | `minimal`, `low`, `medium`, `high` | Gemini 3 Flash with thinking                     |
| `antigravity-claude-sonnet-4-6`        | —                                  | Claude Sonnet 4.6                                |
| `antigravity-claude-opus-4-6-thinking` | `low`, `max`                       | Claude Opus 4.6 with extended thinking           |

## Gemini CLI pool (separate quota; fallback target)

| Model                                | Notes                                                            |
| ------------------------------------ | ---------------------------------------------------------------- |
| `gemini-2.5-flash`                   | Gemini 2.5 Flash                                                 |
| `gemini-2.5-pro`                     | Gemini 2.5 Pro                                                   |
| `gemini-3-flash-preview`             | Gemini 3 Flash (preview)                                         |
| `gemini-3-pro-preview`               | Gemini 3 Pro (preview)                                           |
| `gemini-3.1-pro-preview`             | Gemini 3.1 Pro (preview, rollout-dependent)                      |
| `gemini-3.1-pro-preview-customtools` | Gemini 3.1 Pro Preview Custom Tools (preview, rollout-dependent) |

## Routing

- **Antigravity-first (default):** Gemini models use Antigravity quota across
  accounts.
- **CLI-first (`cli_first: true`):** Gemini models try the Gemini CLI pool
  first.
- When one Gemini pool is exhausted, the plugin falls back to the other pool
  automatically. Claude always stays on Antigravity.
- Model names are transformed for the target API as needed (for example,
  an Antigravity Flash model maps to its `-preview` CLI counterpart).

Use a variant like this:

```bash
opencode run "Hello" --model=google/antigravity-claude-opus-4-6-thinking --variant=max
```

## Variant formats

| Family     | Format                                            | Example                                            |
| ---------- | ------------------------------------------------- | -------------------------------------------------- |
| Claude     | `thinkingConfig.thinkingBudget` (tokens)          | `{ "thinkingConfig": { "thinkingBudget": 8192 } }` |
| Gemini 3   | `thinkingLevel` (`minimal`/`low`/`medium`/`high`) | `{ "thinkingLevel": "high" }`                      |
| Gemini 2.5 | `thinkingConfig.thinkingBudget`                   | `{ "thinkingConfig": { "thinkingBudget": 8192 } }` |

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
recommended: cleaner picker, customizable budgets, automatic quota routing.

## Removed: dedicated search tool

Earlier versions registered a `google_search` tool. It no longer exists.
Model-declared web search is still sanitized by the request pipeline
(a `web_search` tool is dropped with a warning when it cannot be combined
with function declarations), following the native `{ googleSearch: {} }`
format. There is no search configuration to set.
