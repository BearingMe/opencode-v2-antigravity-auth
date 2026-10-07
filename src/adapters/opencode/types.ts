/** Model cost data used while normalizing configured OpenCode models. */
export interface ProviderModel {
  cost?: {
    input: number
    output: number
  }
  [key: string]: unknown
}

/**
 * Minimal client surface used by OpenCode adapter compositions.
 *
 * Structural typing keeps host SDK objects and focused test fixtures at the
 * adapter boundary without leaking SDK types into domain modules.
 */
export interface PluginClient {
  app: {
    log: (input: unknown) => Promise<unknown>
  }
  auth: {
    set: (input: unknown) => Promise<unknown>
  }
  session: {
    prompt: (input: unknown) => Promise<unknown>
    abort: (input: unknown) => Promise<unknown>
    messages: (input: unknown) => Promise<unknown>
  }
  tui: {
    showToast: (input: unknown) => Promise<unknown>
  }
}
