const MILLISECONDS_PER_MINUTE = 60_000
const MILLISECONDS_PER_HOUR = 60 * MILLISECONDS_PER_MINUTE
const MILLISECONDS_PER_DAY = 24 * MILLISECONDS_PER_HOUR
const FULL_BLOCK = "█"
const EMPTY_BLOCK = "░"

/** Splits a non-negative elapsed duration into whole days, hours, and minutes. */
export function splitDuration(durationMs: number): { days: number; hours: number; minutes: number } {
  const days = Math.floor(durationMs / MILLISECONDS_PER_DAY)
  const hours = Math.floor((durationMs % MILLISECONDS_PER_DAY) / MILLISECONDS_PER_HOUR)
  const minutes = Math.floor((durationMs % MILLISECONDS_PER_HOUR) / MILLISECONDS_PER_MINUTE)
  return { days, hours, minutes }
}

/** Formats a fraction as a percentage, or returns undefined when it is invalid. */
export function formatPercentage(fraction: number | null | undefined, decimalPlaces = 0): string | undefined {
  if (
    typeof fraction !== "number" ||
    !Number.isFinite(fraction) ||
    fraction < 0 ||
    fraction > 1 ||
    !Number.isInteger(decimalPlaces) ||
    decimalPlaces < 0 ||
    decimalPlaces > 100
  ) {
    return undefined
  }

  const percentage = fraction * 100
  return decimalPlaces === 0 ? `${Math.round(percentage)}%` : `${percentage.toFixed(decimalPlaces)}%`
}

/** Formats a fractional progress bar and its percentage for compact displays. */
export function formatProgressBarParts(
  fraction: number | null | undefined,
  width = 12,
): { bar: string; percentage: string } {
  const safeWidth = Number.isInteger(width) && width > 0 ? width : 12
  const percentage = formatPercentage(fraction)
  if (percentage === undefined) return { bar: EMPTY_BLOCK.repeat(safeWidth), percentage: "unknown" }

  const filled = Math.round((fraction as number) * safeWidth)
  const empty = safeWidth - filled
  return { bar: `${FULL_BLOCK.repeat(filled)}${EMPTY_BLOCK.repeat(empty)}`, percentage }
}

/** Formats an elapsed duration using the compact units used for retry waits. */
export function formatDuration(durationMs: number): string {
  if (durationMs < 1000) return `${durationMs}ms`

  const seconds = Math.ceil(durationMs / 1000)
  if (seconds < 60) return `${seconds}s`

  const minutes = Math.floor(seconds / 60)
  const remainingSeconds = seconds % 60
  if (minutes < 60) {
    return remainingSeconds > 0 ? `${minutes}m ${remainingSeconds}s` : `${minutes}m`
  }

  const hours = Math.floor(minutes / 60)
  const remainingMinutes = minutes % 60
  return remainingMinutes > 0 ? `${hours}h ${remainingMinutes}m` : `${hours}h`
}
