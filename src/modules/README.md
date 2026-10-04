# Modules

`modules/` contains the system's independently understandable capabilities. Organize by conceptual ownership, not technical type. Future modules might include `accounts`, `inference`, or `session-recovery`.

> A module should contain enough knowledge to change its responsibility safely while exposing as little knowledge as possible to the rest of the system.

## Hard rules

- Keep each module a knowledge bubble: most internal changes should require little or no understanding of other parts of the system.
- Keep internals private by default. Cross-module access must use a deliberately defined public API; deep imports into another module's internals are forbidden.
- Do not depend directly on OpenCode, filesystem details, HTTP implementations, or other external infrastructure unless explicitly modeled through a boundary. Normally reach external systems through adapters or explicit ports/contracts.
- Do not create tiny modules just because a concept has a name. Prefer the smallest independently understandable module; things that must usually change together should usually stay together.
- Organize inside a module by features, types, or subdomains when useful. The top-level boundary is the capability.

## Migration reminders

- Existing code is legacy-by-location, not wrong-by-default. Do not move code just to make the tree look cleaner.
- Create a boundary before migrating implementation behind it. Prefer behavior-preserving moves; avoid combining relocation, redesign, and behavior changes unless unavoidable.
- New architecture should reduce dependency knowledge, not just add folders. Filesystem organization alone is not enforcement; boundaries should eventually be mechanically enforceable, without circular dependencies.
- Keep code regions small and independently understandable for people and AI agents.
