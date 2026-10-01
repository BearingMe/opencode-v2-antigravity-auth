import type { RGBA, ScrollBoxRenderable } from "@opentui/core"
import { For, createSignal } from "solid-js"
import type { QuotaDialogLayer } from "./tui-quota-dialog.js"

export interface AccountListItem {
  id: string
  email: string
  enabled: boolean
  description: string
}

export interface AccountListDialogProps {
  accounts: Array<AccountListItem>
  layer: QuotaDialogLayer
  colors: {
    base: RGBA; muted: RGBA; success: RGBA; error: RGBA; selected: RGBA
    inputText: RGBA; inputBackground: RGBA
  }
  choose: (id: string | undefined) => void
}

export function AccountListDialogView(props: AccountListDialogProps) {
  const [query, setQuery] = createSignal("")
  const [selected, setSelected] = createSignal(0)
  let scroll: ScrollBoxRenderable | undefined
  const filtered = () => props.accounts.filter((account) =>
    `${account.email} ${account.description}`.toLowerCase().includes(query().trim().toLowerCase()))
  const move = (delta: number) => {
    const length = filtered().length
    if (length === 0) return
    const index = (selected() + delta + length) % length
    setSelected(index)
    const account = filtered()[index]
    if (account) scroll?.scrollChildIntoView(`antigravity-account-${account.id}`)
  }
  props.layer(() => ({
    mode: "modal",
    priority: 10,
    commands: [
      { id: "antigravity.list.up", title: "Previous account", bind: "up", run: () => move(-1) },
      { id: "antigravity.list.down", title: "Next account", bind: "down", run: () => move(1) },
      { id: "antigravity.list.select", title: "Manage account", bind: "return", run: () => {
        const account = filtered()[selected()]
        if (account) props.choose(account.id)
      } },
      { id: "antigravity.list.close", title: "Close Antigravity accounts", bind: "escape", run: () => props.choose(undefined) },
    ],
  }))

  return (
    <box flexDirection="column" paddingLeft={4} paddingRight={4} paddingBottom={1} gap={1}>
      <box flexDirection="row" justifyContent="space-between">
        <text fg={props.colors.base}><b>Antigravity accounts</b></text>
        <text fg={props.colors.muted} onMouseUp={() => props.choose(undefined)}>esc</text>
      </box>
      <input focused placeholder="Search accounts"
        textColor={props.colors.inputText} focusedTextColor={props.colors.inputText}
        backgroundColor={props.colors.inputBackground} focusedBackgroundColor={props.colors.inputBackground}
        cursorColor={props.colors.inputText} placeholderColor={props.colors.muted}
        onInput={(value) => {
        setQuery(value)
        setSelected(0)
        scroll?.scrollTo(0)
      }} />
      {/* Keep the shared legend/login footer visible at 80x24: the host
          offsets dialogs by a quarter of the terminal height, leaving ~18
          rows. Header/input/description/footer reserve ~11 rows, so the
          scrolling region stays at 6 rows and longer pools scroll. */}
      <scrollbox ref={(value) => { scroll = value }} maxHeight={6} minHeight={1} scrollX={false}
        contentOptions={{ flexDirection: "column" }}>
        <For each={filtered()}>{(account, index) => (
          <box id={`antigravity-account-${account.id}`} flexDirection="row" flexShrink={0} gap={1}
            backgroundColor={selected() === index() ? props.colors.selected : undefined}
            onMouseOver={() => setSelected(index())} onMouseUp={() => props.choose(account.id)}>
            <text width={1} flexShrink={0} fg={account.enabled ? props.colors.success : props.colors.error}>●</text>
            <text fg={props.colors.base}>
              {account.email}<span style={{ fg: props.colors.muted }}>{account.enabled ? "" : " [disabled]"}</span>
            </text>
          </box>
        )}</For>
        <text fg={props.colors.muted}>{filtered().length === 0 ? "No matching accounts." : ""}</text>
      </scrollbox>
      <text fg={props.colors.muted}>{filtered()[selected()]?.description ?? ""}</text>
      <box flexDirection="column">
        <text fg={props.colors.muted}>
          <span style={{ fg: props.colors.success }}>●</span> enabled · <span style={{ fg: props.colors.error }}>●</span> disabled
        </text>
        <text fg={props.colors.muted}>Add accounts: opencode auth login</text>
      </box>
    </box>
  )
}
