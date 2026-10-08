/** Classification used when assigning an account cooldown after a request failure. */
export type RateLimitReason =
  "QUOTA_EXHAUSTED" | "RATE_LIMIT_EXCEEDED" | "MODEL_CAPACITY_EXHAUSTED" | "SERVER_ERROR" | "UNKNOWN"

const QUOTA_EXHAUSTED_BACKOFFS = [60_000, 300_000, 1_800_000, 7_200_000] as const
const RATE_LIMIT_EXCEEDED_BACKOFF = 30_000
const MODEL_CAPACITY_EXHAUSTED_BASE_BACKOFF = 45_000
const MODEL_CAPACITY_EXHAUSTED_JITTER_MAX = 30_000
const SERVER_ERROR_BACKOFF = 20_000
const UNKNOWN_BACKOFF = 60_000
const MIN_BACKOFF_MS = 2_000

/** Classifies provider failure details using the existing status/reason/message precedence. */
export function parseRateLimitReason(
  reason: string | undefined,
  message: string | undefined,
  status?: number,
): RateLimitReason {
  if (status === 529 || status === 503) return "MODEL_CAPACITY_EXHAUSTED"
  if (status === 500) return "SERVER_ERROR"

  if (reason) {
    switch (reason.toUpperCase()) {
      case "QUOTA_EXHAUSTED":
        return "QUOTA_EXHAUSTED"
      case "RATE_LIMIT_EXCEEDED":
        return "RATE_LIMIT_EXCEEDED"
      case "MODEL_CAPACITY_EXHAUSTED":
        return "MODEL_CAPACITY_EXHAUSTED"
    }
  }

  if (message) {
    const lower = message.toLowerCase()
    if (lower.includes("capacity") || lower.includes("overloaded") || lower.includes("resource exhausted")) {
      return "MODEL_CAPACITY_EXHAUSTED"
    }
    if (
      lower.includes("per minute") ||
      lower.includes("rate limit") ||
      lower.includes("too many requests") ||
      lower.includes("presque")
    ) {
      return "RATE_LIMIT_EXCEEDED"
    }
    if (lower.includes("exhausted") || lower.includes("quota")) {
      return "QUOTA_EXHAUSTED"
    }
  }

  return "UNKNOWN"
}

/** Chooses an account cooldown while respecting provider retry hints and bounded jitter. */
export function calculateBackoffMs(
  reason: RateLimitReason,
  consecutiveFailures: number,
  retryAfterMs?: number | null,
  random: () => number = Math.random,
): number {
  if (retryAfterMs && retryAfterMs > 0) {
    return Math.max(retryAfterMs, MIN_BACKOFF_MS)
  }

  switch (reason) {
    case "QUOTA_EXHAUSTED": {
      const index = Math.min(consecutiveFailures, QUOTA_EXHAUSTED_BACKOFFS.length - 1)
      return QUOTA_EXHAUSTED_BACKOFFS[index] ?? UNKNOWN_BACKOFF
    }
    case "RATE_LIMIT_EXCEEDED":
      return RATE_LIMIT_EXCEEDED_BACKOFF
    case "MODEL_CAPACITY_EXHAUSTED":
      return (
        MODEL_CAPACITY_EXHAUSTED_BASE_BACKOFF +
        random() * MODEL_CAPACITY_EXHAUSTED_JITTER_MAX -
        MODEL_CAPACITY_EXHAUSTED_JITTER_MAX / 2
      )
    case "SERVER_ERROR":
      return SERVER_ERROR_BACKOFF
    case "UNKNOWN":
    default:
      return UNKNOWN_BACKOFF
  }
}
