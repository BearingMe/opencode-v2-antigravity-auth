import { createSolidTransformPlugin } from "@opentui/solid/bun-plugin"

// tsc emits declarations and the non-JSX modules. Compile the view with the
// OpenTUI Solid transform: automatic JSX alone loses reactive prop getters.
// Externalize every import so the host supplies the renderer/Solid singleton.
const result = await Bun.build({
  entrypoints: ["src/tui-quota-dialog.tsx", "src/tui-account-list-dialog.tsx"],
  outdir: "dist/src",
  target: "bun",
  external: ["*"],
  plugins: [createSolidTransformPlugin()],
  sourcemap: "external",
})
if (!result.success) throw new AggregateError(result.logs, "TUI compilation failed")
