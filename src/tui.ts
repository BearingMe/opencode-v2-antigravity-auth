import { Plugin } from "@opencode/plugin/tui"
import { AntigravityAccounts } from "./rpc.js"
import { formatAccountOneLiner, formatResetCountdown, renderQuotaBar } from "./plugin/account-ui-format.js"

type AccountAction = "show-quota" | "refresh-quota" | "use-next" | "toggle-enabled" | "verify" | "remove" | "back"

interface ListAccount {
  id: string
  email: string
  enabled: boolean
  active: boolean
  verificationRequired: boolean
}

interface QuotaGroup {
  remainingFraction: number | null
  resetTime: number | null
}

interface QuotaAccount {
  id: string
  email: string
  enabled: boolean
  status: "ok" | "error" | "unknown"
  groups: Record<string, QuotaGroup>
  checkedAt: number | null
  freshness: "fresh" | "stale" | "unchecked"
  verificationRequired: boolean
  coolingDown: boolean
  selectedByFamily: { claude: boolean; gemini: boolean }
}

const ADD_ACCOUNTS_HINT = "Add accounts: opencode auth login"
const SERVER_UNAVAILABLE = "Antigravity server unavailable. Restart opencode or check the plugin installation, then try again."
const INVALID_RPC_RESPONSE = "Antigravity accounts response invalid. Update the plugin and opencode, then try again."

export function isInvalidRpcResponse(error: unknown): boolean {
  if (error instanceof Error) {
    return error.name === "InvalidRequestError" && error.message.includes("Expected JSON value")
  }
  if (typeof error === "object" && error !== null) {
    const record = error as { name?: unknown; message?: unknown; type?: unknown; code?: unknown }
    if (record.type === "rpc.invalid_output" || record.code === "rpc.invalid_output") return true
    return record.name === "InvalidRequestError"
      && typeof record.message === "string"
      && record.message.includes("Expected JSON value")
  }
  return false
}

export type MutateOutcome =
  | { op: string; remaining: number }
  | { ok: false; kind: string; accountCount: number }

export function isStaleMutate(outcome: MutateOutcome): boolean {
  return "ok" in outcome
}

function rpcLocation(context: Parameters<Parameters<typeof Plugin.define>[0]["setup"]>[0]) {
  return context.location ?? context.data.location.default()
}

function quotaLines(account: QuotaAccount): string {
  const groups = ["claude", "gemini-pro", "gemini-flash"]
  const lines = groups.map((group) => {
    const entry = account.groups[group] ?? { remainingFraction: null, resetTime: null }
    const bar = renderQuotaBar(entry.remainingFraction)
    const reset = formatResetCountdown(entry.resetTime)
    return `${group}: ${bar} (${reset})`
  })
  const checked = account.checkedAt === null ? "never checked" : new Date(account.checkedAt).toLocaleString()
  return [...lines, `status: ${account.status} (${account.freshness}, checked: ${checked})`].join("\n")
}

