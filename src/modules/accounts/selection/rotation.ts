// ============================================================================
// HEALTH SCORE SYSTEM
// ============================================================================

export interface HealthScoreConfig {
  initial: number

  successReward: number

  rateLimitPenalty: number

  failurePenalty: number

  recoveryRatePerHour: number

  minUsable: number

  maxScore: number
}

export const DEFAULT_HEALTH_SCORE_CONFIG: HealthScoreConfig = {
  initial: 70,
  successReward: 1,
  rateLimitPenalty: -10,
  failurePenalty: -20,
  recoveryRatePerHour: 2,
  minUsable: 50,
  maxScore: 100,
}

interface HealthScoreState {
  score: number
  lastUpdated: number
  lastSuccess: number
  consecutiveFailures: number
}

/**
 * Tracks health scores for accounts.
 * Higher score = healthier account = preferred for selection.
 */
export class HealthScoreTracker {
  private readonly scores = new Map<number, HealthScoreState>()
  private readonly config: HealthScoreConfig

  /** Creates an in-memory health tracker with configurable scoring and clock. */
  constructor(
    config: Partial<HealthScoreConfig> = {},
    private readonly now: () => number = Date.now,
  ) {
    this.config = { ...DEFAULT_HEALTH_SCORE_CONFIG, ...config }
  }

  /**
   * Get current health score for an account, applying time-based recovery.
   */
  getScore(accountIndex: number): number {
    const state = this.scores.get(accountIndex)
    if (!state) {
      return this.config.initial
    }

    // Apply passive recovery based on time since last update
    const elapsedHours = (this.now() - state.lastUpdated) / (1000 * 60 * 60)
    const recoveredPoints = Math.floor(elapsedHours * this.config.recoveryRatePerHour)

    return Math.min(this.config.maxScore, state.score + recoveredPoints)
  }

  /**
   * Record a successful request - improves health score.
   */
  recordSuccess(accountIndex: number): void {
    const now = this.now()
    const current = this.getScore(accountIndex)

    this.scores.set(accountIndex, {
      score: Math.min(this.config.maxScore, current + this.config.successReward),
      lastUpdated: now,
      lastSuccess: now,
      consecutiveFailures: 0,
    })
  }

  /**
   * Record a rate limit hit - moderate penalty.
   */
  recordRateLimit(accountIndex: number): void {
    const now = this.now()
    const state = this.scores.get(accountIndex)
    const current = this.getScore(accountIndex)

    this.scores.set(accountIndex, {
      score: Math.max(0, current + this.config.rateLimitPenalty),
      lastUpdated: now,
      lastSuccess: state?.lastSuccess ?? 0,
      consecutiveFailures: (state?.consecutiveFailures ?? 0) + 1,
    })
  }

  /**
   * Record a failure (auth, network, etc.) - larger penalty.
   */
  recordFailure(accountIndex: number): void {
    const now = this.now()
    const state = this.scores.get(accountIndex)
    const current = this.getScore(accountIndex)

    this.scores.set(accountIndex, {
      score: Math.max(0, current + this.config.failurePenalty),
      lastUpdated: now,
      lastSuccess: state?.lastSuccess ?? 0,
      consecutiveFailures: (state?.consecutiveFailures ?? 0) + 1,
    })
  }

  /**
   * Check if account is healthy enough to use.
   */
  isUsable(accountIndex: number): boolean {
    return this.getScore(accountIndex) >= this.config.minUsable
  }

  /**
   * Get consecutive failure count for an account.
   */
  getConsecutiveFailures(accountIndex: number): number {
    return this.scores.get(accountIndex)?.consecutiveFailures ?? 0
  }

  /**
   * Reset health state for an account (e.g., after removal).
   */
  reset(accountIndex: number): void {
    this.scores.delete(accountIndex)
  }

  /**
   * Get all scores for debugging/logging.
   */
  getSnapshot(): Map<number, { score: number; consecutiveFailures: number }> {
    const result = new Map<number, { score: number; consecutiveFailures: number }>()
    for (const [index] of this.scores) {
      result.set(index, {
        score: this.getScore(index),
        consecutiveFailures: this.getConsecutiveFailures(index),
      })
    }
    return result
  }
}

