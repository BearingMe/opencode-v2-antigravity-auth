# Application composition

`app/` is the application composition and orchestration layer. It wires modules and adapters together and may know which concrete implementations satisfy module dependencies.

```text
            app
         /   |   \
        /    |    \
   modules adapters runtime
```

`app/` knows the system; individual modules should not need to.
Here, `runtime` means the external execution host, not another `src/` directory.

## Hard rules

- Keep composition boring and explicit. `app/` may understand the high-level dependency graph, but should contain very little business or protocol logic.
- Do not turn it into a global `services/` folder. Application-wide workflows may coordinate modules when no single module owns the whole workflow; each module keeps ownership of its internal behavior.
- If substantial logic appears here, first ask whether it belongs in a module.
- This layer should eventually help reduce entrypoints such as `v2-plugin.ts` toward composition rather than implementation.

## Migration reminders

- Existing code is legacy-by-location, not wrong-by-default. Do not move it merely to clean up the tree; create a boundary before migrating implementation behind it.
- Prefer behavior-preserving moves and keep relocation, redesign, and behavior changes separate unless unavoidable.
- Add architecture only when it reduces dependency knowledge. Folders alone do not enforce boundaries; avoid cycles and keep changes small enough to understand independently.

## Current request path

- `composition.ts` selects account, inference, transport, and OpenCode host
  adapters for each routed model request.
- `execute-request.ts` coordinates those ports while preserving the existing
  account rotation, quota protection, warmup, fallback, and retry behavior.
- `plugin/engine.ts` is a compatibility facade; the V2 bridge calls the
  application composition directly.
