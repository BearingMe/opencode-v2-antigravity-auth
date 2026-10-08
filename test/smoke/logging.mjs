import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const temporaryRoot = mkdtempSync(join(tmpdir(), "antigravity-built-logging-"))
const previousAppData = process.env.APPDATA
const previousXdgConfig = process.env.XDG_CONFIG_HOME
let disposeDebugLog = async () => {}

/** Builds a complete host client whose log calls are captured for the smoke assertions. */
function createSmokeClient(logEvents) {
  return {
    app: { log: async (event) => logEvents.push(event) },
    auth: { set: async () => undefined },
    session: {
      prompt: async () => undefined,
      abort: async () => undefined,
      messages: async () => undefined,
    },
    tui: { showToast: async () => undefined },
  }
}

/** Waits for the built append-stream writer to persist a distinctive log entry. */
async function waitForFileText(filePath, expected) {
  const deadline = Date.now() + 3_000
  while (Date.now() < deadline) {
    try {
      if (readFileSync(filePath, "utf8").includes(expected)) return
    } catch (error) {
      if (error?.code !== "ENOENT") throw error
    }
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error(`Built debug log did not contain: ${expected}`)
}

/** Retries cleanup until closed write streams release their files on Windows. */
async function removeTemporaryRoot() {
  const deadline = Date.now() + 3_000
  while (Date.now() < deadline) {
    try {
      rmSync(temporaryRoot, { recursive: true, force: true })
      return
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 20))
    }
  }
  throw new Error(`Could not remove isolated logging directory: ${temporaryRoot}`)
}

/** Exercises logging through emitted package modules and isolated filesystem/host sinks. */
async function runLoggingSmoke() {
  process.env.APPDATA = temporaryRoot
  process.env.XDG_CONFIG_HOME = temporaryRoot
  const configDir = join(temporaryRoot, "opencode")
  mkdirSync(configDir, { recursive: true })

  const [{ DEFAULT_CONFIG }, debug, logger] = await Promise.all([
    import("../../dist/src/adapters/opencode/config/index.js"),
    import("../../dist/src/adapters/opencode/debug.js"),
    import("../../dist/src/adapters/opencode/logger.js"),
  ])
  disposeDebugLog = debug.disposeDebugLog

  const logsDirectory = join(temporaryRoot, "debug-logs")
  debug.initializeDebug({ ...DEFAULT_CONFIG, debug: true, debug_tui: false, log_dir: logsDirectory })
  const request = debug.startAntigravityDebugRequest({
    originalUrl: "https://example.test/generate",
    resolvedUrl: "https://example.test/generate",
    method: "POST",
    headers: { Authorization: "Bearer smoke-secret" },
    body: "safe request body",
    streaming: false,
  })
  await debug.logResponseBody(request, new Response("safe response body"), 200)
  debug.debugLogToFile("file-destination-smoke")

  const filePath = debug.getLogFilePath()
  assert.ok(filePath, "file debug should expose its isolated output path")
  await waitForFileText(filePath, "file-destination-smoke")
  const fileLog = readFileSync(filePath, "utf8")
  assert.match(fileLog, /Authorization.*\[redacted\]/i)
  assert.doesNotMatch(fileLog, /smoke-secret/)
  assert.match(fileLog, /safe response body/)

  debug.initializeDebug({ ...DEFAULT_CONFIG, debug: false, debug_tui: true })
  assert.equal(debug.getLogFilePath(), undefined, "TUI-only debug must not create a file destination")
  const logEvents = []
  logger.initLogger(createSmokeClient(logEvents))
  logger.createLogger("built-smoke").info("tui-destination-smoke")
  assert.equal(logEvents.length, 1)
  assert.equal(logEvents[0].body.message, "tui-destination-smoke")

  const blockedDirectory = join(temporaryRoot, "not-a-directory")
  writeFileSync(blockedDirectory, "file")
  debug.initializeDebug({ ...DEFAULT_CONFIG, debug: true, log_dir: blockedDirectory })
  assert.doesNotThrow(() => debug.debugLogToFile("unavailable disk remains best effort"))
  await new Promise((resolve) => setTimeout(resolve, 25))
}

let failure
try {
  await runLoggingSmoke()
} catch (error) {
  failure = error
}

try {
  await disposeDebugLog()
} catch (error) {
  failure ??= error
}

if (previousAppData === undefined) delete process.env.APPDATA
else process.env.APPDATA = previousAppData
if (previousXdgConfig === undefined) delete process.env.XDG_CONFIG_HOME
else process.env.XDG_CONFIG_HOME = previousXdgConfig

try {
  await removeTemporaryRoot()
} catch (error) {
  failure ??= error
}

if (failure) throw failure
console.log("Built-package logging smoke passed (file-only, TUI-only, redaction, and write failure).")
