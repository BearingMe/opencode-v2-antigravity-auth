import { describe, expect, test } from "bun:test"
import { RGBA } from "@opentui/core"
import { createElement, insert, setProp, testRender } from "@opentui/solid"
import { MissingAccountDialogView, QuotaDialogView } from "../dist/src/tui-quota-dialog.js"
import { createQuotaDialogController } from "../dist/src/tui-quota-controller.js"
import { AccountListDialogView } from "../dist/src/tui-account-list-dialog.js"
import type { QuotaRefreshOutcome } from "../src/plugin/account-ui-format.js"
import type { QuotaDialogKeymapCommand } from "../src/tui-quota-dialog.js"

const snapshot = (fraction: number) => ({
  groups: { claude: { remainingFraction: fraction, resetTime: null } },
  checkedAt: 1_700_000_000_000,
  freshness: "fresh",
  status: "ok",
})
const colors = {
  base: RGBA.fromHex("#eeeeee"),
  muted: RGBA.fromHex("#888888"),
  accent: RGBA.fromHex("#9d7cd8"),
  success: RGBA.fromHex("#00ff00"),
  warning: RGBA.fromHex("#ffff00"),
  error: RGBA.fromHex("#ff0000"),
  inputText: RGBA.fromHex("#eeeeee"),
  inputBackground: RGBA.fromHex("#222222"),
}

