import { Plugin } from "@opencode/plugin"

const CANCELLATION_TEXT = "Operation cancelled by user (ESC pressed)"

type ProbeStage = "before" | "after"

/**
 * Creates a read-only session hook that reports tool-call/result counts.
 *
 * @example createRecoveryProbe("before")
 */
export function createRecoveryProbe(stage: ProbeStage) {
  return Plugin.define({
    id: `step13-recovery-probe-${stage}`,
    /** Registers a read-only observer for the outgoing session context. */
    async setup(ctx) {
      await ctx.session.hook("context", (event) => {
        const callIDs: string[] = []
        const results: Array<{ id: string; canonicalCancellation: boolean }> = []

        for (const message of event.messages) {
          for (const part of message.content) {
            if (part.type === "tool-call") {
              callIDs.push(part.id)
              continue
            }

            if (part.type !== "tool-result") continue
            const result = part.result
            const value = result && typeof result === "object" && "value" in result ? result.value : undefined
            results.push({ id: part.id, canonicalCancellation: value === CANCELLATION_TEXT })
          }
        }

        const uniqueCallIDs = [...new Set(callIDs)]
        console.log(
          "[step13-recovery-probe]",
          JSON.stringify({
            stage,
            sessionID: event.sessionID,
            calls: uniqueCallIDs.map((id) => ({
              id,
              callCount: callIDs.filter((callID) => callID === id).length,
              resultCount: results.filter((result) => result.id === id).length,
              canonicalCancellation: results.some((result) => result.id === id && result.canonicalCancellation),
            })),
          }),
        )
      })
    },
  })
}
