/** Writes log arguments through their matching OpenCode console destination. */
export { writeConsoleLog } from "../adapters/opencode/logging.js"
export type { LogLevel } from "../platform/logging/index.js"

/** Formats an account label for debug output. */
export function formatAccountLabel(email: string | undefined, accountIndex: number): string {
  return email || `Account ${accountIndex + 1}`
}

/** Formats a selected account or the all-accounts context for debug output. */
export function formatAccountContextLabel(email: string | undefined, accountIndex: number): string {
  if (email) {
    return email
  }
  if (accountIndex >= 0) {
    return `Account ${accountIndex + 1}`
  }
  return "All accounts"
}
