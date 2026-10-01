import type { QuotaDetailSnapshot, QuotaRefreshOutcome } from "./plugin/account-ui-format.js"

export interface QuotaDialogDeps {
  initial: QuotaDetailSnapshot
  refreshQuota: () => Promise<QuotaRefreshOutcome>
  notifyRefreshFailed: (invalidResponse: boolean, quotaError?: boolean) => void
  showMissingThenList: () => Promise<void>
  goList: () => Promise<void>
}

export interface QuotaDialogState {
  entry: QuotaDetailSnapshot
  refreshing: boolean
  failed: boolean
}

export function createQuotaDialogController(deps: QuotaDialogDeps) {
  let entry = deps.initial
  let refreshing = false
  let failed = false
  let disposed = false
  const listeners = new Set<() => void>()
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
          if (result.entry.enabled !== undefined) entry = { ...entry, enabled: result.entry.enabled }
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

export type QuotaDialogController = ReturnType<typeof createQuotaDialogController>
