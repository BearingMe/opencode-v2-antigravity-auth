import { accessTokenExpired } from "./auth"
import type { OAuthAuthDetails } from "./types"
import { configureSignaturePersistence, configureSignatureTextHash } from "../modules/inference/index.js"
import {
  createSignatureCachePersistence,
  hashSignatureText,
  type SignatureCache,
  type SignatureCachePersistence,
} from "../adapters/filesystem/signature-cache-store.js"
import type { SignatureCacheConfig } from "../adapters/opencode/config/index.js"

configureSignatureTextHash(hashSignatureText)

const authCache = new Map<string, OAuthAuthDetails>()

/**
 * Produces a stable cache key from a refresh token string.
 */
function normalizeRefreshKey(refresh?: string): string | undefined {
  const key = refresh?.trim()
  return key ? key : undefined
}

/**
 * Returns a cached auth snapshot when available, favoring unexpired tokens.
 */
export function resolveCachedAuth(auth: OAuthAuthDetails): OAuthAuthDetails {
  const key = normalizeRefreshKey(auth.refresh)
  if (!key) {
    return auth
  }

  const cached = authCache.get(key)
  if (!cached) {
    authCache.set(key, auth)
    return auth
  }

  if (!accessTokenExpired(auth)) {
    authCache.set(key, auth)
    return auth
  }

  if (!accessTokenExpired(cached)) {
    return cached
  }

  authCache.set(key, auth)
  return auth
}

/**
 * Stores the latest auth snapshot keyed by refresh token.
 */
export function storeCachedAuth(auth: OAuthAuthDetails): void {
  const key = normalizeRefreshKey(auth.refresh)
  if (!key) {
    return
  }
  authCache.set(key, auth)
}

/**
 * Clears cached auth globally or for a specific refresh token.
 */
export function clearCachedAuth(refresh?: string): void {
  if (!refresh) {
    authCache.clear()
    return
  }
  const key = normalizeRefreshKey(refresh)
  if (key) {
    authCache.delete(key)
  }
}

// Attach the disk tier here; signature lookup and retention policy stay in inference.
let signaturePersistence: SignatureCachePersistence | null = null

/** Initializes the filesystem persistence tier when thinking signatures are enabled. */
export function initDiskSignatureCache(config: SignatureCacheConfig | undefined): SignatureCache | null {
  if (signaturePersistence) void signaturePersistence.dispose()
  signaturePersistence = createSignatureCachePersistence(config)
  configureSignaturePersistence(signaturePersistence ?? undefined)
  return signaturePersistence?.cache ?? null
}

/** Detaches and flushes the configured disk persistence tier. */
export async function disposeDiskSignatureCache(): Promise<void> {
  const current = signaturePersistence
  signaturePersistence = null
  configureSignaturePersistence(undefined)
  await current?.dispose()
}
