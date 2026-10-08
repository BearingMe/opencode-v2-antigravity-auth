import { accessTokenExpired } from "./credentials.js"
import type { AccountOAuthCredential } from "./policy.js"

const authCache = new Map<string, AccountOAuthCredential>()

/** Produces a stable cache key from a refresh token string. */
function normalizeRefreshKey(refresh?: string): string | undefined {
  const key = refresh?.trim()
  return key ? key : undefined
}

/** Returns a cached auth snapshot when it is newer than the supplied expired snapshot. */
export function resolveCachedAuth(auth: AccountOAuthCredential): AccountOAuthCredential {
  const key = normalizeRefreshKey(auth.refresh)
  if (!key) return auth

  const cached = authCache.get(key)
  if (!cached) {
    authCache.set(key, auth)
    return auth
  }

  if (!accessTokenExpired(auth)) {
    authCache.set(key, auth)
    return auth
  }

  if (!accessTokenExpired(cached)) return cached

  authCache.set(key, auth)
  return auth
}

/** Stores the latest auth snapshot keyed by refresh token. */
export function storeCachedAuth(auth: AccountOAuthCredential): void {
  const key = normalizeRefreshKey(auth.refresh)
  if (key) authCache.set(key, auth)
}

/** Clears the cached auth snapshots globally or for one refresh token. */
export function clearCachedAuth(refresh?: string): void {
  if (!refresh) {
    authCache.clear()
    return
  }

  const key = normalizeRefreshKey(refresh)
  if (key) authCache.delete(key)
}