describe("published account list", () => {
  test("renders readable themed search text on a light background", async () => {
    const light = {
      ...colors,
      base: RGBA.fromHex("#111111"),
      muted: RGBA.fromHex("#666666"),
      selected: RGBA.fromHex("#eeeeee"),
      inputText: RGBA.fromHex("#222222"),
      inputBackground: RGBA.fromHex("#fafafa"),
    }
    const setup = await testRender(
      () => {
        const root = createElement("box")
        setProp(root, "backgroundColor", RGBA.fromHex("#ffffff"))
        insert(root, () =>
          AccountListDialogView({
            accounts: [{ id: "one", email: "one@example.com", enabled: true, description: "" }],
            colors: light,
            layer: () => {},
            choose: () => {},
          }),
        )
        return root
      },
      { width: 64, height: 22 },
    )
    try {
      await setup.flush()
      const placeholder = setup
        .captureSpans()
        .lines.flatMap((line) => line.spans)
        .find((span) => span.text.includes("Search accounts"))!
      expect(placeholder.fg).toEqual(light.muted)
      await setup.mockInput.typeText("one")
      await setup.flush()
      const typed = setup
        .captureSpans()
        .lines.flatMap((line) => line.spans)
        .find((span) => span.text.trim() === "one")!
      expect(typed.fg).toEqual(light.inputText)
      expect(typed.bg).toEqual(light.inputBackground)
      expect(typed.fg).not.toEqual(typed.bg)
      expect(setup.captureCharFrame()).toContain("one@example.com")
    } finally {
      setup.renderer.destroy()
    }
  })
  test("keeps the legend visible in a narrow, scrolling ten-account list", async () => {
    let commands: Array<QuotaDialogKeymapCommand> = []
    const picked: Array<string | undefined> = []
    const setup = await testRender(
      () =>
        AccountListDialogView({
          accounts: Array.from({ length: 10 }, (_, index) => ({
            id: String(index),
            email: `saved-account-number-${index + 1}@example.com`,
            enabled: index % 2 === 0,
            description: "",
          })),
          colors: { ...colors, selected: RGBA.fromHex("#333333") },
          choose: (id) => {
            picked.push(id)
          },
          layer: (input) => {
            commands = input().commands
          },
        }),
      { width: 42, height: 26 },
    )
    try {
      await setup.flush()
      for (let index = 0; index < 9; index++) {
        commands.find((command) => command.id === "antigravity.list.down")!.run()
      }
      await setup.flush()
      const frame = setup.captureCharFrame()
      expect(frame).toContain("number-10")
      expect(frame).toContain("ctrl+t")
      expect(frame).toContain("toggle")
      expect(frame.match(/Add accounts: opencode auth login/gu)).toHaveLength(1)
      commands.find((command) => command.id === "antigravity.list.select")!.run()
      expect(picked).toEqual(["9"])
    } finally {
      setup.renderer.destroy()
    }
  })

  test("keeps the shared footer visible in a host-sized 80x24 dialog", async () => {
    const setup = await testRender(
      () => {
        const backdrop = createElement("box")
        setProp(backdrop, "height", 24)
        setProp(backdrop, "width", 80)
        setProp(backdrop, "paddingTop", 24 / 4)
        setProp(backdrop, "alignItems", "center")
        const content = createElement("box")
        setProp(content, "width", 88)
        setProp(content, "maxWidth", 80 - 2)
        setProp(content, "paddingTop", 1)
        insert(content, () =>
          AccountListDialogView({
            accounts: Array.from({ length: 10 }, (_, index) => ({
              id: String(index),
              email: `saved-${index}@example.com`,
              enabled: index % 2 === 0,
              description: "[selected]",
            })),
            colors: { ...colors, selected: RGBA.fromHex("#333333") },
            layer: () => {},
            choose: () => {},
          }),
        )
        insert(backdrop, content)
        return backdrop
      },
      { width: 80, height: 24 },
    )
    try {
      await setup.flush()
      const frame = setup.captureCharFrame()
      expect(frame).toContain("● enabled · ● disabled · ctrl+t toggle")
      expect(frame).toContain("Add accounts: opencode auth login")
    } finally {
      setup.renderer.destroy()
    }
  })

  test("uses single-cell colored dots and a shared legend/login footer, with search and selection", async () => {
    let commands: Array<QuotaDialogKeymapCommand> = []
    const picked: Array<string | undefined> = []
    const setup = await testRender(
      () =>
        AccountListDialogView({
          accounts: [
            { id: "one", email: "one@example.com", enabled: true, description: "[selected]" },
            { id: "two", email: "two@example.com", enabled: false, description: "[disabled]" },
          ],
          colors: { ...colors, selected: RGBA.fromHex("#333333") },
          choose: (id) => {
            picked.push(id)
          },
          layer: (input) => {
            commands = input().commands
          },
        }),
      { width: 64, height: 22 },
    )
    const run = (id: string) => commands.find((command) => command.id === id)!.run()
    try {
      await setup.flush()
      const frame = setup.captureCharFrame()
      expect(frame).toContain("● one@example.com")
      expect(frame).toContain("● two@example.com [disabled]")
      expect(frame).toContain("● enabled · ● disabled · ctrl+t toggle")
      expect(frame.match(/Add accounts: opencode auth login/gu)).toHaveLength(1)
      const lines = setup.captureSpans().lines
      for (const [email, color] of [
        ["one@example.com", colors.success],
        ["two@example.com", colors.error],
      ] as const) {
        const line = lines.find((line) => line.spans.some((span) => span.text.includes(email)))!
        const dot = line.spans.find((span) => span.text.includes("●"))!
        expect(dot.text.trim()).toBe("●")
        expect(dot.fg).toEqual(color)
      }
      run("antigravity.list.down")
      run("antigravity.list.select")
      expect(picked).toEqual(["two"])
      await setup.mockInput.typeText("one")
      await setup.flush()
      expect(setup.captureCharFrame()).not.toContain("two@example.com")
      run("antigravity.list.select")
      expect(picked).toEqual(["two", "one"])
      await setup.mockInput.typeText("nomatch")
      await setup.flush()
      expect(setup.captureCharFrame()).toContain("No matching accounts")
      run("antigravity.list.select")
      expect(picked).toHaveLength(2)
      run("antigravity.list.close")
      expect(picked).toEqual(["two", "one", undefined])
    } finally {
      setup.renderer.destroy()
    }
  })

  test("toggles account in place on ctrl+t", async () => {
    let commands: Array<QuotaDialogKeymapCommand> = []
    let toggledId: string | undefined
    const setup = await testRender(
      () =>
        AccountListDialogView({
          accounts: [{ id: "one", email: "one@example.com", enabled: true, description: "[selected]" }],
          colors: { ...colors, selected: RGBA.fromHex("#333333") },
          choose: () => {},
          toggle: (id) => {
            toggledId = id
            return true
          },
          layer: (input) => {
            commands = input().commands
          },
        }),
      { width: 64, height: 22 },
    )
    try {
      await setup.flush()
      expect(setup.captureCharFrame()).toContain("● one@example.com")
      expect(setup.captureCharFrame()).not.toContain("[disabled]")
      const toggle = commands.find((command) => command.id === "antigravity.list.toggle")!
      expect(toggle.bind).toBe("ctrl+t")
      await toggle.run()
      await setup.flush()
      expect(toggledId).toBe("one")
      expect(setup.captureCharFrame()).toContain("● one@example.com [disabled]")
    } finally {
      setup.renderer.destroy()
    }
  })
})

