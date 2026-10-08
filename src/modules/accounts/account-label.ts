/** Formats an account label for account-facing diagnostics. */
export function formatAccountLabel(email: string | undefined, accountIndex: number): string {
  return email || `Account ${accountIndex + 1}`
}

/** Formats a selected account or the all-accounts context for diagnostics. */
export function formatAccountContextLabel(email: string | undefined, accountIndex: number): string {
  if (email) {
    return email
  }
  if (accountIndex >= 0) {
    return `Account ${accountIndex + 1}`
  }
  return "All accounts"
}