// ============================================================================
// JITTER UTILITIES
// ============================================================================

/**
 * Add random jitter to a delay value.
 * Helps break predictable timing patterns.
 */
export function addJitter(baseMs: number, jitterFactor: number = 0.3, random: () => number = Math.random): number {
  const jitterRange = baseMs * jitterFactor
  const jitter = (random() * 2 - 1) * jitterRange // -jitterRange to +jitterRange
  return Math.max(0, Math.round(baseMs + jitter))
}

/**
 * Generate a random delay within a range.
 */
export function randomDelay(minMs: number, maxMs: number, random: () => number = Math.random): number {
  return Math.round(minMs + random() * (maxMs - minMs))
}

// ============================================================================
// LRU SELECTION
// ============================================================================

export interface AccountWithMetrics {
  index: number
  lastUsed: number
  healthScore: number
  isRateLimited: boolean
  isCoolingDown: boolean
}

/**
 * Sort accounts by LRU (least recently used first) with health score tiebreaker.
 *
 * Priority:
 * 1. Filter out rate-limited and cooling-down accounts
 * 2. Filter out unhealthy accounts (score < minUsable)
 * 3. Sort by lastUsed ascending (oldest first = most rested)
 * 4. Tiebreaker: higher health score wins
 */
export function sortByLruWithHealth(accounts: AccountWithMetrics[], minHealthScore: number = 50): AccountWithMetrics[] {
  return accounts
    .filter((acc) => !acc.isRateLimited && !acc.isCoolingDown && acc.healthScore >= minHealthScore)
    .sort((a, b) => {
      // Primary: LRU (oldest lastUsed first)
      const lruDiff = a.lastUsed - b.lastUsed
      if (lruDiff !== 0) return lruDiff

      // Tiebreaker: higher health score wins
      return b.healthScore - a.healthScore
    })
}

const STICKINESS_BONUS = 150

const SWITCH_THRESHOLD = 100

/**
 * Select account using hybrid strategy with stickiness:
 * 1. Filter available accounts (not rate-limited, not cooling down, healthy, has tokens)
 * 2. Calculate priority score: health (2x) + tokens (5x) + freshness (0.1x)
 * 3. Apply stickiness bonus to current account
 * 4. Only switch if another account beats current by SWITCH_THRESHOLD
 */
export function selectHybridAccount(
  accounts: AccountWithMetrics[],
  tokenTracker: TokenBucketTracker,
  currentAccountIndex: number | null = null,
  minHealthScore: number = 50,
  now: number = Date.now(),
): number | null {
  const candidates = accounts
    .filter(
      (acc) =>
        !acc.isRateLimited &&
        !acc.isCoolingDown &&
        acc.healthScore >= minHealthScore &&
        tokenTracker.hasTokens(acc.index),
    )
    .map((acc) => ({
      ...acc,
      tokens: tokenTracker.getTokens(acc.index),
    }))

  if (candidates.length === 0) {
    return null
  }

  const maxTokens = tokenTracker.getMaxTokens()
  const scored = candidates
    .map((acc) => {
      const baseScore = calculateHybridScore(acc, maxTokens, now)
      // Apply stickiness bonus to current account
      const stickinessBonus = acc.index === currentAccountIndex ? STICKINESS_BONUS : 0
      return {
        index: acc.index,
        baseScore,
        score: baseScore + stickinessBonus,
        isCurrent: acc.index === currentAccountIndex,
      }
    })
    .sort((a, b) => b.score - a.score)

  const best = scored[0]
  if (!best) {
    return null
  }

  // If current account is still a candidate, check if switch is warranted
  const currentCandidate = scored.find((s) => s.isCurrent)
  if (currentCandidate && !best.isCurrent) {
    // Only switch if best beats current's BASE score by threshold
    // (compare base scores to avoid circular stickiness bonus comparison)
    const advantage = best.baseScore - currentCandidate.baseScore
    if (advantage < SWITCH_THRESHOLD) {
      return currentCandidate.index
    }
  }

  return best.index
}

interface AccountWithTokens extends AccountWithMetrics {
  tokens: number
}

