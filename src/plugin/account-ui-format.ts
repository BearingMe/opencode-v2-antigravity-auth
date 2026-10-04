import { formatPercentage, formatProgressBarParts, splitDuration } from "../utils/formatting.js"

export interface AccountOneLinerInput {
  email: string
  enabled?: boolean
  active?: boolean
  verificationRequired?: boolean
  coolingDown?: boolean
  status?: string
  selectedByFamily?: { claude: boolean; gemini: boolean }
}

function isUsableFraction(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1
}

export function renderQuotaBar(fraction: number | null | undefined, width = 12): string {
  const { bar, percentage } = quotaBarParts(fraction, width)
  return `${bar} ${percentage}`
}

export function quotaBarParts(fraction: number | null | undefined, width = 12): { bar: string; percentage: string } {
  return formatProgressBarParts(fraction, width)
}

export function formatResetCountdown(resetTime: number | null | undefined, now: number = Date.now()): string {
  if (typeof resetTime !== "number" || !Number.isFinite(resetTime)) return "reset unknown"
  const diff = resetTime - now
  if (diff <= 0) return "resetting now"
  const { days, hours, minutes } = splitDuration(diff)
  if (days > 0) return `resets in ${days}d ${hours}h`
  if (hours > 0) return `resets in ${hours}h ${minutes}m`
  if (minutes > 0) return `resets in ${minutes}m`
  return "resets in <1m"
}

export function formatAccountOneLiner(account: AccountOneLinerInput): string {
  const email = account.email.trim() === "" ? "Unnamed account" : account.email
  const tags: Array<string> = []
  const selectedByFamily = account.selectedByFamily
  const familySelected = selectedByFamily?.claude === true || selectedByFamily?.gemini === true
  if (account.active === true || familySelected) tags.push("selected")
  if (account.enabled === false) tags.push("disabled")
  if (account.verificationRequired === true) tags.push("verify required")
  if (account.coolingDown === true) tags.push("cooling down")
  if (account.status === "error") tags.push("quota error")
  if (account.status === "unknown") tags.push("quota unknown")
  if (tags.length === 0) return email
  return `${email} [${tags.join("] [")}]`
}

export interface QuotaRowGroup {
  remainingFraction: number | null
  resetTime: number | null
}

export interface QuotaInfoRow {
  title: string
  value: string
  description: string
}

/** Explicit quota windows shown in Antigravity's grouped quota view. */
export type QuotaSummaryWindow = "weekly" | "5h"

/** A normalized quota window ready for rendering. */
export interface QuotaSummaryWindowRow {
  remainingFraction: number | null
  resetTime: number | null
}

/** A grouped Antigravity pool and its two quota windows. */
export interface QuotaSummaryGroupRow {
  displayName: string
  description: string | null
  buckets: Record<QuotaSummaryWindow, QuotaSummaryWindowRow>
}

/** Grouped quota data and its independent cache freshness state. */
export interface QuotaSummarySnapshot {
  groups: Array<QuotaSummaryGroupRow>
  checkedAt: number | null
  freshness: "fresh" | "stale" | "unchecked"
  status: "ok" | "error" | "unknown"
}

/** Formats a quota fraction with the two decimal places used by Antigravity's quota panel. */
export function formatQuotaPercentage(fraction: number | null | undefined): string {
  return formatPercentage(fraction, 2) ?? "unknown"
}

/** Describes whether a quota window is usable now or when its next reset arrives. */
export function formatQuotaWindowStatus(
  fraction: number | null | undefined,
  resetTime: number | null | undefined,
  now: number = Date.now(),
): string {
  if (isUsableFraction(fraction) && fraction >= 1) return "Quota available"
  const countdown = formatResetCountdown(resetTime, now)
  if (countdown === "reset unknown") return isUsableFraction(fraction) ? "Refresh time unknown" : "Quota unknown"
  if (countdown === "resetting now") return "Refreshes now"
  return `Refreshes ${countdown.replace(/^resets /, "")}`
}

const QUOTA_GROUP_KEYS = ["claude", "gemini-pro", "gemini-flash"] as const

const QUOTA_GROUP_LABELS: Record<string, string> = {
  claude: "Claude",
  "gemini-pro": "Gemini Pro",
  "gemini-flash": "Gemini Flash",
}

export function quotaInfoRows(groups: Record<string, QuotaRowGroup>): Array<QuotaInfoRow> {
  return QUOTA_GROUP_KEYS.map((key) => {
    const entry = groups[key] ?? { remainingFraction: null, resetTime: null }
    return {
      title: QUOTA_GROUP_LABELS[key] ?? key,
      value: `quota-row-${key}`,
      description: `${renderQuotaBar(entry.remainingFraction)} (${formatResetCountdown(entry.resetTime)})`,
    }
  })
}

export interface QuotaDetailSnapshot {
  enabled?: boolean
  groups: Record<string, QuotaRowGroup>
  quotaSummary?: QuotaSummarySnapshot
  checkedAt: number | null
  freshness: string
  status: string
}

export type QuotaRefreshOutcome =
  { ok: true; entry: QuotaDetailSnapshot } | { ok: false; reason: "missing" | "failed"; invalidResponse: boolean }

export function quotaDetailLines(snapshot: QuotaDetailSnapshot): Array<string> {
  const checked = snapshot.checkedAt === null ? "never checked" : new Date(snapshot.checkedAt).toLocaleString()
  return [
    ...quotaInfoRows(snapshot.groups).map((row) => `${row.title}: ${row.description}`),
    `status: ${snapshot.status} (${snapshot.freshness}, checked: ${checked})`,
  ]
}
