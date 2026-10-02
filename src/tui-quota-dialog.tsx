import type { RGBA, ScrollBoxRenderable } from "@opentui/core"
import { For, Show, createSignal, onCleanup, onMount } from "solid-js"
import {
  formatQuotaPercentage,
  formatQuotaWindowStatus,
  formatResetCountdown,
  quotaBarParts,
  quotaViewPlaceholder,
} from "./plugin/account-ui-format.js"
import type { QuotaDialogController } from "./tui-quota-controller.js"
import { DialogShell } from "./tui-dialog-shell.js"

export interface QuotaDialogKeymapCommand {
  id: string
  title: string
  bind: string
  run: () => void
}

export type QuotaDialogLayer = (
  input: () => {
    mode: string
    priority: number
    commands: Array<QuotaDialogKeymapCommand>
  },
) => void

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

const SUMMARY_WINDOWS = [
  { key: "weekly", label: "Weekly Limit Remaining" },
  { key: "5h", label: "Five Hour Limit Remaining" },
] as const

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
    <DialogShell
      title={props.email}
      colors={{ base: props.colors.base, muted: props.colors.muted }}
      onClose={props.acknowledge}
    >
      <text fg={props.colors.base}>That account is no longer saved.</text>
      <text fg={props.colors.muted} onMouseUp={props.acknowledge}>
        OK enter
      </text>
    </DialogShell>
  )
}

