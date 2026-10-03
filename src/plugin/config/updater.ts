import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs"
import { join, dirname } from "node:path"
import { homedir } from "node:os"
import { OPENCODE_MODEL_DEFINITIONS } from "./models"

// =============================================================================
// Types
// =============================================================================

export interface UpdateConfigResult {
  success: boolean
  configPath: string
  error?: string
}

export interface OpencodeConfig {
  $schema?: string
  plugins?: Array<string | { package: string; options?: Record<string, unknown> }>
  providers?: {
    antigravity?: {
      models?: Record<string, unknown>
      [key: string]: unknown
    }
    [key: string]: unknown
  }
  [key: string]: unknown
}

export interface UpdateConfigOptions {
  configPath?: string
}

// =============================================================================
// Constants
// =============================================================================

const PLUGIN_NAME = "opencode-v2-antigravity-auth@latest"
const SCHEMA_URL = "https://opencode.ai/config.json"
const OPENCODE_JSON_FILENAME = "opencode.json"
const OPENCODE_JSONC_FILENAME = "opencode.jsonc"

function stripJsonCommentsAndTrailingCommas(json: string): string {
  return json
    .replace(/\\"|"(?:\\"|[^"])*"|(\/\/.*|\/\*[\s\S]*?\*\/)/g, (match: string, group: string | undefined) =>
      group ? "" : match,
    )
    .replace(/,(\s*[}\]])/g, "$1")
}

/**
 * Converts the shared model catalog into the shape accepted by V2 config.
 */
function toConfigModels(): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(OPENCODE_MODEL_DEFINITIONS).map(([id, definition]) => [
      id,
      {
        name: definition.name,
        limit: {
          context: definition.limit.context,
          output: definition.limit.output,
        },
        capabilities: {
          tools: true,
          input: definition.modalities.input,
          output: definition.modalities.output,
        },
        variants: Object.entries(definition.variants ?? {}).map(([variantID, settings]) => ({
          id: variantID,
          settings,
        })),
      },
    ]),
  )
}

/**
 * Get the opencode config directory path.
 */
export function getOpencodeConfigDir(): string {
  const xdgConfig = process.env.XDG_CONFIG_HOME || join(homedir(), ".config")
  return join(xdgConfig, "opencode")
}

/**
 * Get the opencode config file path.
 *
 * Prefers opencode.jsonc when present so we update the active config file
 * instead of creating a new opencode.json.
 */
export function getOpencodeConfigPath(): string {
  const configDir = getOpencodeConfigDir()
  const jsoncPath = join(configDir, OPENCODE_JSONC_FILENAME)
  const jsonPath = join(configDir, OPENCODE_JSON_FILENAME)

  if (existsSync(jsoncPath)) {
    return jsoncPath
  }
  if (existsSync(jsonPath)) {
    return jsonPath
  }

  return jsonPath
}

// =============================================================================
// Main Function
// =============================================================================

/**
 * Updates the opencode configuration file with plugin models.
 *
 * This function:
 * 1. Reads existing opencode.json/opencode.jsonc (or creates default structure)
 * 2. Replaces `providers.antigravity.models` with plugin models
 * 3. Writes back to disk with proper formatting
 *
 * Preserves:
 * - $schema and other top-level config keys
 * - Google and other provider sections
 * - Other settings within the Antigravity provider (except models)
 */
export async function updateOpencodeConfig(options: UpdateConfigOptions = {}): Promise<UpdateConfigResult> {
  const configPath = options.configPath ?? getOpencodeConfigPath()

  try {
    let config: OpencodeConfig

    // Read existing config or create default
    if (existsSync(configPath)) {
      const content = readFileSync(configPath, "utf-8")
      config = JSON.parse(stripJsonCommentsAndTrailingCommas(content)) as OpencodeConfig
    } else {
      // Create default config structure
      config = {
        $schema: SCHEMA_URL,
        plugins: [],
        providers: {},
      }
    }

    // Ensure $schema is set
    if (!config.$schema) {
      config.$schema = SCHEMA_URL
    }

    // Ensure plugin array exists and contains our plugin
    if (!Array.isArray(config.plugins)) {
      config.plugins = []
    }

    // Check if plugin is already in the list (any version)
    const hasPlugin = config.plugins.some((plugin) => {
      const packageName = typeof plugin === "string" ? plugin : plugin.package
      return packageName.includes("opencode-v2-antigravity-auth")
    })
    if (!hasPlugin) {
      config.plugins.push(PLUGIN_NAME)
    }

    // Keep Google untouched; Antigravity has its own provider namespace.
    if (!config.providers) {
      config.providers = {}
    }
    if (!config.providers.antigravity) {
      config.providers.antigravity = {}
    }

    config.providers.antigravity.models = toConfigModels()

    // Ensure config directory exists
    const configDir = dirname(configPath)
    if (!existsSync(configDir)) {
      mkdirSync(configDir, { recursive: true })
    }

    // Write config with proper formatting (2-space indent)
    writeFileSync(configPath, JSON.stringify(config, null, 2), "utf-8")

    return {
      success: true,
      configPath,
    }
  } catch (error) {
    return {
      success: false,
      configPath,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}
