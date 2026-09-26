# Verify a port by behavior

Capture the pre-port expectation and test each changed behavior, not merely successful startup. For an assessment-only request, use this as a proposed verification matrix rather than running mutations.

| Concern | Parity check |
| --- | --- |
| Identity/loading | Default v2 export has stable ID; plugin appears with expected source and active status (`opencode plugin list` or `ctx.plugin.list()` at the relevant location). No accidental duplicate. |
| Configuration | Options/defaults and path resolution work with the effective config; unrelated settings are preserved; test supported legacy config separately from native conversion. |
| Tools/transforms | Tool name/schema/result and collisions match intent; provider/model/command/MCP/agent registrations visible; replay after `reload()` and disposal preserves order without duplicate side effects. |
| Runtime hooks | Exercise before/after tool, permission allow/ask/deny, shell environment, prompt admission and agent-loop context. Verify which fields are persisted vs outbound only. |
| Model transport | Exercise main model request plus compaction/title/generate if needed, provider scoping, native HTTP streaming or WS path, response transforms, errors, retries, and cancellation. |
| Authentication | Login, credential refresh, account switching, failure recovery, secret redaction, provider inventory with and without an active connection. |
| Events and UI | Receive expected public events; root/child session and location filtering; TUI behavior locally and when connected to a remote server where relevant. |
| Persistence and cleanup | Preserve or explicitly migrate old state; restart with stored values; unload/reload while subscription/timer/socket is active; confirm no duplicate listeners. |
| Distribution | Typecheck/build with release-matched dependencies; test the packed/installed artifact as well as local development. For dual support, test v1 and v2 independently, including the oldest claimed v1 release. |

Choose focused automated tests for the transformed logic and integration checks for the host behavior. Do not claim runtime parity from static types alone. If no v2 runtime or credentials are available, report which rows remain untested and why. `opencode plugin check`/`update` concerns installed package updates, not a replacement for exercising hooks and behavior.

Source: [official plugin migration verification](https://opencode.ai/v2/docs/build/plugins/migrate-v1#verify-a-ported-plugin) and [general setup verification](https://opencode.ai/v2/docs/migrate-v1/#verify-your-setup).
