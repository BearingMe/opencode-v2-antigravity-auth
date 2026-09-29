import { Plugin } from "@opencode/plugin/tui"
import { AntigravitySmoke } from "./rpc.js"

type SmokeAction = "ping" | "info"

export default Plugin.define({
  id: "antigravity-smoke-tui",
  setup(context) {
    const ping = async (): Promise<string> => {
      try {
        const value = await context.client.rpc(AntigravitySmoke).ping({}, {
          location: context.location ?? context.data.location.default(),
        })
        return `RPC: ${JSON.stringify(value)}`
      } catch (error: unknown) {
        return `RPC failed: ${String(error)}`
      }
    }
    // Keymap layers are owned by the calling component, so registration
    // happens inside an app slot render. Interaction uses host-rendered
    // dialogs on purpose: custom JSX pages crashed against the host
    // renderer ("No renderer found"), dialogs and toasts are host-owned.
    const unregisterCommands = context.ui.slot({
      append: "app",
      render: () => {
        context.keymap.layer(() => ({
          mode: "global",
          commands: [{
            id: "antigravity.smoke",
            title: "Antigravity smoke test",
            palette: true,
            slash: { name: "antigravity-smoke" },
            run: async () => {
              const action = await context.ui.dialog.select<SmokeAction>({
                title: "Antigravity smoke",
                placeholder: "Pick a check",
                options: [
                  { title: "Ping RPC", value: "ping", description: "Round-trip ping through the server plugin" },
                  { title: "Plugin info", value: "info", description: "Show host and plugin details" },
                ],
              })
              if (action === "ping") {
                const outcome = await ping()
                context.ui.toast.show({
                  title: "Antigravity smoke",
                  message: outcome,
                  variant: outcome.startsWith("RPC failed") ? "error" : "success",
                })
              } else if (action === "info") {
                await context.ui.dialog.alert({
                  title: "Antigravity smoke",
                  message: `Host ${context.app.version} (${context.app.channel})\nDirectory ${context.location?.directory ?? "unknown"}`,
                })
              }
            },
          }],
        }))
        return null
      },
    })
    return unregisterCommands
  },
})
