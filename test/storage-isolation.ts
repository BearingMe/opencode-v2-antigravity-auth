import { mkdtempSync, mkdirSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterAll } from "vitest"

// Mocks can stop matching after a module move. A real storage call in a test
// must still be unable to delete the user's saved accounts.
const root = mkdtempSync(join(tmpdir(), "antigravity-test-storage-"))
const previous = {
  OPENCODE_CONFIG_DIR: process.env.OPENCODE_CONFIG_DIR,
  XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME,
  APPDATA: process.env.APPDATA,
}

process.env.OPENCODE_CONFIG_DIR = join(root, "opencode")
process.env.XDG_CONFIG_HOME = join(root, "xdg")
process.env.APPDATA = join(root, "appdata")
for (const path of Object.values({
  config: process.env.OPENCODE_CONFIG_DIR,
  xdg: process.env.XDG_CONFIG_HOME,
  appdata: process.env.APPDATA,
})) {
  mkdirSync(path, { recursive: true })
}

afterAll(() => {
  for (const [key, value] of Object.entries(previous)) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
  rmSync(root, { recursive: true, force: true })
})
