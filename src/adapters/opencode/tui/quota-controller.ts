import type { QuotaDetailSnapshot, QuotaRefreshOutcome } from "../../../plugin/account-ui-format.js"

/** Dependencies used by one quota dialog controller. */
export interface QuotaDialogDeps {
  initial: QuotaDetailSnapshot
  refreshQuota: () => Promise<QuotaRefreshOutcome>
  notifyRefreshFailed: (invalidResponse: boolean, quotaError?: boolean) => void
  showMissingThenList: () => Promise<void>
  goList: () => Promise<void>
}

/** State exposed to the mounted quota dialog view. */
export interface QuotaDialogState {
  entry: QuotaDetailSnapshot
  refreshing: boolean
  failed: boolean
}

/** Controller API used by the quota dialog view and host integration. */
export type QuotaDialogController = ReturnType<typeof createQuotaDialogController>

/** Owns one quota dialog's refresh, stale-account, navigation, and disposal state. */
export function createQuotaDialogController(deps: QuotaDialogDeps) {
  let entry = deps.initial
  let refreshing = false
  let failed = false
  let disposed = false
  const listeners = new Set<() => void>()
  /** Notifies mounted views after controller state changes. */
  const emit = () => {
    for (const listener of [...listeners]) listener()
  }
  return {
    snapshot: (): QuotaDialogState => ({ entry, refreshing, failed }),
    subscribe: (listener: () => void): (() => void) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    dispose: () => {
      disposed = true
      listeners.clear()
    },
    refresh: async (): Promise<void> => {
      if (refreshing || disposed || entry.enabled === false) return
      refreshing = true
      failed = false
      emit()
      let result: QuotaRefreshOutcome
      try {
        result = await deps.refreshQuota()
      } catch {
        result = { ok: false, reason: "failed", invalidResponse: false }
      }
      if (disposed) return
      refreshing = false
      if (result.ok) {
        if (result.entry.status === "error") {
          entry = {
            ...entry,
            ...(result.entry.enabled === undefined ? {} : { enabled: result.entry.enabled }),
            ...(result.entry.quotaSummary === undefined ? {} : { quotaSummary: result.entry.quotaSummary }),
          }
          failed = true
          emit()
          deps.notifyRefreshFailed(false, true)
          return
        }
        entry = result.entry
        emit()
        return
      }
      if (result.reason === "missing") {
        await deps.showMissingThenList()
        return
      }
      failed = true
      emit()
      deps.notifyRefreshFailed(result.invalidResponse)
    },
    back: async (): Promise<void> => {
      if (disposed) return
      await deps.goList()
    },
  }
}
