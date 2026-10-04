import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs"
import { promises as fs } from "node:fs"
import { join } from "node:path"

/** Files/directories that must stay out of config-directory checkouts. */
export const GITIGNORE_ENTRIES = [
  ".gitignore",
  "antigravity-accounts.json",
  "antigravity-accounts.json.*.tmp",
  "antigravity-signature-cache.json",
  "antigravity-logs/",
]

/** Outcome of best-effort .gitignore maintenance, including entries newly added. */
export type GitignoreUpdate = { status: "created" | "unchanged" | "failed" } | { status: "updated"; added: string[] }

/** Adds the plugin's private-state entries to a config directory asynchronously. */
export async function ensureGitignore(configDir: string): Promise<GitignoreUpdate> {
  const gitignorePath = join(configDir, ".gitignore")

  try {
    let content: string
    let existingLines: string[] = []
    try {
      content = await fs.readFile(gitignorePath, "utf-8")
      existingLines = content.split("\n").map((line) => line.trim())
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") return { status: "failed" }
      content = ""
    }

    const missingEntries = GITIGNORE_ENTRIES.filter((entry) => !existingLines.includes(entry))
    if (missingEntries.length === 0) return { status: "unchanged" }

    if (content === "") {
      await fs.writeFile(gitignorePath, `${missingEntries.join("\n")}\n`, "utf-8")
      return { status: "created" }
    }

    const suffix = content.endsWith("\n") ? "" : "\n"
    await fs.appendFile(gitignorePath, `${suffix}${missingEntries.join("\n")}\n`, "utf-8")
    return { status: "updated", added: missingEntries }
  } catch {
    return { status: "failed" }
  }
}

/** Adds the plugin's private-state entries to a config directory synchronously. */
export function ensureGitignoreSync(configDir: string): GitignoreUpdate {
  const gitignorePath = join(configDir, ".gitignore")

  try {
    let content: string
    let existingLines: string[] = []
    if (existsSync(gitignorePath)) {
      content = readFileSync(gitignorePath, "utf-8")
      existingLines = content.split("\n").map((line) => line.trim())
    } else {
      content = ""
    }

    const missingEntries = GITIGNORE_ENTRIES.filter((entry) => !existingLines.includes(entry))
    if (missingEntries.length === 0) return { status: "unchanged" }

    if (content === "") {
      writeFileSync(gitignorePath, `${missingEntries.join("\n")}\n`, "utf-8")
      return { status: "created" }
    }

    const suffix = content.endsWith("\n") ? "" : "\n"
    appendFileSync(gitignorePath, `${suffix}${missingEntries.join("\n")}\n`, "utf-8")
    return { status: "updated", added: missingEntries }
  } catch {
    return { status: "failed" }
  }
}
