import type { RGBA, ScrollBoxRenderable } from "@opentui/core"
import { useTerminalDimensions } from "@opentui/solid"
import { For, Show, createEffect, createSignal, onCleanup, onMount } from "solid-js"
import { formatQuotaPercentage, formatResetCountdown, quotaBarParts } from "./plugin/account-ui-format.js"
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
  colors: { base: RGBA; muted: RGBA; accent: RGBA; success: RGBA; warning: RGBA; error: RGBA }
  shortcuts: (id: string) => string | undefined
}

const GROUPS = [
  { key: "claude", label: "Claude" },
  { key: "gemini-pro", label: "Gemini Pro" },
  { key: "gemini-flash", label: "Gemini Flash" },
]

const SUMMARY_WINDOWS = [
  { key: "weekly", label: "Weekly" },
  { key: "5h", label: "Five-hour" },
] as const

// Header, email, metadata, footer, shell gaps, and host/inner padding.
const QUOTA_DIALOG_RESERVED_ROWS = 8

// Text occupies whole terminal rows. The approved rhythm needs one row within
// each group and a stronger two-row boundary; fractional gaps round unevenly.
const QUOTA_LINE_GAP = 1
const QUOTA_GROUP_GAP = 2
const QUOTA_SCROLL_HINT = "↑/↓ scroll"

/** Keep endpoint-provided group names recognizable while matching the reference labels. */
function quotaGroupLabel(name: string): string {
  if (/^gemini models$/i.test(name)) return "Gemini models"
  if (/^claude and gpt models$/i.test(name)) return "Claude + GPT models"
  return name
}

/** Remove redundant membership prose and family prefixes, preserving the actual member list. */
function quotaGroupMembers(description: string | null): string {
  return (description ?? "").replace(/^Models within this group:\s*/i, "").replace(/\b(?:Gemini|Claude)\s+/g, "")
}