export function QuotaDialogView(props: QuotaDialogProps) {
  const [state, setState] = createSignal(props.controller.snapshot())
  const [contentWidth, setContentWidth] = createSignal(0)
  let quotaScroll: ScrollBoxRenderable | undefined
  const hasSummary = () => (state().entry.quotaSummary?.groups.length ?? 0) > 0
  const summaryGroups = () => state().entry.quotaSummary?.groups ?? []
  const summaryRows = () => summaryGroups().flatMap((group) => SUMMARY_WINDOWS.map((window) => ({ group, window })))
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
        run: () => {
          if (enabled()) void props.controller.refresh()
        },
      },
      {
        id: "antigravity.quota.back",
        title: "Back to Antigravity accounts",
        bind: "escape",
        run: () => {
          void props.controller.back()
        },
      },
      {
        id: "antigravity.quota.scroll-up",
        title: "Scroll quota up",
        bind: "up",
        run: () => quotaScroll?.scrollBy(-1, "step"),
      },
      {
        id: "antigravity.quota.scroll-down",
        title: "Scroll quota down",
        bind: "down",
        run: () => quotaScroll?.scrollBy(1, "step"),
      },
    ],
  }))

  const status = () => {
    if (state().refreshing) return "Refreshing…"
    if (!enabled()) return "Account disabled — refresh is paused."
    if (hasSummary()) {
      const summary = state().entry.quotaSummary
      if (summary?.status === "error") return "Grouped quota refresh failed — showing saved values."
      if (summary?.freshness === "stale") return "Showing stale grouped quota values."
      if (summary?.status === "unknown") return "Grouped quota reading unavailable — showing saved values."
      if (state().failed) return "Per-model quota refresh failed; grouped values are current."
      return ""
    }
    if (state().failed) return "Refresh failed — showing last saved values."
    if (state().entry.status === "unknown") return "No quota reading available yet."
    return ""
  }
  const checked = () => {
    const entry = state().entry
    const checkedAt = hasSummary() ? (entry.quotaSummary?.checkedAt ?? null) : entry.checkedAt
    const freshness = hasSummary() ? entry.quotaSummary?.freshness : entry.freshness
    return checkedAt === null
      ? "Not checked yet"
      : `Updated ${new Date(checkedAt).toLocaleString()}${freshness === "stale" ? " · stale" : ""}`
  }

  return (
    <DialogShell
      title="Antigravity quota"
      colors={{ base: props.colors.base, muted: props.colors.muted }}
      onClose={() => {
        void props.controller.back()
      }}
    >
      <text fg={props.colors.muted}>{props.email}</text>
      <box
        flexDirection="column"
        gap={1}
        onSizeChange={function () {
          setContentWidth(this.width)
        }}
      >
        <Show when={!hasSummary()}>
          <For each={GROUPS}>
            {(group) => {
              const quota = () => state().entry.groups[group.key]
              const color = () =>
                quota()?.remainingFraction === null || quota()?.remainingFraction === undefined
                  ? props.colors.muted
                  : (quota()?.remainingFraction ?? 0) <= 0.1
                    ? props.colors.error
                    : (quota()?.remainingFraction ?? 0) <= 0.3
                      ? props.colors.warning
                      : props.colors.success
              const parts = () => quotaBarParts(quota()?.remainingFraction, barWidth())
              return (
                <box flexDirection={compact() ? "column" : "row"} gap={compact() ? 0 : 1}>
                  <text width={compact() ? undefined : 12} flexShrink={0} fg={props.colors.base}>
                    {group.label}
                  </text>
                  <box flexDirection="row" gap={1} flexShrink={0}>
                    <text width={barWidth()} flexShrink={0} fg={color()}>
                      {parts().bar}
                    </text>
                    <text width={7} flexShrink={0} fg={props.colors.muted}>
                      {parts().percentage.padStart(7)}
                    </text>
                  </box>
                  <text width={compact() ? undefined : resetWidth()} flexShrink={0} fg={props.colors.muted}>
                    {formatResetCountdown(quota()?.resetTime)}
                  </text>
                </box>
              )
            }}
          </For>
          <text fg={props.colors.muted}>Grouped quota unavailable; showing per-model quota.</text>
        </Show>
        <Show when={hasSummary()}>
          <For each={summaryGroups()}>
            {(group) => (
              <box flexDirection="column">
                <text fg={props.colors.base}>
                  <b>{group.displayName.toUpperCase()}</b>
                </text>
                <Show when={group.description}>
                  <text fg={props.colors.muted}>{group.description}</text>
                </Show>
              </box>
            )}
          </For>
          <scrollbox
            ref={(value) => {
              quotaScroll = value
            }}
            maxHeight={5}
            scrollX={false}
            contentOptions={{ flexDirection: "column" }}
          >
            <For each={summaryRows()}>
              {(row, index) => {
                const bucket = () => row.group.buckets[row.window.key]
                const fraction = () => bucket().remainingFraction
                const color = () =>
                  fraction() === null
                    ? props.colors.muted
                    : (fraction() ?? 0) <= 0.1
                      ? props.colors.error
                      : (fraction() ?? 0) <= 0.3
                        ? props.colors.warning
                        : props.colors.success
                const summaryBarWidth = () => Math.max(1, contentWidth() - 12)
                const parts = () => quotaBarParts(fraction(), summaryBarWidth())
                return (
                  <box id={`antigravity-quota-window-${index()}`} flexDirection="column" flexShrink={0}>
                    <text fg={props.colors.base}>
                      {row.group.displayName} · {row.window.label}
                    </text>
                    <box flexDirection="row" gap={0}>
                      <text fg={props.colors.muted}>[</text>
                      <text width={summaryBarWidth()} flexShrink={0} fg={color()}>
                        {parts().bar}
                      </text>
                      <text fg={props.colors.muted}>]</text>
                      <text fg={props.colors.muted}> {formatQuotaPercentage(fraction())}</text>
                    </box>
                    <text fg={props.colors.warning}>{formatQuotaWindowStatus(fraction(), bucket().resetTime)}</text>
                  </box>
                )
              }}
            </For>
          </scrollbox>
        </Show>
      </box>
      <box flexDirection="column">
        <text fg={props.colors.muted}>{checked()}</text>
        <Show when={Boolean(status())}>
          <text fg={state().failed ? props.colors.error : props.colors.muted}>{status()}</text>
        </Show>
        <text fg={props.colors.muted}>{quotaViewPlaceholder()}</text>
      </box>
      <box flexDirection="row" gap={2} flexWrap="wrap">
        <text
          fg={enabled() ? props.colors.base : props.colors.muted}
          onMouseUp={() => {
            if (enabled()) void props.controller.refresh()
          }}
        >
          <b>refresh</b>
          <span style={{ fg: props.colors.muted }}> {props.shortcuts("antigravity.quota.refresh") ?? "ctrl+r"}</span>
        </text>
        <Show when={hasSummary()}>
          <text fg={props.colors.muted}>↑/↓ scroll</text>
        </Show>
      </box>
    </DialogShell>
  )
}
