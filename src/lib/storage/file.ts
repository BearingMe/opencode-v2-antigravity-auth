import { randomBytes } from "node:crypto"
import { promises as fs, readFileSync, unlinkSync, writeFileSync, renameSync } from "node:fs"
import { dirname, join } from "node:path"

/** Options for a file replacement that uses asynchronous filesystem calls. */
export interface ReplaceFileOptions {
  /** File mode applied to the temporary file, when the filesystem supports it. */
  mode?: number
}

/** Options for a synchronous file replacement. */
export interface ReplaceFileSyncOptions {
  /** File mode applied to the temporary file, when the filesystem supports it. */
  mode?: number
  /** Directory for the temporary file; defaults to the destination's directory. */
  temporaryDirectory?: string
  /** Copy the temporary contents if rename fails. The copy itself is not atomic. */
  copyFallback?: boolean
}

/** Replaces a file using a sibling temporary file and propagates write errors. */
export async function replaceFile(filePath: string, content: string, options: ReplaceFileOptions = {}): Promise<void> {
  const temporaryPath = `${filePath}.${randomBytes(6).toString("hex")}.tmp`

  try {
    const writeOptions =
      options.mode === undefined ? { encoding: "utf-8" as const } : { encoding: "utf-8" as const, mode: options.mode }
    await fs.writeFile(temporaryPath, content, writeOptions)
    await fs.rename(temporaryPath, filePath)
  } catch (error) {
    await removeTemporaryFile(temporaryPath)
    throw error
  }
}

/** Replaces a file synchronously, with an optional non-atomic copy fallback. */
export function replaceFileSync(filePath: string, content: string, options: ReplaceFileSyncOptions = {}): void {
  const temporaryDirectory = options.temporaryDirectory ?? dirname(filePath)
  const temporaryPath = join(temporaryDirectory, `${randomBytes(6).toString("hex")}.tmp`)

  try {
    if (options.mode === undefined) {
      writeFileSync(temporaryPath, content, "utf-8")
    } else {
      writeFileSync(temporaryPath, content, { encoding: "utf-8", mode: options.mode })
    }
  } catch (error) {
    removeTemporaryFileSync(temporaryPath)
    throw error
  }

  try {
    renameSync(temporaryPath, filePath)
  } catch (renameError) {
    if (!options.copyFallback) {
      removeTemporaryFileSync(temporaryPath)
      throw renameError
    }

    try {
      if (options.mode === undefined) {
        writeFileSync(filePath, readFileSync(temporaryPath))
      } else {
        writeFileSync(filePath, readFileSync(temporaryPath), { mode: options.mode })
      }
    } catch (error) {
      removeTemporaryFileSync(temporaryPath)
      throw error
    }
    removeTemporaryFileSync(temporaryPath)
  }
}

/** Removes a temporary file after an asynchronous replacement failure. */
async function removeTemporaryFile(filePath: string): Promise<void> {
  try {
    await fs.unlink(filePath)
  } catch {
    // Keep the original replacement error; the temporary file may not exist.
  }
}

/** Removes a temporary file after a synchronous replacement attempt. */
function removeTemporaryFileSync(filePath: string): void {
  try {
    unlinkSync(filePath)
  } catch {
    // Keep the original replacement error; the temporary file may not exist.
  }
}