/** Compact reset metadata without converting unknown readings into available quota. */
function quotaResetLabel(fraction: number | null, resetTime: number | null): string {
  if (fraction !== null && fraction >= 1) return "available"
  return formatResetCountdown(resetTime).replace(/^resets in /, "")
}

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
  const [summaryViewportWidth, setSummaryViewportWidth] = createSignal(0)
  const [summaryContentHeight, setSummaryContentHeight] = createSignal(0)
  const terminalDimensions = useTerminalDimensions()
  let quotaScroll: ScrollBoxRenderable | undefined
  const hasSummary = () => (state().entry.quotaSummary?.groups.length ?? 0) > 0
  const summaryGroups = () => state().entry.quotaSummary?.groups ?? []
  const summaryResets = () =>
    summaryGroups().flatMap((group) =>
      SUMMARY_WINDOWS.map((window) =>
        quotaResetLabel(group.buckets[window.key].remainingFraction, group.buckets[window.key].resetTime),
      ),
    )
  const summaryResetWidth = () => Math.max(0, ...summaryResets().map((reset) => reset.length))
  const summaryWidth = () => summaryViewportWidth() || contentWidth()
  const summaryCompact = () => summaryWidth() < 10 + 8 + summaryResetWidth() + 16 + 3
  const summaryBarWidth = () =>
    Math.max(1, Math.min(20, summaryWidth() - (summaryCompact() ? 9 : 10 + 8 + summaryResetWidth() + 3)))
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
      : `Updated ${new Date(checkedAt).toLocaleString("en-GB", { hour12: false })}${freshness === "stale" ? " · stale" : ""}`
  }
  const quotaFooterExtraRows = () => {
    const width = Math.max(1, contentWidth())
    const shortcut = props.shortcuts("antigravity.quota.refresh") ?? "ctrl+r"
    const items = [checked().length, "refresh".length + 1 + shortcut.length]
    // Reserve for the hint while sizing; it appears only if the quota body actually overflows.
    if (hasSummary()) items.push(QUOTA_SCROLL_HINT.length)
    let rows = 1
    let used = 0
    for (const itemWidth of items) {
      if (used > 0 && used + 1 + itemWidth > width) {
        rows++
        used = itemWidth
      } else {
        used += (used > 0 ? 1 : 0) + itemWidth
      }
    }
    // Each wrapped footer row consumes its own row and a flex row gap.
    return Math.max(0, rows - 1) * (1 + QUOTA_LINE_GAP)
  }
  /** Measure the children, not scrollHeight: the latter includes an expanded viewport. */
  const measureSummaryContent = () => {
    queueMicrotask(() => {
      if (quotaScroll) {
        setSummaryViewportWidth(quotaScroll.viewport.width)
        const children = quotaScroll.content.getChildren()
        setSummaryContentHeight(
          children.reduce((height, child) => height + child.height, 0) +
            Math.max(0, children.length - 1) * QUOTA_GROUP_GAP,
        )
      }
    })
  }
  const quotaMaxHeight = () =>
    Math.max(
      1,
      Math.floor(terminalDimensions().height * 0.75) -
        QUOTA_DIALOG_RESERVED_ROWS -
        (hasSummary() ? QUOTA_LINE_GAP : 0) -
        (status() ? Math.ceil(status().length / Math.max(1, contentWidth())) + 1 : 0) -
        Math.max(0, Math.ceil(props.email.length / Math.max(1, contentWidth())) - 1) -
        quotaFooterExtraRows(),
    )
  const initialSummaryHeight = () =>
    summaryGroups().reduce(
      (height, group) =>
        height +
        Math.max(
          1,
          Math.ceil(
            (quotaGroupLabel(group.displayName).length + 2 + quotaGroupMembers(group.description).length) /
              Math.max(1, contentWidth() - 1),
          ),
        ) +
        (summaryCompact() ? 6 : 2) +
        QUOTA_LINE_GAP * 2,
      0,
    ) +
    Math.max(0, summaryGroups().length - 1) * QUOTA_GROUP_GAP
  const quotaHeight = () => Math.min(summaryContentHeight() || initialSummaryHeight(), quotaMaxHeight())
  const quotaOverflow = () => summaryContentHeight() > quotaMaxHeight()

  createEffect(() => {
    if (!hasSummary()) return
    summaryGroups()
    contentWidth()
    measureSummaryContent()
  })

  return (
    <DialogShell
      title="Antigravity quota"
      paddingX={2}
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
          <scrollbox
            ref={(value) => {
              quotaScroll = value
            }}
            height={quotaHeight()}
            flexShrink={0}
            scrollX={false}
            contentOptions={{ flexDirection: "column", gap: QUOTA_GROUP_GAP }}
            onSizeChange={measureSummaryContent}
          >
            <For each={summaryGroups()}>
              {(group) => (
                <box flexDirection="column" gap={QUOTA_LINE_GAP} flexShrink={0}>
                  <box flexDirection="row" gap={2} flexWrap="wrap">
                    <text fg={props.colors.accent} flexShrink={0}>
                      <b>{quotaGroupLabel(group.displayName)}</b>
                    </text>
                    <Show when={group.description}>
                      <text fg={props.colors.muted}>{quotaGroupMembers(group.description)}</text>
                    </Show>
                  </box>
                  <box flexDirection="column" gap={QUOTA_LINE_GAP}>
                    <For each={SUMMARY_WINDOWS}>
                      {(window) => {
                        const bucket = () => group.buckets[window.key]
                        const fraction = () => bucket().remainingFraction
                        const color = () =>
                          fraction() === null
                            ? props.colors.muted
                            : (fraction() ?? 0) <= 0.1
                              ? props.colors.error
                              : (fraction() ?? 0) <= 0.3
                                ? props.colors.warning
                                : props.colors.success
                        const parts = () => quotaBarParts(fraction(), summaryBarWidth())
                        return (
                          <box
                            flexDirection={summaryCompact() ? "column" : "row"}
                            gap={summaryCompact() ? 0 : 1}
                            justifyContent="space-between"
                            flexShrink={0}
                          >
                            <text width={summaryCompact() ? undefined : 10} flexShrink={0} fg={props.colors.base}>
                              {/* Bold row labels follow the user-approved final quota reference. */}
                              <b>{window.label}</b>
                            </text>
                            <box flexDirection="row" gap={1} flexShrink={0}>
                              <text width={summaryBarWidth()} flexShrink={0} fg={color()}>
                                {parts().bar}
                              </text>
                              <text width={8} flexShrink={0} fg={props.colors.base}>
                                {formatQuotaPercentage(fraction()).padStart(8)}
                              </text>
                            </box>
                            <text
                              width={summaryCompact() ? undefined : summaryResetWidth()}
                              flexShrink={0}
                              fg={props.colors.muted}
                            >
                              {quotaResetLabel(fraction(), bucket().resetTime).padStart(
                                summaryCompact() ? 0 : summaryResetWidth(),
                              )}
                            </text>
                          </box>
                        )
                      }}
                    </For>
                  </box>
                </box>
              )}
            </For>
          </scrollbox>
        </Show>
      </box>
      <Show when={Boolean(status())}>
        <text fg={state().failed ? props.colors.error : props.colors.muted}>{status()}</text>
      </Show>
      <box
        flexDirection="row"
        justifyContent="space-between"
        flexWrap="wrap"
        gap={1}
        marginTop={hasSummary() ? QUOTA_LINE_GAP : 0}
      >
        <text fg={props.colors.muted}>{checked()}</text>
        <text
          fg={enabled() ? props.colors.base : props.colors.muted}
          onMouseUp={() => {
            if (enabled()) void props.controller.refresh()
          }}
        >
          <b>refresh</b>
          <span style={{ fg: props.colors.muted }}> {props.shortcuts("antigravity.quota.refresh") ?? "ctrl+r"}</span>
        </text>
        <Show when={hasSummary() && quotaOverflow()}>
          <text fg={props.colors.muted}>{QUOTA_SCROLL_HINT}</text>
        </Show>
      </box>
    </DialogShell>
  )
}
