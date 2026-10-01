import type { RGBA } from "@opentui/core"
import { For, createSignal, onCleanup, onMount } from "solid-js"
import { formatResetCountdown, quotaBarParts, quotaViewPlaceholder } from "./plugin/account-ui-format.js"
import type { QuotaDialogController } from "./tui-quota-controller.js"

export interface QuotaDialogKeymapCommand {
  id: string
  title: string
  bind: string
  run: () => void
}

export type QuotaDialogLayer = (input: () => {
  mode: string
  priority: number
  commands: Array<QuotaDialogKeymapCommand>
}) => void

export interface QuotaDialogProps {
  email: string
  enabled: boolean
  controller: QuotaDialogController
  layer: QuotaDialogLayer
  colors: { base: RGBA; muted: RGBA; success: RGBA; warning: RGBA; error: RGBA }
  shortcuts: (id: string) => string | undefined
}

const GROUPS = [
  { key: "claude", label: "Claude" },
  { key: "gemini-pro", label: "Gemini Pro" },
  { key: "gemini-flash", label: "Gemini Flash" },
]

export interface MissingAccountDialogProps {
  email: string
  acknowledge: () => void
  layer: QuotaDialogLayer
  colors: { base: RGBA; muted: RGBA }
}

export function MissingAccountDialogView(props: MissingAccountDialogProps) {
  props.layer(() => ({
    mode: "modal",
    priority: 10,
    commands: [
      { id: "antigravity.missing.accept", title: "Return to accounts", bind: "return", run: props.acknowledge },
      { id: "antigravity.missing.back", title: "Return to accounts", bind: "escape", run: props.acknowledge },
    ],
  }))
  return (
    <box flexDirection="column" paddingLeft={4} paddingRight={4} paddingBottom={1} gap={1}>
      <box flexDirection="row" justifyContent="space-between">
        <text fg={props.colors.base}><b>{props.email}</b></text>
        <text fg={props.colors.muted} onMouseUp={props.acknowledge}>esc</text>
      </box>
      <text fg={props.colors.base}>That account is no longer saved.</text>
      <text fg={props.colors.muted} onMouseUp={props.acknowledge}>OK enter</text>
    </box>
  )
}

export function QuotaDialogView(props: QuotaDialogProps) {
  const [state, setState] = createSignal(props.controller.snapshot())
  const [contentWidth, setContentWidth] = createSignal(0)
  const resets = () => GROUPS.map((group) => formatResetCountdown(state().entry.groups[group.key]?.resetTime))
  const resetWidth = () => Math.max(...resets().map((reset) => reset.length))
  // Label, percentage (including "unknown"), reset column, and three gaps.
  const metadataWidth = () => 12 + 7 + resetWidth() + 3
  const compact = () => contentWidth() < metadataWidth() + 6
  const barWidth = () => Math.max(1, contentWidth() - (compact() ? 8 : metadataWidth()))
  const enabled = () => state().entry.enabled ?? props.enabled
  const stop = props.controller.subscribe(() => setState(props.controller.snapshot()))
  onCleanup(() => {
    stop()
    props.controller.dispose()
  })
  onMount(() => {
    if (enabled()) void props.controller.refresh()
  })

  props.layer(() => ({
    mode: "modal",
    priority: 10,
    commands: [
      {
        id: "antigravity.quota.refresh",
        title: "Refresh Antigravity quota",
        bind: "ctrl+r",
        run: () => { if (enabled()) void props.controller.refresh() },
      },
      {
        id: "antigravity.quota.back",
        title: "Back to Antigravity accounts",
        bind: "escape",
        run: () => { void props.controller.back() },
      },
    ],
  }))

  const status = () => !enabled() ? "Account disabled — refresh is paused."
    : state().refreshing ? "Refreshing…"
      : state().failed ? "Refresh failed — showing last saved values."
        : state().entry.status === "unknown" ? "No quota reading available yet."
          : ""
  const checked = () => {
    const entry = state().entry
    return entry.checkedAt === null ? "Not checked yet"
      : `Updated ${new Date(entry.checkedAt).toLocaleString()}${entry.freshness === "stale" ? " · stale" : ""}`
  }

  return (
    <box flexDirection="column" paddingLeft={4} paddingRight={4} paddingBottom={1} gap={1}>
      <box flexDirection="row" justifyContent="space-between">
        <text fg={props.colors.base}><b>Antigravity quota</b></text>
        <text fg={props.colors.muted} onMouseUp={() => { void props.controller.back() }}>esc</text>
      </box>
      <text fg={props.colors.muted}>{props.email}</text>
      <box flexDirection="column" gap={1} onSizeChange={function () { setContentWidth(this.width) }}>
        <For each={GROUPS}>{(group) => {
          const quota = () => state().entry.groups[group.key]
          const color = () => quota()?.remainingFraction === null || quota()?.remainingFraction === undefined
            ? props.colors.muted : (quota()?.remainingFraction ?? 0) <= 0.1 ? props.colors.error
              : (quota()?.remainingFraction ?? 0) <= 0.3 ? props.colors.warning : props.colors.success
          const parts = () => quotaBarParts(quota()?.remainingFraction, barWidth())
          return (
            <box flexDirection={compact() ? "column" : "row"} gap={compact() ? 0 : 1}>
              <text width={compact() ? undefined : 12} flexShrink={0} fg={props.colors.base}>{group.label}</text>
              <box flexDirection="row" gap={1} flexShrink={0}>
                <text width={barWidth()} flexShrink={0} fg={color()}>{parts().bar}</text>
                <text width={7} flexShrink={0} fg={props.colors.muted}>{parts().percentage.padStart(7)}</text>
              </box>
              <text width={compact() ? undefined : resetWidth()} flexShrink={0} fg={props.colors.muted}>{formatResetCountdown(quota()?.resetTime)}</text>
            </box>
          )
        }}</For>
      </box>
      <box flexDirection="column">
        <text fg={props.colors.muted}>{checked()}</text>
        <text fg={state().failed ? props.colors.error : props.colors.muted}>{status()}</text>
        <text fg={props.colors.muted}>{quotaViewPlaceholder()}</text>
      </box>
      <box flexDirection="row" gap={2} flexWrap="wrap">
        <text fg={enabled() ? props.colors.base : props.colors.muted} onMouseUp={() => {
          if (enabled()) void props.controller.refresh()
        }}>
          <b>refresh</b><span style={{ fg: props.colors.muted }}> {props.shortcuts("antigravity.quota.refresh") ?? "ctrl+r"}</span>
        </text>
      </box>
    </box>
  )
}