export default Plugin.define({
  id: "antigravity-accounts-tui",
  setup(context) {
    const toastRpcFailure = (detail: unknown) => {
      // Keep the user-visible toast generic: server-side diagnostics
      // (schema rejections) already land in the host log.
      context.ui.toast.show({
        title: "Antigravity accounts",
        message: isInvalidRpcResponse(detail)
          ? INVALID_RPC_RESPONSE
          : SERVER_UNAVAILABLE,
        variant: "error",
      })
    }
    const toastStaleAccount = async () => {
      context.ui.toast.show({
        title: "Antigravity accounts",
        message: "That account is no longer saved. The list will refresh.",
        variant: "warning",
      })
    }

    const openList = async (): Promise<void> => {
      let listing: { accounts: Array<ListAccount> }
      try {
        listing = await context.client.rpc(AntigravityAccounts).list({}, {
          location: rpcLocation(context),
        }) as { accounts: Array<ListAccount> }
      } catch (error: unknown) {
        toastRpcFailure(error)
        return
      }
      if (listing.accounts.length === 0) {
        await context.ui.dialog.alert({
          title: "Antigravity accounts",
          message: `No saved Antigravity accounts.\n${ADD_ACCOUNTS_HINT}`,
        })
        return
      }
      let quotaById = new Map<string, QuotaAccount>()
      try {
        const presentation = await context.client.rpc(AntigravityAccounts).quota({ refresh: false }, {
          location: rpcLocation(context),
        }) as { accounts: Array<QuotaAccount> }
        quotaById = new Map(presentation.accounts.map((entry) => [entry.id, entry]))
      } catch {
        quotaById = new Map()
      }
      const picked = await context.ui.dialog.select<string>({
        title: "Antigravity accounts",
        placeholder: ADD_ACCOUNTS_HINT,
        options: listing.accounts.map((account) => {
          const quota = quotaById.get(account.id)
          const description = formatAccountOneLiner({
            email: account.email,
            enabled: account.enabled,
            active: account.active,
            verificationRequired: account.verificationRequired,
            coolingDown: quota?.coolingDown ?? false,
            status: quota?.status,
            selectedByFamily: quota?.selectedByFamily,
          })
          return {
            title: account.email,
            value: account.id,
            description,
            footer: ADD_ACCOUNTS_HINT,
          }
        }),
      })
      if (picked === undefined) return
      const selected = listing.accounts.find((entry) => entry.id === picked)
      if (!selected) {
        context.ui.toast.show({
          title: "Antigravity accounts",
          message: "That account is no longer saved. The list will refresh.",
          variant: "warning",
        })
        await openList()
        return
      }
      await openActions(selected)
    }

    const openActions = async (account: ListAccount): Promise<void> => {
      const toggleLabel = account.enabled ? "Disable" : "Enable"
      const action = await context.ui.dialog.select<AccountAction>({
        title: account.email,
        placeholder: ADD_ACCOUNTS_HINT,
        options: [
          { title: "Show quota", value: "show-quota", description: "Cached quota bars as text" },
          { title: "Refresh quota", value: "refresh-quota", description: "Fetch fresh quota, then show text bars" },
          { title: "Use next", value: "use-next", description: "Rotation hint, not permanent pinning" },
          { title: toggleLabel, value: "toggle-enabled", description: account.enabled ? "Disable this account" : "Enable this account" },
          { title: "Verify", value: "verify", description: "Check access, show reconnect guidance when blocked" },
          { title: "Remove", value: "remove", description: "Delete this account after confirmation" },
          { title: "Back", value: "back", description: "Return to the account list" },
        ],
      })
      if (action === undefined || action === "back") {
        if (action === "back") await openList()
        return
      }
      if (action === "show-quota") {
        try {
          const presentation = await context.client.rpc(AntigravityAccounts).quota({ refresh: false }, {
            location: rpcLocation(context),
          }) as { accounts: Array<QuotaAccount> }
          const entry = presentation.accounts.find((item) => item.id === account.id)
          if (!entry) {
            await context.ui.dialog.alert({
              title: account.email,
              message: "That account is no longer saved.",
            })
            await openList()
            return
          }
          await context.ui.dialog.alert({
            title: account.email,
            message: quotaLines(entry),
          })
        } catch (error: unknown) {
          toastRpcFailure(error)
        }
        await openActions(account)
        return
      }
      if (action === "refresh-quota") {
        try {
          const presentation = await context.client.rpc(AntigravityAccounts).quota({ refresh: true }, {
            location: rpcLocation(context),
          }) as { accounts: Array<QuotaAccount> }
          const entry = presentation.accounts.find((item) => item.id === account.id)
          await context.ui.dialog.alert({
            title: account.email,
            message: entry ? quotaLines(entry) : "That account is no longer saved.",
          })
        } catch (error: unknown) {
          toastRpcFailure(error)
        }
        await openActions(account)
        return
      }
      if (action === "use-next") {
        try {
          const outcome = await context.client.rpc(AntigravityAccounts).mutate({ id: account.id, op: "select" }, {
            location: rpcLocation(context),
          }) as MutateOutcome
          if (isStaleMutate(outcome)) {
            await toastStaleAccount()
            await openList()
            return
          }
          context.ui.toast.show({
            title: "Antigravity accounts",
            message: `${account.email} will be tried next (rotation hint, not permanent pinning).`,
            variant: "success",
          })
        } catch (error: unknown) {
          toastRpcFailure(error)
        }
        await openList()
        return
      }
      if (action === "toggle-enabled") {
        try {
          const outcome = await context.client.rpc(AntigravityAccounts).mutate({ id: account.id, op: account.enabled ? "disable" : "enable" }, {
            location: rpcLocation(context),
          }) as MutateOutcome
          if (isStaleMutate(outcome)) {
            await toastStaleAccount()
            await openList()
            return
          }
          context.ui.toast.show({
            title: "Antigravity accounts",
            message: `${account.email} ${account.enabled ? "disabled" : "enabled"}.`,
            variant: "success",
          })
        } catch (error: unknown) {
          toastRpcFailure(error)
        }
        await openList()
        return
      }
      if (action === "verify") {
        try {
          const outcome = await context.client.rpc(AntigravityAccounts).verify({ id: account.id }, {
            location: rpcLocation(context),
          }) as
            | { index: number; email?: string; checkedAt: number; status: "ok" | "blocked" | "error"; message: string; verifyUrl?: string }
            | { ok: false; kind: string; accountCount: number }
          if ("ok" in outcome) {
            context.ui.toast.show({
              title: "Antigravity accounts",
              message: "That account is no longer saved. The list will refresh.",
              variant: "warning",
            })
            await openList()
            return
          }
          if (outcome.status === "blocked") {
            await context.ui.dialog.alert({
              title: account.email,
              message: `${outcome.message}${outcome.verifyUrl ? `\nVerify: ${outcome.verifyUrl}` : ""}\nReconnect guidance: run opencode auth login and sign in again.`,
            })
          } else {
            await context.ui.dialog.alert({
              title: account.email,
              message: `${outcome.status}: ${outcome.message}`,
            })
          }
        } catch (error: unknown) {
          toastRpcFailure(error)
        }
        await openActions(account)
        return
      }
      if (action === "remove") {
        const confirmed = await context.ui.dialog.confirm({
          title: `Remove ${account.email}?`,
          message: "Saved tokens for this account will be deleted.",
          label: { confirm: "Remove", cancel: "Cancel" },
        })
        if (!confirmed) {
          await openActions(account)
          return
        }
        try {
          const outcome = await context.client.rpc(AntigravityAccounts).mutate({ id: account.id, op: "delete" }, {
            location: rpcLocation(context),
          }) as MutateOutcome
          if (isStaleMutate(outcome)) {
            await toastStaleAccount()
            await openList()
            return
          }
          context.ui.toast.show({
            title: "Antigravity accounts",
            message: `${account.email} removed.`,
            variant: "success",
          })
        } catch (error: unknown) {
          toastRpcFailure(error)
        }
        await openList()
        return
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
            id: "antigravity.accounts",
            title: "Antigravity accounts",
            palette: true,
            slash: { name: "antigravity" },
            run: async () => {
              await openList()
            },
          }],
        }))
        return null
      },
    })
    return unregisterCommands
  },
})
