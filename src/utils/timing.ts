/**
 * Waits for a delay, rejecting with the abort reason when cancelled.
 */
export function sleep(ms: number, signal?: AbortSignal | null): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason instanceof Error ? signal.reason : new Error("Aborted"))
      return
    }

    const timeout = setTimeout(() => {
      cleanup()
      resolve()
    }, ms)

    const onAbort = () => {
      cleanup()
      reject(signal?.reason instanceof Error ? signal.reason : new Error("Aborted"))
    }

    const cleanup = () => {
      clearTimeout(timeout)
      signal?.removeEventListener("abort", onAbort)
    }

    signal?.addEventListener("abort", onAbort, { once: true })
  })
}

/** Adds bounded random variation to a delay. */
export function addJitter(baseMs: number, jitterFactor = 0.3): number {
  const jitterRange = baseMs * jitterFactor
  const jitter = (Math.random() * 2 - 1) * jitterRange
  return Math.max(0, Math.round(baseMs + jitter))
}

/** Returns a rounded random delay between the supplied bounds. */
export function randomDelay(minMs: number, maxMs: number): number {
  return Math.round(minMs + Math.random() * (maxMs - minMs))
}
