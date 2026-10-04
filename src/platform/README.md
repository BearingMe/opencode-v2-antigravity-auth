# Platform

`platform/` contains low-level, application-wide technical facilities that are not tied to one domain or one external integration. `platform/logging/` owns structured log events, destination-neutral logger contracts, log-safe formatting, and independent debug-flag policy.

## Hard rules

- Keep platform code domain-agnostic: it must not import specific modules such as accounts or inference, or know business rules.
- Do not put OpenCode-specific behavior here; that belongs in an adapter.
- Keep abstractions small and broadly reusable. Do not put something here merely because multiple modules use it: shared does not automatically mean platform.
- If code carries domain vocabulary, it probably belongs in a module. If it carries vendor or runtime vocabulary, it probably belongs in an adapter.
- Do not let `platform/` become another `utils/` or `common/` folder.

> If this code knew nothing about Antigravity, accounts, inference, or OpenCode, would it still make sense?
>
> If not, it probably does not belong in `platform/`.

## Migration reminders

- Existing code is legacy-by-location, not wrong-by-default. Do not move code just to make the tree look cleaner; define a boundary before migrating implementation behind it.
- Prefer behavior-preserving moves. Avoid combining relocation, redesign, and behavior changes unless unavoidable.
- New architecture should reduce dependency knowledge, not just add folders. Boundaries should eventually be mechanically enforceable; filesystem organization alone is not enough.
- Avoid circular dependencies and keep code regions small and independently understandable.
