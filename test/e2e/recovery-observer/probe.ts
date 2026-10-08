import { appendFileSync, mkdirSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { Plugin } from "@opencode/plugin"

const CANCELLATION_TEXT = "Operation cancelled by user (ESC pressed)"
const PROBE_ENABLED = process.env.STEP13_RECOVERY_PROBE === "1"
const OUTPUT_PATH = process.env.STEP13_RECOVERY_PROBE_LOG ?? join(tmpdir(), "opencode", "step13-recovery-probe.jsonl")

type ProbeStage = "before" | "after"
let writeFailureReported = false

/** Appends one sanitized observer record for inspection after the host exits. */
function writeProbeRecord(record: Record<string, unknown>) {
  try {
    mkdirSync(dirname(OUTPUT_PATH), { recursive: true })
    appendFileSync(OUTPUT_PATH, `${JSON.stringify({ timestamp: new Date().toISOString(), ...record })}\n`, "utf8")
  } catch (error) {
    if (writeFailureReported) return
    writeFailureReported = true
    console.error("[step13-recovery-probe] Could not write observer record", error)
  }
}

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
      if (!PROBE_ENABLED) return
      writeProbeRecord({ kind: "loaded", stage, outputPath: OUTPUT_PATH })

      await ctx.session.hook("context", (event) => {
        let latestCallIDs: string[] = []
        const results: Array<{ id: string; canonicalCancellation: boolean }> = []

        for (const message of event.messages) {
          const messageCallIDs: string[] = []
          for (const part of message.content) {
            if (part.type === "tool-call") {
              messageCallIDs.push(part.id)
              continue
            }

            if (part.type !== "tool-result") continue
            const result = part.result
            const value = result && typeof result === "object" && "value" in result ? result.value : undefined
            results.push({ id: part.id, canonicalCancellation: value === CANCELLATION_TEXT })
          }
          if (messageCallIDs.length > 0) latestCallIDs = messageCallIDs
        }

        if (latestCallIDs.length === 0) return
        const uniqueCallIDs = [...new Set(latestCallIDs)]
        const record = {
          kind: "context",
          stage,
          sessionID: event.sessionID,
          calls: uniqueCallIDs.map((id) => ({
            id,
            callCount: latestCallIDs.filter((callID) => callID === id).length,
            resultCount: results.filter((result) => result.id === id).length,
            canonicalCancellation: results.some((result) => result.id === id && result.canonicalCancellation),
          })),
        }
        writeProbeRecord(record)
        console.log("[step13-recovery-probe]", JSON.stringify(record))
      })
    },
  })
}
