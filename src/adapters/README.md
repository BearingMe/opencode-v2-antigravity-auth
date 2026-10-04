# Adapters

`adapters/` connects the application to external systems and runtime-specific APIs. Future integrations might be organized like this:

```text
adapters/
  antigravity/
  opencode/
  filesystem/
    config-directory.ts
    debug-log.ts
```

## Hard rules

- Translate between external systems and internal module contracts. Adapters may depend on public module contracts; modules must not depend on adapter implementations.
- Put vendor/API-specific behavior here when it is not intrinsic business or application knowledge. OpenCode integration belongs here; Antigravity/Google HTTP protocol details belong here when they describe external communication rather than core policy.
- Filesystem implementations belong here when they implement internal persistence needs.
- Do not make adapters alternate homes for application or domain logic. Avoid generic dumping grounds such as `helpers`, `utils`, or `services`.
- One adapter may have multiple files when they collectively represent one external integration.
- Do not add abstraction layers solely for theoretical replaceability. Introduce boundaries where they reduce coupling or leakage of external-system knowledge.

```text
external system
      ↕
   adapter
      ↕
public module contract
```

## Migration reminders

- Existing code is legacy-by-location, not wrong-by-default. Do not move it just to tidy the tree; establish a boundary before migrating implementation behind it.
- Prefer behavior-preserving moves. Keep relocation, redesign, and behavior changes separate unless unavoidable.
- New boundaries should reduce dependency knowledge, avoid cycles, and eventually be mechanically enforceable; folders alone do not enforce them.
- Keep each change small and independently understandable.
