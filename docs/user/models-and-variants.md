# Models and variants

The plugin registers a fixed model catalog on the `antigravity` provider. It
does not discover models from the API. The inventory below matches
`src/plugin/config/models.ts`.

## Migrate existing model references

Antigravity models now use a dedicated provider ID. Change only the provider
prefix on old Antigravity selections, for example:

```text
google/antigravity-claude-opus-4-6-thinking → antigravity/antigravity-claude-opus-4-6-thinking
```

Ordinary Google models such as `google/gemini-2.5-flash` keep their existing
provider and connection. The plugin does not migrate, read, or remove Google
credentials. Existing Antigravity accounts in the plugin's v4 account store
remain available.

## Antigravity models

| Model                                    | Variants                | Notes                                     |
| ---------------------------------------- | ----------------------- | ----------------------------------------- |
| `antigravity-gemini-4-argon`             | —                       | Gemini 4 Argon (Unreleased; may not work) |
| `antigravity-gemini-3.8-flash`           | `low`, `medium`, `high` | Gemini 3.8 Flash                          |
| `antigravity-gemini-3.7-flash`           | `low`, `medium`, `high` | Gemini 3.7 Flash                          |
| `antigravity-gemini-3.6-flash`           | `low`, `medium`, `high` | Gemini 3.6 Flash                          |
| `antigravity-gemini-3.1-pro`             | `low`, `high`           | Gemini 3.1 Pro                            |
| `antigravity-claude-sonnet-4-6-thinking` | —                       | Claude Sonnet 4.6 with thinking           |
| `antigravity-claude-opus-4-6-thinking`   | —                       | Claude Opus 4.6 with thinking             |
| `antigravity-gpt-oss-120b-medium`        | —                       | GPT-OSS 120B at medium reasoning          |

The Gemini 3.8 Flash model is sent to Antigravity's `gemini-3.8-flash-tiered`
backend ID. Legacy Gemini preview IDs are still normalized by request routing,
but are not published as selectable catalog entries.

Gemini 4 Argon is listed ahead of general availability so it can be tested as
soon as Antigravity exposes it. Its API model ID and limits are provisional;
the catalog currently uses a 1,048,576-token context and 65,536-token output
limit, and requests may fail until the service supports the model.

Gemini 2.5 IDs such as `gemini-2.5-flash`, `gemini-2.5-pro`, and
`gemini-2.5-flash-image` are not supported through Antigravity OAuth. Use a
registered `antigravity-gemini-*` model instead, or use those IDs with an
ordinary Google API-key connection on OpenCode's separate `google` provider.
This plugin does not alter that provider; `gemini-2.5-flash-image` is only
available through the Google API.

Select a Gemini Flash variant like this:

```bash
opencode run "Hello" --model=antigravity/antigravity-gemini-3.8-flash --variant=high
```

## Variant formats

| Family   | Format                                  | Example                       |
| -------- | --------------------------------------- | ----------------------------- |
| Gemini 3 | `thinkingLevel` (`low`/`medium`/`high`) | `{ "thinkingLevel": "high" }` |

Flash supports `low`, `medium`, and `high`; Pro supports `low` and `high`.
Claude Thinking models use the resolver's default thinking budget and expose no
picker variants. GPT-OSS is fixed to medium reasoning and also exposes no
variants.

The request resolver still understands tier-suffixed IDs for compatibility,
but only the base model IDs in the catalog above are published in the picker.

## Removed: dedicated search tool

Earlier versions registered a `google_search` tool. It no longer exists.
Model-declared web search is still sanitized by the request pipeline
(a `web_search` tool is dropped with a warning when it cannot be combined
with function declarations), following the native `{ googleSearch: {} }`
format. There is no search configuration to set.
