import { afterEach, describe, expect, it } from "bun:test"
import { spawnSync } from "node:child_process"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { checkArchitecture } from "./check-boundaries"

const fixtureRoots: string[] = []

afterEach(() => {
  for (const root of fixtureRoots.splice(0)) rmSync(root, { recursive: true, force: true })
})

/** Creates an isolated source tree for boundary-policy tests. */
function createFixture(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "opencode-boundaries-"))
  fixtureRoots.push(root)
  for (const [pathname, contents] of Object.entries(files)) {
    const filePath = join(root, pathname)
    mkdirSync(dirname(filePath), { recursive: true })
    writeFileSync(filePath, contents)
  }
  return root
}

/** Returns diagnostics for an isolated fixture using no legacy allowances. */
function diagnosticsFor(files: Record<string, string>) {
  return checkArchitecture(createFixture(files), [])
}

describe("architecture boundary checker", () => {
  it("allows external imports through public contracts and resolves .js specifiers", () => {
    const diagnostics = diagnosticsFor({
      "src/app/entry.ts":
        'import type { AccountList } from "../modules/accounts/index.js"\nexport type { AccountList }',
      "src/modules/accounts/index.ts": 'import type { ZodType } from "zod"\nexport interface AccountList {}',
    })

    expect(diagnostics).toEqual([])
  })

  it("rejects deep imports through static imports, re-exports, and literal dynamic imports", () => {
    const diagnostics = diagnosticsFor({
      "src/app/entry.ts": [
        'import { internal } from "../modules/accounts/internal.js"',
        'export * from "../modules/accounts/internal.js"',
        'void import("../modules/accounts/internal.js")',
        'void import("../modules/accounts/internal.js", { with: { type: "json" } })',
        'const legacy = require("../modules/accounts/internal.js")',
        "void internal",
      ].join("\n"),
      "src/modules/accounts/index.ts": "",
      "src/modules/accounts/internal.ts": "export const internal = true",
    })

    expect(diagnostics).toHaveLength(5)
    expect(diagnostics.every((diagnostic) => diagnostic.message.includes("private module file"))).toBe(true)
  })

  it("keeps modules and platform from depending on forbidden local layers", () => {
    const diagnostics = diagnosticsFor({
      "src/modules/accounts/index.ts": 'import type { PluginClient } from "../../plugin/types.js"',
      "src/plugin/types.ts": "export interface PluginClient {}",
      "src/modules/inference/index.ts": 'import type { AccountList } from "../accounts/index.js"',
      "src/modules/session-recovery/index.ts": [
        'import { readFile } from "node:fs"',
        'import { request } from "unlisted-http-client"',
      ].join("\n"),
      "src/platform/logging/index.ts": 'import type { AccountList } from "../../modules/accounts/index.js"',
      "src/platform/host.ts": 'import { Plugin } from "@opencode/plugin"',
    })

    expect(diagnostics).toHaveLength(6)
    expect(diagnostics.some((diagnostic) => diagnostic.message.includes("leaves modules/platform boundaries"))).toBe(
      true,
    )
    expect(diagnostics.some((diagnostic) => diagnostic.message.includes("higher or legacy layer"))).toBe(true)
    expect(
      diagnostics.some((diagnostic) => diagnostic.message.includes("module dependency inference -> accounts")),
    ).toBe(true)
    expect(diagnostics.some((diagnostic) => diagnostic.message.includes("external package node:fs"))).toBe(true)
    expect(diagnostics.some((diagnostic) => diagnostic.message.includes("unlisted-http-client"))).toBe(true)
    expect(diagnostics.some((diagnostic) => diagnostic.message.includes("@opencode/plugin"))).toBe(true)
  })

  it("allows type-only references without hiding runtime cycles", () => {
    const typeOnlyDiagnostics = diagnosticsFor({
      "src/modules/inference/a.ts": 'import type { B } from "./b.js"\nexport const a = 1',
      "src/modules/inference/b.ts": 'import { a } from "./a.js"\nexport const b = a',
    })
    expect(typeOnlyDiagnostics).toEqual([])

    const runtimeDiagnostics = diagnosticsFor({
      "src/modules/inference/a.ts": 'import {} from "./b.js"\nexport const a = 1',
      "src/modules/inference/b.ts": 'import { a } from "./a.js"\nexport const b = a',
    })
    expect(runtimeDiagnostics.some((diagnostic) => diagnostic.message.includes("runtime dependency cycle"))).toBe(true)

    const emptyReexportDiagnostics = diagnosticsFor({
      "src/modules/inference/a.ts": 'export {} from "./b.js"\nexport const a = 1',
      "src/modules/inference/b.ts": 'import { a } from "./a.js"\nexport const b = a',
    })
    expect(emptyReexportDiagnostics.some((diagnostic) => diagnostic.message.includes("runtime dependency cycle"))).toBe(
      true,
    )
  })

  it("applies a legacy exception only to its exact source and target pair", () => {
    const root = createFixture({
      "src/plugin/engine.ts": 'import "../app/legacy-bridges/accounts.js"',
      "src/plugin/other.ts": 'import "../app/legacy-bridges/accounts.js"',
      "src/app/legacy-bridges/accounts.ts": "",
    })
    const diagnostics = checkArchitecture(root, [
      {
        source: "src/plugin/engine.ts",
        target: "src/app/legacy-bridges/accounts.ts",
        reason: "The request engine has not moved yet.",
        removeAfter: "Step 12",
      },
    ])

    expect(diagnostics).toHaveLength(1)
    expect(diagnostics[0]?.source).toBe("src/plugin/other.ts")
    expect(diagnostics[0]?.message).toContain("no exact, documented exception")
  })

  it("does not let an allowed cycle mask new edges among the same files", () => {
    const root = createFixture({
      "src/plugin/a.ts": 'import "./b.js"\nimport "./c.js"',
      "src/plugin/b.ts": 'import "./c.js"',
      "src/plugin/c.ts": 'import "./a.js"',
    })
    const diagnostics = checkArchitecture(
      root,
      [],
      [
        {
          edges: [
            { source: "src/plugin/a.ts", target: "src/plugin/b.ts" },
            { source: "src/plugin/b.ts", target: "src/plugin/c.ts" },
            { source: "src/plugin/c.ts", target: "src/plugin/a.ts" },
          ],
          reason: "One exact legacy cycle is temporarily retained.",
          removeAfter: "Step 4",
        },
      ],
    )

    expect(diagnostics).toHaveLength(2)
    expect(diagnostics.some((diagnostic) => diagnostic.message.includes("runtime dependency cycle"))).toBe(true)
    expect(diagnostics.some((diagnostic) => diagnostic.message.includes("stale runtime-cycle exception"))).toBe(true)
  })

  it("reports the invalid fixture through the actual CLI with a useful location", () => {
    const root = createFixture({
      "src/app/entry.ts": 'import { internal } from "../modules/accounts/internal.js"',
      "src/modules/accounts/index.ts": "",
      "src/modules/accounts/internal.ts": "export const internal = true",
    })
    const scriptPath = fileURLToPath(new URL("./check-boundaries.ts", import.meta.url))
    const result = spawnSync(process.execPath, [scriptPath, "--root", root], { encoding: "utf8" })

    expect(result.status).toBe(1)
    expect(`${result.stdout}${result.stderr}`).toContain("src/app/entry.ts:1")
    expect(`${result.stdout}${result.stderr}`).toContain("src/modules/accounts/internal.ts")
  })
})