/** Scores one eligible account using health, request budget, and recent use. */
function calculateHybridScore(account: AccountWithTokens, maxTokens: number, now: number): number {
  const healthComponent = account.healthScore * 2 // 0-200
  const tokenComponent = (account.tokens / maxTokens) * 100 * 5 // 0-500
  const secondsSinceUsed = (now - account.lastUsed) / 1000
  const freshnessComponent = Math.min(secondsSinceUsed, 3600) * 0.1 // 0-360
  return Math.max(0, healthComponent + tokenComponent + freshnessComponent)
}

// ============================================================================
// TOKEN BUCKET SYSTEM
// ============================================================================

export interface TokenBucketConfig {
  maxTokens: number

  regenerationRatePerMinute: number

  initialTokens: number
}

export const DEFAULT_TOKEN_BUCKET_CONFIG: TokenBucketConfig = {
  maxTokens: 50,
  regenerationRatePerMinute: 6,
  initialTokens: 50,
}

interface TokenBucketState {
  tokens: number
  lastUpdated: number
}

/**
 * Client-side rate limiting using Token Bucket algorithm.
 * Helps prevent hitting server 429s by tracking "cost" of requests.
 */
export class TokenBucketTracker {
  private readonly buckets = new Map<number, TokenBucketState>()
  private readonly config: TokenBucketConfig

  /** Creates a token-bucket tracker with configurable capacity and clock. */
  constructor(
    config: Partial<TokenBucketConfig> = {},
    private readonly now: () => number = Date.now,
  ) {
    this.config = { ...DEFAULT_TOKEN_BUCKET_CONFIG, ...config }
  }

  /**
   * Get current token balance for an account, applying regeneration.
   */
  getTokens(accountIndex: number): number {
    const state = this.buckets.get(accountIndex)
    if (!state) {
      return this.config.initialTokens
    }

    const elapsedMinutes = (this.now() - state.lastUpdated) / (1000 * 60)
    const recoveredTokens = elapsedMinutes * this.config.regenerationRatePerMinute

    return Math.min(this.config.maxTokens, state.tokens + recoveredTokens)
  }

  /**
   * Check if account has enough tokens for a request.
   */
  hasTokens(accountIndex: number, cost: number = 1): boolean {
    return this.getTokens(accountIndex) >= cost
  }

  /**
   * Consume tokens for a request.
   */
  consume(accountIndex: number, cost: number = 1): boolean {
    const current = this.getTokens(accountIndex)
    if (current < cost) {
      return false
    }

    this.buckets.set(accountIndex, {
      tokens: current - cost,
      lastUpdated: this.now(),
    })
    return true
  }

  /**
   * Refund tokens (e.g., if request wasn't actually sent).
   */
  refund(accountIndex: number, amount: number = 1): void {
    const current = this.getTokens(accountIndex)
    this.buckets.set(accountIndex, {
      tokens: Math.min(this.config.maxTokens, current + amount),
      lastUpdated: this.now(),
    })
  }

  /** Returns the configured token ceiling used to normalize hybrid scores. */
  getMaxTokens(): number {
    return this.config.maxTokens
  }
}

// ============================================================================
// SINGLETON TRACKERS
// ============================================================================

let globalTokenTracker: TokenBucketTracker | null = null

/** Returns the shared token tracker, initializing default limits on first use. */
export function getTokenTracker(): TokenBucketTracker {
  if (!globalTokenTracker) {
    globalTokenTracker = new TokenBucketTracker()
  }
  return globalTokenTracker
}

/** Replaces the shared token tracker with one configured for the current plugin setup. */
export function initTokenTracker(config: Partial<TokenBucketConfig>): TokenBucketTracker {
  globalTokenTracker = new TokenBucketTracker(config)
  return globalTokenTracker
}

let globalHealthTracker: HealthScoreTracker | null = null

/**
 * Get the global health score tracker instance.
 * Creates one with default config if not initialized.
 */
export function getHealthTracker(): HealthScoreTracker {
  if (!globalHealthTracker) {
    globalHealthTracker = new HealthScoreTracker()
  }
  return globalHealthTracker
}

/**
 * Initialize the global health tracker with custom config.
 * Call this at plugin startup if custom config is needed.
 */
export function initHealthTracker(config: Partial<HealthScoreConfig>): HealthScoreTracker {
  globalHealthTracker = new HealthScoreTracker(config)
  return globalHealthTracker
}