test("missing-account notice acknowledges Enter and Esc in its mounted layer", async () => {
  let commands: Array<QuotaDialogKeymapCommand> = []
  let accepted = 0
  const setup = await testRender(
    () =>
      MissingAccountDialogView({
        email: "one@example.com",
        colors,
        acknowledge: () => {
          accepted++
        },
        layer: (input) => {
          commands = input().commands
        },
      }),
    { width: 64, height: 22 },
  )
  try {
    await setup.flush()
    expect(setup.captureCharFrame()).toContain("That account is no longer saved.")
    expect(setup.captureCharFrame()).toContain("OK enter")
    expect(commands.map((command) => command.bind)).toEqual(["return", "escape"])
    for (const command of commands) command.run()
    expect(accepted).toBe(2)
  } finally {
    setup.renderer.destroy()
  }
})

describe("published quota view", () => {
  test("auto-refreshes, renders loading, updates bars, and supports another refresh in place", async () => {
    let resolve!: (result: QuotaRefreshOutcome) => void
    let calls = 0
    let commands: Array<QuotaDialogKeymapCommand> = []
    const controller = createQuotaDialogController({
      initial: snapshot(0.7),
      refreshQuota: () => {
        calls++
        return new Promise((done) => {
          resolve = done
        })
      },
      notifyRefreshFailed: () => {},
      showMissingThenList: async () => {},
      goList: async () => {},
    })
    const setup = await testRender(
      () =>
        QuotaDialogView({
          email: "one@example.com",
          enabled: true,
          controller,
          colors,
          shortcuts: () => undefined,
          layer: (input) => {
            commands = input().commands
          },
        }),
      { width: 60, height: 22 },
    )
    try {
      await setup.flush()
      const frame = setup.captureCharFrame()
      expect(calls).toBe(1)
      expect(frame).toContain("Refreshing")
      expect(frame).toContain("70%")
      expect(frame).toContain("Antigravity quota")
      expect(frame).not.toContain("Not live-updated")
      expect(frame).toContain("refresh ctrl+r")
      expect(frame).not.toContain("back esc")
      resolve({ ok: true, entry: snapshot(0.2) })
      await setup.waitForFrame((frame) => frame.includes("20%") && !frame.includes("Refreshing"))
      const refresh = commands.find((command) => command.id === "antigravity.quota.refresh")!
      refresh.run()
      refresh.run()
      await setup.waitForFrame((frame) => frame.includes("Refreshing"))
      expect(calls).toBe(2)
      resolve({ ok: true, entry: { ...snapshot(0), status: "error" } })
      await setup.waitForFrame((frame) => frame.includes("Refresh failed"))
      expect(setup.captureCharFrame()).toContain("20%")
    } finally {
      setup.renderer.destroy()
    }
    const callsBefore = calls
    await controller.refresh()
    expect(calls).toBe(callsBefore)
  })

  test("fits a narrow terminal and does not auto-refresh disabled accounts", async () => {
    let calls = 0
    const controller = createQuotaDialogController({
      initial: snapshot(0.7),
      refreshQuota: async () => {
        calls++
        return { ok: true, entry: snapshot(0.2) }
      },
      notifyRefreshFailed: () => {},
      showMissingThenList: async () => {},
      goList: async () => {},
    })
    const setup = await testRender(
      () =>
        QuotaDialogView({
          email: "long-saved-account@example.com",
          enabled: false,
          controller,
          colors,
          shortcuts: () => undefined,
          layer: () => {},
        }),
      { width: 42, height: 26 },
    )
    try {
      await setup.flush()
      expect(calls).toBe(0)
      expect(setup.captureCharFrame()).toContain("70%")
      expect(setup.captureCharFrame()).toContain("Account disabled")
      expect(setup.captureCharFrame()).not.toContain("back esc")
      expect(setup.captureCharFrame()).toContain("refresh ctrl+r")
    } finally {
      setup.renderer.destroy()
    }
  })

  test("keeps grouped quota sections together and scrolls only when the terminal is short", async () => {
    let commands: Array<QuotaDialogKeymapCommand> = []
    const controller = createQuotaDialogController({
      initial: {
        ...snapshot(0.7),
        quotaSummary: {
          groups: [
            {
              displayName: "Gemini Models",
              description: "Models within this group: Gemini Flash, Gemini Pro",
              buckets: {
                weekly: { remainingFraction: 0.6558833, resetTime: null },
                "5h": { remainingFraction: 1, resetTime: Date.now() + 5 * 60 * 60 * 1000 },
              },
            },
            {
              displayName: "Claude and GPT models",
              description: "Models within this group: Claude Opus, Claude Sonnet, GPT-OSS",
              buckets: {
                weekly: { remainingFraction: 1, resetTime: Date.now() + 24 * 60 * 60 * 1000 },
                "5h": { remainingFraction: 1, resetTime: Date.now() + 5 * 60 * 60 * 1000 },
              },
            },
          ],
          checkedAt: Date.now(),
          freshness: "fresh",
          status: "ok",
        },
      },
      refreshQuota: async () => ({ ok: true, entry: snapshot(0.2) }),
      notifyRefreshFailed: () => {},
      showMissingThenList: async () => {},
      goList: async () => {},
    })
    const setup = await testRender(
      () =>
        QuotaDialogView({
          email: "one@example.com",
          enabled: false,
          controller,
          colors,
          shortcuts: () => undefined,
          layer: (input) => {
            commands = input().commands
          },
        }),
      { width: 60, height: 40 },
    )
    try {
      await setup.flush()
      const frame = setup.captureCharFrame()
      expect(frame).toContain("Gemini models  Flash, Pro")
      expect(frame).toContain("Claude + GPT models  Opus, Sonnet, GPT-OSS")
      const spans = setup.captureSpans().lines.flatMap((line) => line.spans)
      expect(spans.find((span) => span.text.includes("Gemini models"))?.fg).toEqual(colors.accent)
      expect(spans.find((span) => span.text.includes("Flash, Pro"))?.fg).toEqual(colors.muted)
      expect(spans.find((span) => span.text.includes("65.59%"))?.fg).toEqual(colors.base)
      expect(frame).toContain("Weekly")
      expect(frame).toContain("Five-hour")
      expect(frame).toContain("65.59%")
      expect(frame).not.toContain("Refreshes in")
      expect(frame.match(/Weekly/gu)).toHaveLength(2)
      expect(frame.match(/Five-hour/gu)).toHaveLength(2)
      expect(frame.split("\n").filter((line) => line.includes("█"))).toHaveLength(4)
      expect(
        frame
          .split("\n")
          .filter((line) => line.includes("█"))
          .every((line) => /Weekly|Five-hour/u.test(line)),
      ).toBe(true)
      expect(frame).not.toContain("[█")
      const lines = frame.split("\n")
      const firstCategory = lines.findIndex((line) => line.includes("Gemini models"))
      const firstWeekly = lines.findIndex((line) => line.includes("Weekly"))
      expect(firstWeekly - firstCategory).toBe(2)
      expect(lines[firstWeekly + 1]?.trim()).toBe("")
      expect(lines[firstWeekly + 2]).toContain("Five-hour")
      expect(lines[firstWeekly + 3]?.trim()).toBe("")
      expect(lines[firstWeekly + 4]?.trim()).toBe("")
      expect(lines[firstWeekly + 5]).toContain("Claude + GPT models")
      const footer = lines.find((line) => line.includes("refresh ctrl+r"))!
      expect(footer).toContain("Updated")
      const footerRow = frame.split("\n").findIndex((line) => line.includes("refresh ctrl+r"))
      const lastQuotaRow = frame.split("\n").findLastIndex((line) => line.includes("█"))
      expect(footerRow - lastQuotaRow).toBeLessThanOrEqual(5)
      expect(frame).not.toContain("↑/↓ scroll")
      expect(frame).toContain("refresh ctrl+r")
      expect(frame).not.toContain("Grouped quota unavailable")
      expect(frame).not.toContain("Gemini Models ·")
      expect(frame).not.toContain("Claude and GPT models ·")
      expect(frame.indexOf("Gemini models")).toBeLessThan(frame.indexOf("Claude + GPT models"))

      setup.resize(54, 40)
      await setup.flush()
      const constrainedFrame = setup.captureCharFrame()
      expect(constrainedFrame).toContain("reset unknown")
      const unknownResetLine = constrainedFrame.split("\n").find((line) => line.includes("reset unknown"))
      expect(unknownResetLine?.trimEnd()).toMatch(/reset unknown$/u)

      setup.resize(80, 24)
      await setup.flush()
      const compactFrame = setup.captureCharFrame()
      expect(compactFrame).toContain("Gemini models")
      expect(compactFrame).toContain("↑/↓ scroll")
      setup.resize(80, 16)
      await setup.flush()
      expect(setup.captureCharFrame()).toContain("↑/↓ scroll")
      const scrollDown = commands.find((command) => command.id === "antigravity.quota.scroll-down")
      expect(scrollDown).toBeDefined()
      const scrolledFrames: string[] = []
      for (let index = 0; index < 20; index++) {
        scrollDown?.run()
        await setup.flush()
        scrolledFrames.push(setup.captureCharFrame())
      }
      expect(scrolledFrames.some((frame) => frame.includes("Five-hour"))).toBe(true)
      expect(scrolledFrames.some((frame) => frame.includes("available"))).toBe(true)
      expect(scrolledFrames.every((frame) => frame.includes("refresh ctrl+r"))).toBe(true)

      setup.resize(80, 40)
      await setup.flush()
      expect(setup.captureCharFrame()).not.toContain("↑/↓ scroll")

      const scrollUp = commands.find((command) => command.id === "antigravity.quota.scroll-up")
      for (let index = 0; index < 10; index++) scrollUp?.run()
      setup.resize(42, 24)
      await setup.flush()
      const narrowFrame = setup.captureCharFrame()
      expect(narrowFrame).toContain("↑/↓ scroll")
      expect(narrowFrame.split("\n").some((line) => line.includes("65.59%") && line.includes("█"))).toBe(true)
    } finally {
      setup.renderer.destroy()
    }
  })

  test("gives quota lines breathing room while keeping provider and footer boundaries stronger", async () => {
    const now = Date.now()
    const entry = {
      ...snapshot(0.6603),
      quotaSummary: {
        checkedAt: now,
        freshness: "fresh" as const,
        status: "ok" as const,
        groups: [
          {
            displayName: "Gemini Models",
            description: "Models within this group: Gemini Flash, Gemini Pro",
            buckets: {
              weekly: { remainingFraction: 0.6603, resetTime: now + 19 * 3_600_000 },
              "5h": { remainingFraction: 0.9678, resetTime: now + 3_600_000 },
            },
          },
          {
            displayName: "Claude and GPT models",
            description: "Models within this group: Claude Opus, Claude Sonnet, GPT-OSS",
            buckets: {
              weekly: { remainingFraction: 0.9899, resetTime: now + 7 * 86_400_000 },
              "5h": { remainingFraction: 0.987, resetTime: now + 5 * 3_600_000 },
            },
          },
        ],
      },
    }
    const controller = createQuotaDialogController({
      initial: entry,
      refreshQuota: async () => ({ ok: true, entry }),
      notifyRefreshFailed: () => {},
      showMissingThenList: async () => {},
      goList: async () => {},
    })
    const setup = await testRender(
      () =>
        QuotaDialogView({
          email: "bearingme001@gmail.com",
          enabled: true,
          controller,
          colors,
          shortcuts: () => undefined,
          layer: () => {},
        }),
      { width: 60, height: 40 },
    )
    try {
      await setup.waitForFrame((frame) => frame.includes("98.70%") && !frame.includes("Refreshing"))
      await setup.flush()
      const frame = setup.captureCharFrame()
      const lines = frame.split("\n")
      const categoryRows = lines
        .map((text, row) => ({ text, row }))
        .filter(({ text }) => /Gemini models|Claude \+ GPT models/u.test(text))
        .map(({ row }) => row)
      const quotaRows = lines.map((text, row) => ({ text, row })).filter(({ text }) => /Weekly|Five-hour/u.test(text))
      expect(quotaRows.map(({ row }) => row)).toEqual([
        categoryRows[0]! + 2,
        categoryRows[0]! + 4,
        categoryRows[1]! + 2,
        categoryRows[1]! + 4,
      ])
      expect(categoryRows[1]! - quotaRows[1]!.row).toBe(3)
      const footerRow = lines.findIndex((line) => line.includes("refresh ctrl+r"))
      expect(footerRow - quotaRows[3]!.row).toBe(3)
      expect(lines[footerRow]).toContain("Updated")
      expect(lines[footerRow + 1]?.trim()).toBe("")
      expect(new Set(quotaRows.map(({ text }) => text.indexOf("█"))).size).toBe(1)
      expect(quotaRows.every(({ text }) => text.search(/Weekly|Five-hour/u) === 2)).toBe(true)
      expect(new Set(quotaRows.map(({ text }) => text.indexOf("%"))).size).toBe(1)
      expect(quotaRows.every(({ text }) => text.match(/[█░]+/u)?.[0].length === 20)).toBe(true)
      expect(frame).not.toContain("↑/↓ scroll")
      expect(frame).not.toMatch(/[─━│┃]/u)
    } finally {
      setup.renderer.destroy()
    }
  })

  test("keeps quota controls and bottom padding onscreen in the host's 80x24 container", async () => {
    const bucket = { remainingFraction: 1, resetTime: null }
    const controller = createQuotaDialogController({
      initial: {
        ...snapshot(1),
        quotaSummary: {
          checkedAt: Date.now(),
          freshness: "stale",
          status: "ok",
          groups: [
            {
              displayName: "Gemini Models",
              description: "Models within this group: Gemini Flash, Gemini Pro",
              buckets: { weekly: bucket, "5h": bucket },
            },
            {
              displayName: "Claude and GPT models",
              description: "Models within this group: Claude Opus, Claude Sonnet, GPT-OSS",
              buckets: { weekly: bucket, "5h": bucket },
            },
          ],
        },
      },
      refreshQuota: async () => ({ ok: true, entry: snapshot(1) }),
      notifyRefreshFailed: () => {},
      showMissingThenList: async () => {},
      goList: async () => {},
    })
    const setup = await testRender(
      () => {
        const backdrop = createElement("box")
        setProp(backdrop, "height", 24)
        setProp(backdrop, "width", 80)
        setProp(backdrop, "paddingTop", 6)
        const content = createElement("box")
        setProp(content, "width", 60)
        setProp(content, "paddingTop", 1)
        insert(content, () =>
          QuotaDialogView({
            email: "one@example.com",
            enabled: false,
            controller,
            colors,
            shortcuts: () => undefined,
            layer: () => {},
          }),
        )
        insert(backdrop, content)
        return backdrop
      },
      { width: 80, height: 24 },
    )
    try {
      await setup.flush()
      const lines = setup.captureCharFrame().split("\n")
      expect(lines.findIndex((line) => line.includes("refresh ctrl+r"))).toBeLessThan(23)
      expect(lines.some((line) => line.includes("refresh ctrl+r"))).toBe(true)
      expect(lines.some((line) => line.includes("↑/↓ scroll"))).toBe(true)
      const heading = lines.find((line) => line.includes("Antigravity quota"))!
      const email = lines.find((line) => line.includes("one@example.com"))!
      const footer = lines.find((line) => line.includes("refresh ctrl+r"))!
      const hintRow = lines.findIndex((line) => line.includes("↑/↓ scroll"))
      expect(heading.indexOf("Antigravity quota")).toBe(email.indexOf("one@example.com"))
      expect(footer.indexOf("Updated")).toBe(email.indexOf("one@example.com"))
      expect(footer.indexOf("refresh")).toBeGreaterThan(footer.indexOf("Updated"))
      expect(footer).toContain("stale")
      expect(hintRow).toBeGreaterThan(lines.findIndex((line) => line.includes("refresh ctrl+r")))
      expect(hintRow).toBeLessThan(24)
      const weeklyRow = lines.findIndex((line) => line.includes("Weekly"))
      expect(lines[weeklyRow + 2]).toContain("Five-hour")
      const bars = lines.filter((line) => line.includes("█"))
      expect(bars.length).toBeGreaterThanOrEqual(2)
      expect(bars.every((line) => (line.match(/[█░]+/u)?.[0].length ?? 0) <= 20)).toBe(true)
      expect(heading).toContain("esc")
    } finally {
      setup.renderer.destroy()
    }
  })

  test("fills measured width, aligns metadata, and relayouts on resize without fetching", async () => {
    let calls = 0
    let backs = 0
    let commands: Array<QuotaDialogKeymapCommand> = []
    const controller = createQuotaDialogController({
      initial: {
        ...snapshot(0.7),
        groups: {
          claude: { remainingFraction: 0.7, resetTime: null },
          "gemini-pro": { remainingFraction: 0, resetTime: null },
          "gemini-flash": { remainingFraction: null, resetTime: null },
        },
      },
      refreshQuota: async () => {
        calls++
        return { ok: true, entry: snapshot(0.2) }
      },
      notifyRefreshFailed: () => {},
      showMissingThenList: async () => {},
      goList: async () => {
        backs++
      },
    })
    const setup = await testRender(
      () =>
        QuotaDialogView({
          email: "one@example.com",
          enabled: false,
          controller,
          colors,
          shortcuts: () => undefined,
          layer: (input) => {
            commands = input().commands
          },
        }),
      { width: 120, height: 30 },
    )
    const barLines = () =>
      setup
        .captureCharFrame()
        .split("\n")
        .filter((line) => /[█░]/u.test(line))
    const checkWide = (width: number) => {
      const rows = barLines()
      expect(rows).toHaveLength(3)
      for (const row of rows) {
        expect(row.match(/[█░]+/u)?.[0].length).toBe(width - 4 - 35)
        expect(row.trimEnd().length).toBe(width - 2)
      }
      expect(rows.map((row) => row.indexOf("reset unknown"))).toEqual(Array(3).fill(width - 15))
      expect(rows[0]?.indexOf("70%")! + 3).toBe(rows[1]?.indexOf("0%")! + 2)
      expect(rows[2]).toContain("unknown")
    }
    try {
      await setup.flush()
      checkWide(120)
      setup.resize(60, 30)
      await setup.flush()
      checkWide(60)
      setup.resize(42, 30)
      await setup.flush()
      for (const row of barLines()) {
        expect(row.match(/[█░]+/u)?.[0].length).toBe(30)
        expect(row.trimEnd().length).toBe(40)
      }
      expect(setup.captureCharFrame()).toContain("Gemini Flash")
      expect(setup.captureCharFrame()).toContain("refresh ctrl+r")
      expect(setup.captureCharFrame()).not.toContain("back esc")
      setup.resize(120, 30)
      await setup.flush()
      checkWide(120)
      expect(calls).toBe(0)
      const back = commands.find((command) => command.id === "antigravity.quota.back")!
      expect(back.bind).toBe("escape")
      back.run()
      expect(backs).toBe(1)
    } finally {
      setup.renderer.destroy()
    }
  })

  test("measures the host container rather than terminal width and reserves the longest reset", async () => {
    const controller = createQuotaDialogController({
      initial: {
        ...snapshot(0.7),
        groups: {
          claude: { remainingFraction: 0.7, resetTime: Date.now() + 23 * 3_600_000 + 45 * 60_000 },
          "gemini-pro": { remainingFraction: 1, resetTime: null },
          "gemini-flash": { remainingFraction: null, resetTime: null },
        },
      },
      refreshQuota: async () => ({ ok: true, entry: snapshot(0.2) }),
      notifyRefreshFailed: () => {},
      showMissingThenList: async () => {},
      goList: async () => {},
    })
    let container!: ReturnType<typeof createElement>
    const setup = await testRender(
      () => {
        container = createElement("box")
        setProp(container, "width", 72)
        insert(container, () =>
          QuotaDialogView({
            email: "one@example.com",
            enabled: false,
            controller,
            colors,
            shortcuts: () => undefined,
            layer: () => {},
          }),
        )
        return container
      },
      { width: 140, height: 30 },
    )
    try {
      await setup.flush()
      const rows = setup
        .captureCharFrame()
        .split("\n")
        .filter((line) => /[█░]/u.test(line))
      expect(rows).toHaveLength(3)
      expect(rows.map((row) => row.match(/[█░]+/u)?.[0].length)).toEqual([29, 29, 29])
      expect(rows.map((row) => row.indexOf("reset"))).toEqual([53, 53, 53])
      for (const row of rows) expect(row.trimEnd().length).toBeLessThanOrEqual(70)
      setProp(container, "width", 42)
      await setup.flush()
      const narrowRows = setup
        .captureCharFrame()
        .split("\n")
        .filter((line) => /[█░]/u.test(line))
      expect(narrowRows.map((row) => row.match(/[█░]+/u)?.[0].length)).toEqual([30, 30, 30])
      expect(narrowRows.every((row) => !row.includes("reset"))).toBe(true)
    } finally {
      setup.renderer.destroy()
    }
  })
})
