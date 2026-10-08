/** Configuration and environment inputs used to derive the debug destinations. */
export interface DebugPolicyInput {
  configDebug: boolean
  configDebugTui: boolean
  envDebugFlag?: string
  envDebugTuiFlag?: string
}

/** Effective verbosity and independent file/TUI debug destinations. */
export interface DebugPolicy {
  debugLevel: number
  debugEnabled: boolean
  debugTuiEnabled: boolean
  verboseEnabled: boolean
}

/** Recognizes the supported boolean environment flag spellings. */
export function isTruthyFlag(flag?: string): boolean {
  return flag === "1" || flag?.toLowerCase() === "true"
}

/** Parses the file-debug environment value into its supported verbosity level. */
export function parseDebugLevel(flag: string): number {
  const trimmed = flag.trim()
  if (trimmed === "2" || trimmed === "verbose") return 2
  if (trimmed === "1" || trimmed === "true") return 1
  return 0
}

/** Derives file verbosity and the independent TUI debug setting. */
export function deriveDebugPolicy(input: DebugPolicyInput): DebugPolicy {
  const envDebugFlag = input.envDebugFlag ?? ""
  const debugLevel = input.configDebug
    ? envDebugFlag === "2" || envDebugFlag === "verbose"
      ? 2
      : 1
    : parseDebugLevel(envDebugFlag)
  const debugEnabled = debugLevel >= 1
  const verboseEnabled = debugLevel >= 2
  const debugTuiEnabled = input.configDebugTui || isTruthyFlag(input.envDebugTuiFlag)

  return {
    debugLevel,
    debugEnabled,
    debugTuiEnabled,
    verboseEnabled,
  }
}
