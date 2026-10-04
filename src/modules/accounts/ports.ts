/** Transaction result returned by an account-state update. */
export interface AccountStateUpdate<State, Result> {
  state: State
  result: Result
}

/** Persistence operations required by account policy, without filesystem details. */
export interface AccountPersistencePort<State> {
  load(): Promise<State | null>
  transact<Result>(update: (state: State) => Promise<AccountStateUpdate<State, Result>>): Promise<Result>
  /** Replaces storage under its transaction boundary without loading its current value. */
  replace(state: State): Promise<void>
}

/** Credential refresh operation required by account lifecycle policy. */
export interface AccountCredentialRefreshPort<Credential, RefreshedCredential = Credential> {
  refresh(credential: Credential): Promise<RefreshedCredential>
}

/** Project discovery required by OAuth account setup. */
export interface AccountOAuthProjectDiscoveryPort<Credential, Result> {
  discover(credential: Credential): Promise<Result>
}

/** Result from one provider onboarding attempt. */
export type AccountManagedProjectOnboardingAttempt =
  { kind: "complete"; projectId: string } | { kind: "pending" } | { kind: "endpoint-unavailable" }

/** Stateful endpoint cursor with no retry timing or delay policy. */
export interface AccountManagedProjectOnboardingSession {
  attempt(): Promise<AccountManagedProjectOnboardingAttempt>
  nextEndpoint(): boolean
}

/** Managed-project transport needed by account project-context policy. */
export interface AccountManagedProjectPort<LoadInput, Discovery, OnboardInput> {
  load(input: LoadInput): Promise<Discovery | null>
  startOnboarding(input: OnboardInput): AccountManagedProjectOnboardingSession
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
