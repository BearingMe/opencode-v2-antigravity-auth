import { getAntigravityVersion, setAntigravityVersion } from "./constants.js"
import type { Logger } from "../../platform/logging/index.js"

const VERSION_URL = "https://antigravity-auto-updater-974169037036.us-central1.run.app"
const CHANGELOG_URL = "https://antigravity.google/changelog"
const FETCH_TIMEOUT_MS = 5000
const CHANGELOG_SCAN_CHARS = 5000
const VERSION_REGEX = /\d+\.\d+\.\d+/

type VersionSource = "api" | "changelog" | "fallback"

/** Extracts the first semantic-version triple from provider text. */
function parseVersion(text: string): string | null {
  const match = text.match(VERSION_REGEX)
  return match ? match[0] : null
}

/** Fetches a version source, returning null when the endpoint is unavailable. */
async function tryFetchVersion(url: string, maxChars?: number): Promise<string | null> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  try {
    const response = await fetch(url, { signal: controller.signal })
    if (!response.ok) return null
    let text = await response.text()
    if (maxChars) text = text.slice(0, maxChars)
    return parseVersion(text)
  } catch {
    return null
  } finally {
    clearTimeout(timeout)
  }
}

/** Version refresh operation bound to a host-owned logging destination. */
export interface AntigravityVersionService {
  initAntigravityVersion(): Promise<void>
}

/** Creates version discovery with logging supplied by the application adapter. */
export function createAntigravityVersionService(logger: Pick<Logger, "debug" | "info">): AntigravityVersionService {
  /** Fetches the latest version and updates shared Antigravity request metadata. */
  async function initAntigravityVersion(): Promise<void> {
    const fallback = getAntigravityVersion()
    let version: string | null
    let source: VersionSource

    // 1. Try auto-updater API
    version = await tryFetchVersion(VERSION_URL)
    if (version) {
      source = "api"
    } else {
      // 2. Try changelog page scrape
      version = await tryFetchVersion(CHANGELOG_URL, CHANGELOG_SCAN_CHARS)
      if (version) {
        source = "changelog"
      } else {
        // 3. Fall back to hardcoded
        source = "fallback"
        setAntigravityVersion(fallback)
        logger.info("version-fetch-failed", { fallback })
        return
      }
    }

    if (version !== fallback) {
      logger.info("version-updated", { version, source, previous: fallback })
    } else {
      logger.debug("version-unchanged", { version, source })
    }
    setAntigravityVersion(version)
  }

  return { initAntigravityVersion }
}
