export interface AccountOneLinerInput {
  email: string
  enabled?: boolean
  active?: boolean
  verificationRequired?: boolean
  coolingDown?: boolean
  status?: string
  selectedByFamily?: { claude: boolean; gemini: boolean }
}

const FULL_BLOCK = "█"
const EMPTY_BLOCK = "░"

function isUsableFraction(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1
}

export function renderQuotaBar(fraction: number | null | undefined, width = 12): string {
  const safeWidth = Number.isInteger(width) && width > 0 ? Math.min(width, 40) : 12
  if (!isUsableFraction(fraction)) return `${EMPTY_BLOCK.repeat(safeWidth)} unknown`
  const filled = Math.round(fraction * safeWidth)
  const empty = safeWidth - filled
  const pct = Math.round(fraction * 100)
  return `${FULL_BLOCK.repeat(filled)}${EMPTY_BLOCK.repeat(empty)} ${pct}%`
}

export function formatResetCountdown(resetTime: number | null | undefined, now: number = Date.now()): string {
  if (typeof resetTime !== "number" || !Number.isFinite(resetTime)) return "reset unknown"
  const diff = resetTime - now
  if (diff <= 0) return "resetting now"
  const hours = Math.floor(diff / 3_600_000)
  const minutes = Math.floor((diff % 3_600_000) / 60_000)
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
