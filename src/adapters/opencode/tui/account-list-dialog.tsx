import { DialogShell } from "./dialog-shell.js"
import type { RGBA, ScrollBoxRenderable } from "@opentui/core"
import { For, Show, createSignal } from "solid-js"
import type { QuotaDialogLayer } from "./quota-dialog.js"

/**
 * Account entry displayed in the account selection modal.
 */
export interface AccountListItem {
  id: string
  email: string
  enabled: boolean
  description: string
}

/**
 * Presentation props for the account selection modal.
 */
export interface AccountListDialogProps {
  accounts: Array<AccountListItem>
  layer: QuotaDialogLayer
  colors: {
    base: RGBA
    muted: RGBA
    success: RGBA
    error: RGBA
    selected: RGBA
    inputText: RGBA
    inputBackground: RGBA
  }
  choose: (id: string | undefined) => void
  toggle?: (id: string) => Promise<boolean> | void
}

/**
 * Account list dialog view with keyboard navigation and active/inactive toggle.
 */
export function AccountListDialogView(props: AccountListDialogProps) {
  const [query, setQuery] = createSignal("")
  const [selected, setSelected] = createSignal(0)
  const [overrides, setOverrides] = createSignal<Record<string, boolean>>({})
  let scroll: ScrollBoxRenderable | undefined

  /** Applies pending toggle results to the account rows shown in the picker. */
  const accountList = () => {
    const map = overrides()
    return props.accounts.map((account) => {
      const override = map[account.id]
      if (override === undefined || override === account.enabled) return account
      let desc = account.description
      if (override) {
        desc = desc.replace(/\[disabled\]\s*/g, "").trim()
      } else if (!desc.includes("[disabled]")) {
        desc = desc ? `[disabled] ${desc}` : "[disabled]"
      }
      return {
        ...account,
        enabled: override,
        description: desc,
      }
    })
  }

  /** Returns accounts matching the current search query. */
  const filtered = () =>
    accountList().filter((account) =>
      `${account.email} ${account.description}`.toLowerCase().includes(query().trim().toLowerCase()),
    )
  /** Resolves the account at the current selection, if one exists. */
  const selectedAccount = () => filtered()[selected()]
  /** Moves the selected row and scrolls it into view. */
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
      {
        id: "antigravity.list.select",
        title: "Manage account",
        bind: "return",
        run: () => {
          const account = selectedAccount()
          if (account) props.choose(account.id)
        },
      },
      {
        id: "antigravity.list.toggle",
        title: "Toggle account active/inactive",
        bind: "ctrl+t",
        run: async () => {
          const account = selectedAccount()
          if (!account || !props.toggle) return
          const current = account.enabled
          const next = !current
          setOverrides((prev) => ({ ...prev, [account.id]: next }))
          const ok = await props.toggle(account.id)
          if (ok === false) {
            setOverrides((prev) => ({ ...prev, [account.id]: current }))
          }
        },
      },
      {
        id: "antigravity.list.close",
        title: "Close Antigravity accounts",
        bind: "escape",
        run: () => props.choose(undefined),
      },
    ],
  }))

  return (
    <DialogShell
      title="Antigravity accounts"
      colors={{ base: props.colors.base, muted: props.colors.muted }}
      onClose={() => props.choose(undefined)}
    >
      <input
        focused
        placeholder="Search accounts"
        textColor={props.colors.inputText}
        focusedTextColor={props.colors.inputText}
        backgroundColor={props.colors.inputBackground}
        focusedBackgroundColor={props.colors.inputBackground}
        cursorColor={props.colors.inputText}
        placeholderColor={props.colors.muted}
        onInput={(value) => {
          setQuery(value)
          setSelected(0)
          scroll?.scrollTo(0)
        }}
      />
      {/* Keep the shared legend/login footer visible at 80x24: the host
          offsets dialogs by a quarter of the terminal height, leaving ~18
          rows. Header/input/description/footer reserve ~11 rows, so the
          scrolling region stays at 6 rows and longer pools scroll. */}
      <scrollbox
        ref={(value) => {
          scroll = value
        }}
        maxHeight={6}
        scrollX={false}
        contentOptions={{ flexDirection: "column" }}
      >
        <For each={filtered()}>
          {(account, index) => (
            <box
              id={`antigravity-account-${account.id}`}
              flexDirection="row"
              flexShrink={0}
              gap={1}
              backgroundColor={selected() === index() ? props.colors.selected : undefined}
              onMouseOver={() => setSelected(index())}
              onMouseUp={() => props.choose(account.id)}
            >
              <text width={1} flexShrink={0} fg={account.enabled ? props.colors.success : props.colors.error}>
                ●
              </text>
              <text fg={props.colors.base}>
                {account.email}
                <span style={{ fg: props.colors.muted }}>{account.enabled ? "" : " [disabled]"}</span>
              </text>
            </box>
          )}
        </For>
        <Show when={filtered().length === 0}>
          <text fg={props.colors.muted}>No matching accounts.</text>
        </Show>
      </scrollbox>
      <Show when={Boolean(selectedAccount()?.description)}>
        <text fg={props.colors.muted}>{selectedAccount()?.description}</text>
      </Show>
      <box flexDirection="column">
        <text fg={props.colors.muted}>
          <span style={{ fg: props.colors.success }}>●</span> enabled ·{" "}
          <span style={{ fg: props.colors.error }}>●</span> disabled ·{" "}
          <span style={{ fg: props.colors.base }}>ctrl+t</span> toggle
        </text>
        <text fg={props.colors.muted}>Add accounts: opencode auth login</text>
      </box>
    </DialogShell>
  )
}
