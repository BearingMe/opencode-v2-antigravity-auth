# UI surfaces

Pick the smallest surface that satisfies the need. Prefer host-rendered
dialogs/toasts over custom JSX; prefer a slot contribution over a full route.

## Dialogs (promise-based)

```ts
await context.ui.dialog.alert({ title: "Acme", message: "Ready" })
const confirmed = await context.ui.dialog.confirm({
  title: "Continue?",
  message: "Run the Acme action?",
  label: { confirm: "Run", cancel: "Cancel" },
})
const name = await context.ui.dialog.prompt({ title: "Name", placeholder: "release" })
const mode = await context.ui.dialog.select({
  title: "Mode",
  current: "safe",
  options: [
    { title: "Safe", value: "safe", description: "Ask before changes" },
    { title: "Fast", value: "fast", category: "Advanced" },
  ],
})
```

Semantics: `alert` resolves `void`; `confirm` resolves `boolean | undefined`
(`undefined` on dismiss); `prompt`/`select` resolve value or `undefined` on
dismiss. Always branch on `undefined` — dismissal is not confirmation.

Custom modal content:

```tsx
context.ui.dialog.set({ size: "large", centered: true })
context.ui.dialog.show(() => <box><text>Acme</text></box>, () => console.log("closed"))
context.ui.dialog.clear()
```

Use `show` only when the promise helpers cannot express the layout. Wrap renders
so they can reach plugin context via `usePlugin()` (host does this for you on
registered routes/slots; do the same for ad-hoc `show` renders that need it).

## Toasts

```ts
context.ui.toast.show({ title: "Acme", message: "Saved", variant: "success", duration: 3000 })
```

Variants: `info | success | warning | error`. Keep messages one line; put
details in a dialog. Optional `sessionID` links the toast to a session family
(host defaults title to session title and offers Open when off-screen).

## Routes (dedicated pages)

```tsx
const unregister = context.ui.router.register({
  name: "dashboard",
  render: ({ data }) => <text>{String(data?.title ?? "Acme")}</text>,
})
context.ui.router.navigate({ type: "plugin", name: "dashboard", data: { title: "Status" } })
context.ui.router.navigate({ type: "session", sessionID })
context.ui.router.navigate({ type: "home" })
const current = context.ui.router.current()
return unregister
```

Route `data` is `Record<string, any> | undefined`. Navigation to
`{ type: "plugin", name }` fills in the calling plugin id automatically.
Host renders routes inside an error boundary: a throwing route shows one error
toast and unmounts, it does not take down the app.

## Slots (embedded contributions)

Valid paths (`SlotPath`): `app`, `home.footer`, `home.footer.status`,
`prompt.footer`, `prompt.footer.status`, `prompt.footer.file`,
`session.composer.top`, `session.panel`, `sidebar.content`, `sidebar.footer`.

Exactly one placement key per claim: `prepend | append | before | after | replace`.

```tsx
return context.ui.slot({ append: "sidebar.content", render: ({ sessionID }) => <text>{sessionID}</text> })
```

Placement rules:

- `prepend`/`append`: first/last inside the target boundary.
- `before`/`after`: siblings outside the boundary.
- `replace`: takes over the target; siblings anchored `before`/`after` still compose.
- At the same target the last-enabled claim wins; ancestor `replace` beats descendant.
- Unknown paths degrade (additive claims fall back to nearest surviving ancestor).

`home.footer.status` appends to the built-in footer row without replacing it.
Use `app` slot with a `null` render as the mount point for global keymap layers.

## Session panels

Two-step: contribute to `session.panel`, then open by name.

```tsx
import { Show } from "solid-js"

context.ui.slot({
  append: "session.panel",
  render: (panel) => (
    <Show when={panel.name === "acme.review"}>
      <ReviewPanel panel={panel} />
    </Show>
  ),
})
context.ui.panel.open("acme.review")
context.ui.panel.open("acme.review", { presentation: "fullscreen" })
const current = context.ui.panel.current()
context.ui.panel.close()
```

`open` returns `false` outside a session. Names are shared selection values —
prefix them (`acme.review`). `PanelInput` gives reactive `name`, `sessionID`,
`width`, `presentation`, `focused` plus `focus`, `close`, `toggleFullscreen`.
Host owns sizing/focus; narrow terminals stay fullscreen (`toggleFullscreen` no-ops).
Panel keyboard layers are active only while the panel owns input.

## Markdown code blocks

```ts
const unregister = context.markdown.registerCodeBlockRenderer("acme", (_token, render) => render.defaultRender())
return unregister
```

Language is normalized (`infoStringToFiletype`); empty language throws.
Duplicate registration for the same language throws. Last-enabled plugin wins;
removal restores previous/default rendering.

## Theme and formatting

Use semantic tokens, never hardcoded colors:

```tsx
const Status = () => <text fg={context.theme.text.base}>Ready</text>
```

`context.themeMode` is `dark | light`. Format paths with
`context.ui.format.path(dir)` (home abbreviation). Attention (notification +
sound) goes through `context.attention.notify({ title, message, notification, sound })`
which respects focus and user settings — check its `{ ok, skipped }` result.
