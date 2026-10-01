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
  base: RGBA.fromHex("#eeeeee"), muted: RGBA.fromHex("#888888"),
  success: RGBA.fromHex("#00ff00"), warning: RGBA.fromHex("#ffff00"), error: RGBA.fromHex("#ff0000"),
  inputText: RGBA.fromHex("#eeeeee"), inputBackground: RGBA.fromHex("#222222"),
}

describe("published account list", () => {
  test("renders readable themed search text on a light background", async () => {
    const light = {
      ...colors, base: RGBA.fromHex("#111111"), muted: RGBA.fromHex("#666666"),
      selected: RGBA.fromHex("#eeeeee"), inputText: RGBA.fromHex("#222222"), inputBackground: RGBA.fromHex("#fafafa"),
    }
    const setup = await testRender(() => {
      const root = createElement("box")
      setProp(root, "backgroundColor", RGBA.fromHex("#ffffff"))
      insert(root, () => AccountListDialogView({
        accounts: [{ id: "one", email: "one@example.com", enabled: true, description: "" }],
        colors: light, layer: () => {}, choose: () => {},
      }))
      return root
    }, { width: 64, height: 22 })
    try {
      await setup.flush()
      const placeholder = setup.captureSpans().lines.flatMap((line) => line.spans)
        .find((span) => span.text.includes("Search accounts"))!
      expect(placeholder.fg).toEqual(light.muted)
      await setup.mockInput.typeText("one")
      await setup.flush()
      const typed = setup.captureSpans().lines.flatMap((line) => line.spans)
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
    const setup = await testRender(() => AccountListDialogView({
      accounts: Array.from({ length: 10 }, (_, index) => ({
        id: String(index), email: `saved-account-number-${index + 1}@example.com`,
        enabled: index % 2 === 0, description: "",
      })),
      colors: { ...colors, selected: RGBA.fromHex("#333333") },
      choose: (id) => { picked.push(id) },
      layer: (input) => { commands = input().commands },
    }), { width: 42, height: 26 })
    try {
      await setup.flush()
      for (let index = 0; index < 9; index++) {
        commands.find((command) => command.id === "antigravity.list.down")!.run()
      }
      await setup.flush()
      const frame = setup.captureCharFrame()
      expect(frame).toContain("number-10")
      expect(frame).toContain("● enabled · ● disabled")
      expect(frame.match(/Add accounts: opencode auth login/gu)).toHaveLength(1)
      commands.find((command) => command.id === "antigravity.list.select")!.run()
      expect(picked).toEqual(["9"])
    } finally {
      setup.renderer.destroy()
    }
  })

  test("keeps the shared footer visible in a host-sized 80x24 dialog", async () => {
    const setup = await testRender(() => {
      const backdrop = createElement("box")
      setProp(backdrop, "height", 24)
      setProp(backdrop, "width", 80)
      setProp(backdrop, "paddingTop", 24 / 4)
      setProp(backdrop, "alignItems", "center")
      const content = createElement("box")
      setProp(content, "width", 88)
      setProp(content, "maxWidth", 80 - 2)
      setProp(content, "paddingTop", 1)
      insert(content, () => AccountListDialogView({
        accounts: Array.from({ length: 10 }, (_, index) => ({
          id: String(index), email: `saved-${index}@example.com`,
          enabled: index % 2 === 0, description: "[selected]",
        })),
        colors: { ...colors, selected: RGBA.fromHex("#333333") },
        layer: () => {}, choose: () => {},
      }))
      insert(backdrop, content)
      return backdrop
    }, { width: 80, height: 24 })
    try {
      await setup.flush()
      const frame = setup.captureCharFrame()
      expect(frame).toContain("● enabled · ● disabled")
      expect(frame).toContain("Add accounts: opencode auth login")
    } finally {
      setup.renderer.destroy()
    }
  })

  test("uses single-cell colored dots and a shared legend/login footer, with search and selection", async () => {
    let commands: Array<QuotaDialogKeymapCommand> = []
    const picked: Array<string | undefined> = []
    const setup = await testRender(() => AccountListDialogView({
      accounts: [
        { id: "one", email: "one@example.com", enabled: true, description: "[selected]" },
        { id: "two", email: "two@example.com", enabled: false, description: "[disabled]" },
      ],
      colors: { ...colors, selected: RGBA.fromHex("#333333") },
      choose: (id) => { picked.push(id) },
      layer: (input) => { commands = input().commands },
    }), { width: 64, height: 22 })
    const run = (id: string) => commands.find((command) => command.id === id)!.run()
    try {
      await setup.flush()
      const frame = setup.captureCharFrame()
      expect(frame).toContain("● one@example.com")
      expect(frame).toContain("● two@example.com [disabled]")
      expect(frame).toContain("● enabled · ● disabled")
      expect(frame.match(/Add accounts: opencode auth login/gu)).toHaveLength(1)
      const lines = setup.captureSpans().lines
      for (const [email, color] of [["one@example.com", colors.success], ["two@example.com", colors.error]] as const) {
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
})

test("missing-account notice acknowledges Enter and Esc in its mounted layer", async () => {
  let commands: Array<QuotaDialogKeymapCommand> = []
  let accepted = 0
  const setup = await testRender(() => MissingAccountDialogView({
    email: "one@example.com", colors, acknowledge: () => { accepted++ },
    layer: (input) => { commands = input().commands },
  }), { width: 64, height: 22 })
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
        return new Promise((done) => { resolve = done })
      },
      notifyRefreshFailed: () => {}, showMissingThenList: async () => {}, goList: async () => {},
    })
    const setup = await testRender(() => QuotaDialogView({
      email: "one@example.com", enabled: true, controller, colors,
      shortcuts: () => undefined,
      layer: (input) => { commands = input().commands },
    }), { width: 60, height: 22 })
    try {
      await setup.flush()
      const frame = setup.captureCharFrame()
      expect(calls).toBe(1)
      expect(frame).toContain("Refreshing")
      expect(frame).toContain("70%")
      expect(frame).toContain("Antigravity quota")
      expect(frame).toContain("Not live-updated")
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
      refreshQuota: async () => { calls++; return { ok: true, entry: snapshot(0.2) } },
      notifyRefreshFailed: () => {}, showMissingThenList: async () => {}, goList: async () => {},
    })
    const setup = await testRender(() => QuotaDialogView({
      email: "long-saved-account@example.com", enabled: false, controller, colors,
      shortcuts: () => undefined, layer: () => {},
    }), { width: 42, height: 26 })
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
      refreshQuota: async () => { calls++; return { ok: true, entry: snapshot(0.2) } },
      notifyRefreshFailed: () => {}, showMissingThenList: async () => {},
      goList: async () => { backs++ },
    })
    const setup = await testRender(() => QuotaDialogView({
      email: "one@example.com", enabled: false, controller, colors,
      shortcuts: () => undefined, layer: (input) => { commands = input().commands },
    }), { width: 120, height: 30 })
    const barLines = () => setup.captureCharFrame().split("\n").filter((line) => /[█░]/u.test(line))
    const checkWide = (width: number) => {
      const rows = barLines()
      expect(rows).toHaveLength(3)
      for (const row of rows) {
        expect(row.match(/[█░]+/u)?.[0].length).toBe(width - 8 - 35)
        expect(row.trimEnd().length).toBe(width - 4)
      }
      expect(rows.map((row) => row.indexOf("reset unknown"))).toEqual(Array(3).fill(width - 17))
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
        expect(row.match(/[█░]+/u)?.[0].length).toBe(26)
        expect(row.trimEnd().length).toBe(38)
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
      notifyRefreshFailed: () => {}, showMissingThenList: async () => {}, goList: async () => {},
    })
    let container!: ReturnType<typeof createElement>
    const setup = await testRender(() => {
      container = createElement("box")
      setProp(container, "width", 72)
      insert(container, () => QuotaDialogView({
        email: "one@example.com", enabled: false, controller, colors,
        shortcuts: () => undefined, layer: () => {},
      }))
      return container
    }, { width: 140, height: 30 })
    try {
      await setup.flush()
      const rows = setup.captureCharFrame().split("\n").filter((line) => /[█░]/u.test(line))
      expect(rows).toHaveLength(3)
      expect(rows.map((row) => row.match(/[█░]+/u)?.[0].length)).toEqual([25, 25, 25])
      expect(rows.map((row) => row.indexOf("reset"))).toEqual([51, 51, 51])
      for (const row of rows) expect(row.trimEnd().length).toBeLessThanOrEqual(68)
      setProp(container, "width", 42)
      await setup.flush()
      const narrowRows = setup.captureCharFrame().split("\n").filter((line) => /[█░]/u.test(line))
      expect(narrowRows.map((row) => row.match(/[█░]+/u)?.[0].length)).toEqual([26, 26, 26])
      expect(narrowRows.every((row) => !row.includes("reset"))).toBe(true)
    } finally {
      setup.renderer.destroy()
    }
  })
})
