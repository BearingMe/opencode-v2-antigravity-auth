/** Provider-independent access-verification outcome used by account policy. */
export interface AccountAccessVerificationResult {
  status: "ok" | "blocked" | "error"
  message: string
  verifyUrl?: string
}
