/** Transaction result returned by an account-state update. */
export interface AccountStateUpdate<State, Result> {
  state: State
  result: Result
}

/** Persistence operations required by account policy, without filesystem details. */
export interface AccountPersistencePort<State> {
  load(): Promise<State | null>
  transact<Result>(update: (state: State) => Promise<AccountStateUpdate<State, Result>>): Promise<Result>
}

/** Credential refresh operation required by account lifecycle policy. */
export interface AccountCredentialRefreshPort<Credential> {
  refresh(credential: Credential): Promise<Credential>
}

/** Quota probe required by account quota policy. */
export interface AccountQuotaProbePort<Account, Result> {
  check(account: Account): Promise<Result>
}

/** Access verification required by account verification policy. */
export interface AccountAccessVerificationPort<Account, Result> {
  verify(account: Account): Promise<Result>
}

/** Clock dependency for deterministic account selection and lifecycle policy. */
export interface AccountClockPort {
  now(): number
}
