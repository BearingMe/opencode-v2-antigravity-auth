export interface OAuthAuthDetails {
  type: "oauth";
  refresh: string;
  access?: string;
  expires?: number;
}

export interface ApiKeyAuthDetails {
  type: "api_key";
  key: string;
}

export interface NonOAuthAuthDetails {
  type: string;
  [key: string]: unknown;
}

export type AuthDetails = OAuthAuthDetails | ApiKeyAuthDetails | NonOAuthAuthDetails;

export interface ProviderModel {
  cost?: {
    input: number;
    output: number;
  };
  [key: string]: unknown;
}

export interface Provider {
  models?: Record<string, ProviderModel>;
}

/**
 * Minimal client surface used by the shared engine modules.
 *
 * Structural (not bound to any OpenCode plugin SDK) so both the V2 bridge
 * and unit tests can provide it without the V1 `@opencode-ai/plugin` types.
 */
export interface PluginClient {
  app: {
    log: (input: unknown) => Promise<unknown>;
  };
  auth: {
    set: (input: unknown) => Promise<unknown>;
  };
  session: {
    prompt: (input: unknown) => Promise<unknown>;
    abort: (input: unknown) => Promise<unknown>;
    messages: (input: unknown) => Promise<unknown>;
  };
  tui: {
    showToast: (input: unknown) => Promise<unknown>;
  };
}

export interface RefreshParts {
  refreshToken: string;
  projectId?: string;
  managedProjectId?: string;
}

export interface ProjectContextResult {
  auth: OAuthAuthDetails;
  effectiveProjectId: string;
}
