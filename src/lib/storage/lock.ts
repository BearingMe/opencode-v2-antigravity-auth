import lockfile from "proper-lockfile"
import type { LockOptions } from "proper-lockfile"

/** Options for a scoped file-lock transaction. */
export interface WithFileLockOptions {
  /** Options passed directly to proper-lockfile during acquisition. */
  lockOptions?: LockOptions
  /** Called when releasing the lock fails; callback errors are ignored. */
  onReleaseError?: (error: unknown) => void
}

/**
 * Acquires a lock on an existing file, runs the operation, and releases afterward.
 * Release failures are reported without replacing the operation's result or error.
 */
export async function withFileLock<T>(
  filePath: string,
  operation: () => Promise<T>,
  options: WithFileLockOptions = {},
): Promise<T> {
  let release: (() => Promise<void>) | undefined

  try {
    release = await lockfile.lock(filePath, options.lockOptions)
    return await operation()
  } finally {
    if (release) {
      try {
        await release()
      } catch (error) {
        try {
          options.onReleaseError?.(error)
        } catch {
          // Release reporting must not replace the transaction's result or error.
        }
      }
    }
  }
}
