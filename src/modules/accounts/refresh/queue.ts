import type { AccountClockPort } from "../ports.js"

/** Settings for proactive token-refresh scheduling. */
export interface ProactiveRefreshConfig {
  enabled: boolean
  bufferSeconds: number
  checkIntervalSeconds: number
}

/** Account data used to decide whether a background refresh is eligible. */
export interface RefreshQueueAccount {
  index: number
  expires?: number
  enabled?: boolean
  email?: string
}

/** Minimal OAuth shape the queue passes to its refresh port. */
export interface RefreshQueueCredential {
  type: "oauth"
  refresh: string
  access?: string
  expires?: number
}

/** Pool operations used by the refresh lifecycle policy. */
export interface RefreshQueueManager<Account extends RefreshQueueAccount, Credential extends RefreshQueueCredential> {
  getAccounts(): Account[]
  toAuthDetails(account: Account): Credential
  updateFromAuth(account: Account, credential: Credential): void
  saveToDisk(): Promise<void>
}

/** Logging boundary used by background refresh decisions. */
export interface RefreshQueueLogger {
  debug(message: string, context?: Record<string, unknown>): void
  warn(message: string, context?: Record<string, unknown>): void
  error(message: string, context?: Record<string, unknown>): void
}

/** Dependencies for account refresh policy without host or provider clients. */
export interface RefreshQueueDependencies<
  Account extends RefreshQueueAccount,
  Credential extends RefreshQueueCredential,
> {
  clock: AccountClockPort
  refresh(credential: Credential, account: Account): Promise<Credential | undefined>
  logger: RefreshQueueLogger
}

/** Default proactive refresh schedule. */
export const DEFAULT_PROACTIVE_REFRESH_CONFIG: ProactiveRefreshConfig = {
  enabled: true,
  bufferSeconds: 1800,
  checkIntervalSeconds: 300,
}

interface RefreshQueueState {
  isRunning: boolean
  intervalHandle: ReturnType<typeof setInterval> | null
  isRefreshing: boolean
  lastCheckTime: number
  lastRefreshTime: number
  refreshCount: number
  errorCount: number
}

/** Schedules serialized proactive refreshes for eligible accounts. */
export class AccountRefreshQueue<Account extends RefreshQueueAccount, Credential extends RefreshQueueCredential> {
  private readonly config: ProactiveRefreshConfig
  private readonly dependencies: RefreshQueueDependencies<Account, Credential>
  private accountManager: RefreshQueueManager<Account, Credential> | null = null
  private state: RefreshQueueState = {
    isRunning: false,
    intervalHandle: null,
    isRefreshing: false,
    lastCheckTime: 0,
    lastRefreshTime: 0,
    refreshCount: 0,
    errorCount: 0,
  }

  /** Creates the queue policy with its scheduler and refresh dependencies. */
  constructor(dependencies: RefreshQueueDependencies<Account, Credential>, config?: Partial<ProactiveRefreshConfig>) {
    this.dependencies = dependencies
    this.config = { ...DEFAULT_PROACTIVE_REFRESH_CONFIG, ...config }
  }

  /** Attaches the current account pool before the queue starts. */
  setAccountManager(manager: RefreshQueueManager<Account, Credential>): void {
    this.accountManager = manager
  }

  /** Reports whether this account expires within the configured refresh buffer. */
  needsRefresh(account: Account): boolean {
    if (!account.expires) return false
    return account.expires <= this.dependencies.clock.now() + this.config.bufferSeconds * 1000
  }

  /** Reports whether the account is already expired and should be refreshed on demand. */
  isExpired(account: Account): boolean {
    return !!account.expires && account.expires <= this.dependencies.clock.now()
  }

  /** Returns enabled, non-expired accounts inside the proactive refresh window. */
  getAccountsNeedingRefresh(): Account[] {
    if (!this.accountManager) return []
    return this.accountManager.getAccounts().filter((account) => {
      if (account.enabled === false || this.isExpired(account)) return false
      return this.needsRefresh(account)
    })
  }

  /** Runs one serialized refresh cycle and persists successful updates. */
  private async runRefreshCheck(): Promise<void> {
    if (this.state.isRefreshing || !this.accountManager) return
    this.state.isRefreshing = true
    this.state.lastCheckTime = this.dependencies.clock.now()

    try {
      const accounts = this.getAccountsNeedingRefresh()
      if (accounts.length === 0) return
      this.dependencies.logger.debug("Found accounts needing refresh", { count: accounts.length })

      for (const account of accounts) {
        if (!this.state.isRunning) break
        try {
          const credential = this.accountManager.toAuthDetails(account)
          const minutesUntilExpiry = account.expires
            ? Math.round((account.expires - this.dependencies.clock.now()) / 60_000)
            : "unknown"
          this.dependencies.logger.debug("Proactively refreshing token", {
            accountIndex: account.index,
            email: account.email ?? "unknown",
            minutesUntilExpiry,
          })
          const refreshed = await this.dependencies.refresh(credential, account)
          if (!refreshed) continue

          this.accountManager.updateFromAuth(account, refreshed)
          this.state.refreshCount += 1
          this.state.lastRefreshTime = this.dependencies.clock.now()
          try {
            await this.accountManager.saveToDisk()
          } catch {
            // In-memory credentials remain usable; a later manager save can retry persistence.
          }
        } catch (error) {
          this.state.errorCount += 1
          this.dependencies.logger.warn("Failed to refresh account", {
            accountIndex: account.index,
            error: error instanceof Error ? error.message : String(error),
          })
        }
      }
    } finally {
      this.state.isRefreshing = false
    }
  }

  /** Starts initial and periodic refresh checks once. */
  start(): void {
    if (this.state.isRunning) return
    if (!this.config.enabled) {
      this.dependencies.logger.debug("Proactive refresh disabled by config")
      return
    }

    this.state.isRunning = true
    const intervalMs = this.config.checkIntervalSeconds * 1000
    this.dependencies.logger.debug("Started proactive refresh queue", {
      checkIntervalSeconds: this.config.checkIntervalSeconds,
      bufferSeconds: this.config.bufferSeconds,
    })

    setTimeout(() => {
      if (!this.state.isRunning) return
      this.runRefreshCheck().catch((error) => {
        this.dependencies.logger.error("Initial check failed", {
          error: error instanceof Error ? error.message : String(error),
        })
      })
    }, 5000)

    this.state.intervalHandle = setInterval(() => {
      this.runRefreshCheck().catch((error) => {
        this.dependencies.logger.error("Check failed", {
          error: error instanceof Error ? error.message : String(error),
        })
      })
    }, intervalMs)
  }

  /** Stops future queue checks; an in-flight refresh finishes its current account. */
  stop(): void {
    if (!this.state.isRunning) return
    this.state.isRunning = false
    if (this.state.intervalHandle) {
      clearInterval(this.state.intervalHandle)
      this.state.intervalHandle = null
    }
    this.dependencies.logger.debug("Stopped proactive refresh queue", {
      refreshCount: this.state.refreshCount,
      errorCount: this.state.errorCount,
    })
  }

  /** Returns counters describing the current queue lifecycle. */
  getStats(): Omit<RefreshQueueState, "intervalHandle"> {
    return { ...this.state }
  }

  /** Reports whether proactive refresh checks are scheduled. */
  isRunning(): boolean {
    return this.state.isRunning
  }
}
