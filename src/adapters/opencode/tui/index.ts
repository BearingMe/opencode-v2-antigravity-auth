import { Plugin } from "@opencode/plugin/tui"
import { AntigravityAccounts } from "../rpc.js"
import { formatAccountOneLiner } from "./account-ui-format.js"
import type { QuotaRefreshOutcome, QuotaSummarySnapshot } from "./account-ui-format.js"
import { MissingAccountDialogView, QuotaDialogView } from "./quota-dialog.js"
import { createQuotaDialogController } from "./quota-controller.js"
import { AccountListDialogView } from "./account-list-dialog.js"
import { DIALOG_SIZE } from "./dialog-shell.js"

type AccountAction = "show-quota" | "toggle-enabled" | "verify" | "remove" | "back"

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
  quotaSummary?: QuotaSummarySnapshot
  checkedAt: number | null
  freshness: "fresh" | "stale" | "unchecked"
  verificationRequired: boolean
  coolingDown: boolean
  selectedByFamily: { claude: boolean; gemini: boolean }
}

const ADD_ACCOUNTS_HINT = "Add accounts: opencode auth login"
const SERVER_UNAVAILABLE =
  "Antigravity server unavailable. Restart opencode or check the plugin installation, then try again."
const INVALID_RPC_RESPONSE = "Antigravity accounts response invalid. Update the plugin and opencode, then try again."

/** Distinguishes RPC output-schema failures from unavailable-server errors. */
export function isInvalidRpcResponse(error: unknown): boolean {
  if (error instanceof Error) {
    return error.name === "InvalidRequestError" && error.message.includes("Expected JSON value")
  }
  if (typeof error === "object" && error !== null) {
    const record = error as { name?: unknown; message?: unknown; type?: unknown; code?: unknown }
    if (record.type === "rpc.invalid_output" || record.code === "rpc.invalid_output") return true
    return (
      record.name === "InvalidRequestError" &&
      typeof record.message === "string" &&
      record.message.includes("Expected JSON value")
    )
  }
  return false
}

/** The result returned by an account mutation RPC. */
export type MutateOutcome = { op: string; remaining: number } | { ok: false; kind: string; accountCount: number }

/** Identifies mutations rejected because their durable target is stale. */
export function isStaleMutate(outcome: MutateOutcome): boolean {
  return "ok" in outcome
}

/** Uses the active plugin location, falling back to the host's default location. */
function rpcLocation(context: Parameters<Parameters<typeof Plugin.define>[0]["setup"]>[0]) {
  return context.location ?? context.data.location.default()
}

type QuotaFetch =
  | { ok: true; entry: QuotaAccount }
  | { ok: false; reason: "missing" }
  | { ok: false; reason: "failed"; invalidResponse: boolean }

