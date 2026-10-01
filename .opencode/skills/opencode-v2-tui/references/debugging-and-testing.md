# Debugging and testing

Diagnose in order. Do not skip to renderer hypotheses before confirming
version and loading.

## 1. Version

Record OpenCode (`opencode --version`), `@opencode/plugin`, `@opentui/*`,
`solid-js`, and the upstream branch/commit if building from source. The repo's
`2.0` branch is stale; current work tracks `v2`. Mismatched plugin/host pairs
produce schema and renderer failures that look like plugin bugs.

## 2. Loading (`/plugins`)

Open `/plugins` (or dispatch `plugins.list`). It shows **two runtimes**:

- `TUI` entries: id/target/status (`active | inactive | failed`) + error.
- `Server` entries: plugin info + state.

A TUI `failed` entry keeps the last-good version running when one exists.
New failures toast once with an `Open plugins` action; repeats stay silent.
Config directives win over manual dialog toggles on every reconcile.

Common causes: bad specifier, missing `./tui` export, invalid module shape,
setup throw, cleanup throw on swap. Fix, save, and let the debounced watcher
reconcile (or restart the TUI).

## 3. Entrypoint / build

- Verify `exports["./tui"]` exists in the **installed** artifact, not just source.
- `npm pack` + inspect, or install from tarball — workspace links hide missing files.
- Precompile JSX for `node_modules` delivery (see packaging-and-runtime.md).
- Check peers/externals: exactly one `solid-js` / `@opentui/*` identity.

## 4. Rendering (`No renderer found`, blank slots)

- Reduce to the one-line `home.footer.status` smoke test first.
- Confirm the claim path exists and placement key is singular (runtime throws
  unless exactly one of `prepend/append/before/after/replace` is set).
- Confirm `usePlugin()` is called inside a provided render, not bare setup.
- Suspect duplicate Solid/OpenTUI copies when smoke fails only when installed.
- Plugin render crashes are contained: one error toast naming id + location
  (`slot X` / `route`), siblings survive. Read that toast — it names the owner.

## 5. Input (keymap/slash/palette silent)

- Is the layer's component mounted? (App slot for global, panel component for local.)
- Is `mode` correct (`base` default vs `global`)? Is a modal mode pushed above you?
- Is `enabled` predicate false? Is focus on the expected renderable (`target`)?
- Does a higher `priority` layer consume the key? Does `run` return `false`
  when it should fall through?
- Check `cli.json` keybind overrides and `shortcuts(id)` / `commands()` output.

## 6. Data / RPC

- Empty list: call `sync` first, then `list`. Stale: `invalidate` + `sync`.
- RPC throws: separate transport (unavailable) from `rpc.invalid_output`
  (version drift — update both sides; omit `undefined` optionals).
- Wrong scope: pass `location`; per-session data needs the right sessionID/root.

## 7. Lifecycle / leaks

Exercise disable → enable, file-save reload, and TUI restart. Watch for
duplicate commands, double toasts, or growing listeners. Every `data.on`,
`data.listen`, timer, socket, and watcher needs cleanup on the setup return
path **and** on setup-failure paths.

## Host diagnostics

```json
{ "debug": { "devtools": true, "timing": true, "turn_tokens": "verbose" } }
```

DevTools bar covers server connection, UI event-loop/CPU/memory, theme, debug
snapshot writer, and experiments. It is host diagnostics, not a plugin API —
do not import it.

- Paths: `opencode debug paths log` (or `db`, `config`, `state`).
- Focused repro: `OPENCODE_LOG_LEVEL=DEBUG` + `tail -f <log>`; filter
  `component=plugin` / `role=server` as needed.
- Service: `opencode service status`, `opencode api get /api/info`,
  `opencode service restart`. Compare shared service vs `opencode --standalone`.
- Report bundle: version, status output, minimal repro steps, affected scope
  (service/client/project), relevant log lines. Redact keys, headers, prompts,
  file contents.

## Testing

- Pure logic (formatting, option narrowing, projection mapping): unit tests.
- Rendering/input: OpenTUI `testRender()` / `createTestRenderer()` — assert
  frames contain text, simulate keys, destroy renderer to run cleanups.
- Host integration: install the packed artifact into a scratch config, check
  `/plugins`, trigger every command/dialog/slot, reload twice, disable/enable.
- Manual matrix: narrow terminal (panel fullscreen), light/dark themes,
  dialog dismiss (`esc`), tabs on/off, remote `--server`.
- Mock tests alone never prove host loading. No automated coverage is expected
  for the full dialog/toast flow — verify by hand and note it.
