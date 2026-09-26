---
name: opencode-v1-plugins
description: Use for researching, building, configuring, debugging, or maintaining OpenCode v1 plugins, including npm/local installation, @opencode-ai/plugin hooks, event subscriptions, tools, dependencies, SDK usage, and OAuth/provider integrations. Establish the target v1 release before using an API; do not apply this guide to OpenCode v2.
---

# OpenCode v1 plugins

Use this skill for OpenCode **v1** only. The unversioned `/docs/` site is labeled v1 and links separately to `/v2/docs/`, but its content can change; a package declaration alone does not prove what runtime version a user runs.

## Workflow

1. Determine whether the request is research, implementation, management, or debugging. Honor read-only/research-only requests. If the user says v2, use v2-specific sources instead. If the version is unclear and affects the answer, inspect the installed OpenCode version and `@opencode-ai/plugin` version or ask.
2. Inspect the relevant `opencode.json`/`opencode.jsonc`, plugin files, package metadata, and repository guidance before recommending or changing anything. Choose project vs global and local vs npm distribution according to the task.
3. Check the **release-matched** `@opencode-ai/plugin` type declarations before relying on a hook, event payload, or tool context field. Use `references/sources.md` for verified sources and version caveats. Consult official v1 documentation (prefer Defuddle on docs pages, WebFetch on raw declarations) and a release tag for details not covered by the package types. Do not transfer a v2-only interface into a v1 answer.
4. Load the relevant reference as needed:
   - `references/development.md`: factory, tools, auth, SDK, and engineering practices.
   - `references/management.md`: discovery, dependencies, ordering, updates, and debugging.
   - `references/hooks-and-events.md`: hook vs bus-event distinction and availability.
   - `references/sources.md`: source links and verification status.
5. For implementation, follow the existing codebase's conventions, mutate hook `output` in place where specified, and validate with focused type checks/tests or a local OpenCode startup as appropriate. For research, cite the release or docs page supporting each important claim; label recommendations and unverified behavior separately.
6. Report the assumed v1/runtime and plugin-package versions, what was learned or changed, verification performed, and any release-sensitive uncertainty. After changing a load-time plugin or configuration, tell the user to restart OpenCode to pick it up.

## Decision rules

- Use `event: async ({ event }) => { ... }` for bus notifications such as `session.idle`. Use a named hook such as `"tool.execute.before"` when you need its mutable `output` or interception semantics; identical-looking names in a documentation event list do **not** establish that they are bus events.
- Confirm both the installed runtime and matching plugin types. For example, `@opencode-ai/plugin@0.15.30` does not declare `shell.env` or `experimental.session.compacting`; `1.18.32` does. Do not assume newer types work with an older runtime.
- Prefer `client.app.log()` for structured logs and avoid logging auth tokens. Resolve session-specific paths from tool `context.directory`/`context.worktree` only if those fields exist in the target release.
- Keep examples small, typed, and specific to the requested release. Never invent an export, event payload, configuration field, or cleanup hook from a later release.