/** Registers account-management commands and disposes their dialogs on unload. */
export const opencodeTuiPlugin = Plugin.define({
  id: "antigravity-accounts-tui",
  /** Registers UI commands and owns their dialog lifecycle. */
  setup(context) {
    let disposed = false
    let closeQuota: (() => void) | undefined
    let closeAccountList: (() => void) | undefined
    let closeMissingAccount: (() => void) | undefined
    /** Shows a generic toast while keeping RPC diagnostics in the host log. */
    const toastFailure = (invalidResponse: boolean) => {
      // Keep the user-visible toast generic: server-side diagnostics
      // (schema rejections) already land in the host log.
      context.ui.toast.show({
        title: "Antigravity accounts",
        message: invalidResponse ? INVALID_RPC_RESPONSE : SERVER_UNAVAILABLE,
        variant: "error",
      })
    }
    /** Maps a caught RPC failure to the appropriate user-facing toast. */
    const toastRpcFailure = (detail: unknown) => {
      toastFailure(isInvalidRpcResponse(detail))
    }
    /** Warns that a durable account id became stale and the list will refresh. */
    const toastStaleAccount = async () => {
      context.ui.toast.show({
        title: "Antigravity accounts",
        message: "That account is no longer saved. The list will refresh.",
        variant: "warning",
      })
    }

    /** Loads the account list and opens the account picker. */
    const openList = async (): Promise<void> => {
      if (disposed) return
      let listing: { accounts: Array<ListAccount> }
      try {
        listing = (await context.client.rpc(AntigravityAccounts).list(
          {},
          {
            location: rpcLocation(context),
          },
        )) as { accounts: Array<ListAccount> }
      } catch (error: unknown) {
        if (!disposed) toastRpcFailure(error)
        return
      }
      if (disposed) return
      if (listing.accounts.length === 0) {
        await context.ui.dialog.alert({
          title: "Antigravity accounts",
          message: `No saved Antigravity accounts.\n${ADD_ACCOUNTS_HINT}`,
        })
        return
      }
      let quotaById = new Map<string, QuotaAccount>()
      try {
        const presentation = (await context.client.rpc(AntigravityAccounts).quota(
          { refresh: false },
          {
            location: rpcLocation(context),
          },
        )) as { accounts: Array<QuotaAccount> }
        quotaById = new Map(presentation.accounts.map((entry) => [entry.id, entry]))
      } catch {
        quotaById = new Map()
      }
      if (disposed) return
      const items = listing.accounts.map((account) => {
        const quota = quotaById.get(account.id)
        const summary = formatAccountOneLiner({
          email: account.email,
          enabled: account.enabled,
          active: account.active,
          verificationRequired: account.verificationRequired,
          coolingDown: quota?.coolingDown ?? false,
          status: quota?.status,
          selectedByFamily: quota?.selectedByFamily,
        })
        return {
          id: account.id,
          email: account.email,
          enabled: account.enabled,
          description: summary.slice(formatAccountOneLiner({ email: account.email }).length).trim(),
        }
      })
      const picked = await new Promise<string | undefined>((resolve) => {
        let settled = false
        /** Settles the picker once and releases its unload closer. */
        const settle = (id: string | undefined) => {
          if (settled) return
          settled = true
          closeAccountList = undefined
          resolve(id)
        }
        /** Resolves the current picker choice and closes its dialog. */
        const choose = (id: string | undefined) => {
          if (settled) return
          settle(id)
          context.ui.dialog.clear()
        }
        /** Toggles an account and reports stale targets without applying local state. */
        const toggle = async (id: string): Promise<boolean> => {
          const target = listing.accounts.find((entry) => entry.id === id)
          if (!target) return false
          try {
            const outcome = (await context.client
              .rpc(AntigravityAccounts)
              .mutate(
                { id: target.id, op: target.enabled ? "disable" : "enable" },
                { location: rpcLocation(context) },
              )) as MutateOutcome
            if (isStaleMutate(outcome)) {
              choose(undefined)
              await toastStaleAccount()
              await openList()
              return false
            }
            target.enabled = !target.enabled
            context.ui.toast.show({
              title: "Antigravity accounts",
              message: `${target.email} ${target.enabled ? "enabled" : "disabled"}.`,
              variant: "success",
            })
            return true
          } catch (error: unknown) {
            toastRpcFailure(error)
            return false
          }
        }
        context.ui.dialog.show(
          () =>
            AccountListDialogView({
              accounts: items,
              choose,
              toggle,
              layer: (input) => context.keymap.layer(input),
              colors: {
                base: context.theme.text.base,
                muted: context.theme.text.muted,
                success: context.theme.text.feedback.success.base,
                error: context.theme.text.feedback.error.base,
                selected: context.theme.background.raised.high,
                inputText: context.theme.text.formfield.focused,
                inputBackground: context.theme.background.formfield.focused,
              },
            }),
          () => settle(undefined),
        )
        if (!settled) closeAccountList = () => choose(undefined)
        context.ui.dialog.set({ size: DIALOG_SIZE })
      })
      if (disposed || picked === undefined) return
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

    /** Fetches a quota snapshot and preserves missing-account versus RPC failures. */
    const fetchQuotaEntry = async (account: ListAccount, refresh: boolean): Promise<QuotaFetch> => {
      try {
        const presentation = (await context.client.rpc(AntigravityAccounts).quota(
          { refresh },
          {
            location: rpcLocation(context),
          },
        )) as { accounts: Array<QuotaAccount> }
        const entry = presentation.accounts.find((item) => item.id === account.id)
        if (!entry) return { ok: false, reason: "missing" }
        return { ok: true, entry }
      } catch (error: unknown) {
        return { ok: false, reason: "failed", invalidResponse: isInvalidRpcResponse(error) }
      }
    }

    /** Acknowledges a missing-account notice before returning to the refreshed list. */
    const showMissingThenList = async (account: ListAccount): Promise<void> => {
      if (disposed) return
      const acknowledged = await new Promise<boolean>((resolve) => {
        let settled = false
        /** Resolves the notice once and clears its close handler. */
        const settle = (value: boolean) => {
          if (settled) return
          settled = true
          closeMissingAccount = undefined
          resolve(value)
        }
        /** Resolves the notice only while it is still active. */
        const acknowledge = () => {
          if (settled || disposed) return
          settle(true)
          context.ui.dialog.clear()
        }
        context.ui.dialog.show(
          () =>
            MissingAccountDialogView({
              email: account.email,
              acknowledge,
              layer: (input) => context.keymap.layer(input),
              colors: { base: context.theme.text.base, muted: context.theme.text.muted },
            }),
          () => settle(false),
        )
        if (!settled)
          closeMissingAccount = () => {
            settle(false)
            context.ui.dialog.clear()
          }
        context.ui.dialog.set({ size: DIALOG_SIZE })
      })
      if (acknowledged && !disposed) await openList()
    }

    /** Opens the quota view and owns its refresh, navigation, and cleanup lifecycle. */
    const openQuota = async (account: ListAccount): Promise<void> => {
      const initial = await fetchQuotaEntry(account, false)
      if (disposed) return
      if (!initial.ok) {
        if (initial.reason === "missing") {
          await showMissingThenList(account)
        } else {
          toastFailure(initial.invalidResponse)
          await openActions(account)
        }
        return
      }
      let navigated = false
      /** Returns to the list at most once and disposes the dialog controller. */
      const goListOnce = async (missing = false): Promise<void> => {
        if (navigated || disposed) return
        navigated = true
        controller.dispose()
        closeQuota = undefined
        context.ui.dialog.clear()
        if (missing) {
          await showMissingThenList(account)
        } else await openList()
      }
      const controller = createQuotaDialogController({
        initial: initial.entry,
        refreshQuota: async (): Promise<QuotaRefreshOutcome> => {
          const refreshed = await fetchQuotaEntry(account, true)
          if (!refreshed.ok) {
            return refreshed.reason === "missing"
              ? { ok: false, reason: "missing", invalidResponse: false }
              : { ok: false, reason: "failed", invalidResponse: refreshed.invalidResponse }
          }
          return { ok: true, entry: refreshed.entry }
        },
        notifyRefreshFailed: (invalidResponse, quotaError) => {
          if (quotaError) {
            context.ui.toast.show({
              title: "Antigravity quota",
              message: "Some quota readings could not be refreshed. Showing available values.",
              variant: "error",
            })
          } else toastFailure(invalidResponse)
        },
        showMissingThenList: () => goListOnce(true),
        goList: goListOnce,
      })
      // Each quota dialog owns its closer by identity. Assign only after the
      // replacement completes: the replaced dialog's onClose runs during show
      // and must clear its own closer without clobbering the replacement.
      // Otherwise overlapping opens lose the cleanup callback and unload
      // leaves the replacement dialog active.
      let quotaCloser: (() => void) | undefined
      quotaCloser = () => {
        navigated = true
        controller.dispose()
        if (closeQuota === quotaCloser) closeQuota = undefined
        context.ui.dialog.clear()
      }
      context.ui.dialog.show(
        () =>
          QuotaDialogView({
            email: account.email,
            enabled: initial.entry.enabled,
            controller,
            colors: {
              base: context.theme.text.base,
              muted: context.theme.text.muted,
              accent: context.theme.hue.accent[200],
              success: context.theme.text.feedback.success.base,
              warning: context.theme.text.feedback.warning.base,
              error: context.theme.text.feedback.error.base,
            },
            shortcuts: (id) => context.keymap.shortcuts(id)[0],
            layer: (input) => context.keymap.layer(input),
          }),
        () => {
          navigated = true
          controller.dispose()
          if (closeQuota === quotaCloser) closeQuota = undefined
          // onClose also runs when another dialog replaces this one. Only the
          // component's explicit Back/Esc commands may reopen our account list.
        },
      )
      closeQuota = quotaCloser
      context.ui.dialog.set({ size: "medium" })
    }

    /** Presents account actions and dispatches the selected operation. */
    const openActions = async (account: ListAccount): Promise<void> => {
      if (disposed) return
      const toggleLabel = account.enabled ? "Disable" : "Enable"
      const action = await context.ui.dialog.select<AccountAction>({
        title: account.email,
        placeholder: ADD_ACCOUNTS_HINT,
        options: [
          { title: "Show quota", value: "show-quota", description: "Refresh on open; ctrl+r to update again" },
          {
            title: toggleLabel,
            value: "toggle-enabled",
            description: account.enabled ? "Disable this account" : "Enable this account",
          },
          { title: "Verify", value: "verify", description: "Check access, show reconnect guidance when blocked" },
          { title: "Remove", value: "remove", description: "Delete this account after confirmation" },
          { title: "Back", value: "back", description: "Return to the account list" },
        ],
      })
      if (disposed) return
      if (action === undefined || action === "back") {
        if (action === "back") await openList()
        return
      }
      if (action === "show-quota") {
        await openQuota(account)
        return
      }
      if (action === "toggle-enabled") {
        try {
          const outcome = (await context.client.rpc(AntigravityAccounts).mutate(
            { id: account.id, op: account.enabled ? "disable" : "enable" },
            {
              location: rpcLocation(context),
            },
          )) as MutateOutcome
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
          const outcome = (await context.client.rpc(AntigravityAccounts).verify(
            { id: account.id },
            {
              location: rpcLocation(context),
            },
          )) as
            | {
                index: number
                email?: string
                checkedAt: number
                status: "ok" | "blocked" | "error"
                message: string
                verifyUrl?: string
              }
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
        if (disposed) return
        if (!confirmed) {
          await openActions(account)
          return
        }
        try {
          const outcome = (await context.client.rpc(AntigravityAccounts).mutate(
            { id: account.id, op: "delete" },
            {
              location: rpcLocation(context),
            },
          )) as MutateOutcome
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

    // App-wide commands need a component owner. Quota shortcuts are owned
    // separately by the mounted modal, not this app-wide layer.
    const unregisterCommands = context.ui.slot({
      append: "app",
      render: () => {
        context.keymap.layer(() => ({
          mode: "global",
          commands: [
            {
              id: "antigravity.accounts",
              title: "Antigravity accounts",
              palette: true,
              slash: { name: "antigravity" },
              run: async () => {
                closeQuota?.()
                closeAccountList?.()
                closeMissingAccount?.()
                await openList()
              },
            },
          ],
        }))
        return null
      },
    })
    return () => {
      disposed = true
      closeQuota?.()
      closeAccountList?.()
      closeMissingAccount?.()
      unregisterCommands()
    }
  },
})
