import { configureSignaturePersistence, configureSignatureTextHash } from "../../modules/inference/index.js"
import {
  createSignatureCachePersistence,
  hashSignatureText,
  type SignatureCache,
  type SignatureCachePersistence,
} from "../filesystem/signature-cache-store.js"
import type { SignatureCacheConfig } from "./config/index.js"

configureSignatureTextHash(hashSignatureText)

let signaturePersistence: SignatureCachePersistence | null = null

/** Initializes filesystem persistence when thinking signatures are enabled. */
export function initDiskSignatureCache(config: SignatureCacheConfig | undefined): SignatureCache | null {
  if (signaturePersistence) void signaturePersistence.dispose()
  signaturePersistence = createSignatureCachePersistence(config)
  configureSignaturePersistence(signaturePersistence ?? undefined)
  return signaturePersistence?.cache ?? null
}

/** Detaches and flushes the configured signature persistence tier. */
export async function disposeDiskSignatureCache(): Promise<void> {
  const current = signaturePersistence
  signaturePersistence = null
  configureSignaturePersistence(undefined)
  await current?.dispose()
}
