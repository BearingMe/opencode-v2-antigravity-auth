import {
  ANTIGRAVITY_AUTH_USER_AGENT,
  ANTIGRAVITY_ENDPOINT_FALLBACKS,
  ANTIGRAVITY_LOAD_ENDPOINTS,
  getAntigravityHeaders,
} from "./constants.js"
import type {
  AccountManagedProjectOnboardingAttempt,
  AccountManagedProjectOnboardingSession,
  AccountManagedProjectPort,
  AccountOAuthProjectDiscoveryPort,
} from "../../modules/accounts/index.js"
import type { Logger } from "../../platform/logging/index.js"

/** Code Assist response shape retained by the legacy project loader. */
export interface LoadCodeAssistPayload {
  cloudaicompanionProject?: string | { id?: string }
  currentTier?: { id?: string }
  allowedTiers?: Array<{ id?: string; isDefault?: boolean; userDefinedCloudaicompanionProject?: boolean }>
}

/** Parsed project metadata used by the managed-project lifecycle policy. */
export interface ManagedProjectDiscovery {
  payload: LoadCodeAssistPayload
  managedProjectId?: string
  allowedTiers?: Array<{ id?: string; isDefault?: boolean }>
}

/** Inputs for loading a managed project through the account transport port. */
export interface ManagedProjectLoadInput {
  accessToken: string
  projectId?: string
  logger?: Pick<Logger, "debug">
}

/** Inputs for onboarding a managed project through the account transport port. */
export interface ManagedProjectOnboardInput {
  accessToken: string
  tierId: string
  projectId?: string
  logger?: Pick<Logger, "debug">
}

interface OnboardUserPayload {
  done?: boolean
  response?: { cloudaicompanionProject?: { id?: string } }
}

const PROJECT_REQUEST_TIMEOUT_MS = 10_000

/** Fetches and parses one project response within the request's timeout scope. */
async function fetchWithTimeout<Result>(
  url: string,
  options: RequestInit,
  parseResponse: (response: Response) => Promise<Result>,
): Promise<Result> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), PROJECT_REQUEST_TIMEOUT_MS)
  try {
    const response = await fetch(url, { ...options, signal: controller.signal })
    return await parseResponse(response)
  } finally {
    clearTimeout(timeout)
  }
}

/** Tries each project-discovery endpoint in the established preference order. */
export async function loadManagedProject(
  accessToken: string,
  projectId?: string,
  logger?: Pick<Logger, "debug">,
): Promise<ManagedProjectDiscovery | null> {
  const metadata: Record<string, string> = {
    ideType: "ANTIGRAVITY",
    platform: process.platform === "win32" ? "WINDOWS" : "MACOS",
    pluginType: "GEMINI",
  }
  if (projectId) metadata.duetProject = projectId

  const loadEndpoints = Array.from(new Set<string>([...ANTIGRAVITY_LOAD_ENDPOINTS, ...ANTIGRAVITY_ENDPOINT_FALLBACKS]))
  for (const baseEndpoint of loadEndpoints) {
    try {
      const discovery = await fetchWithTimeout(
        `${baseEndpoint}/v1internal:loadCodeAssist`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${accessToken}`,
            "User-Agent": "google-api-nodejs-client/9.15.1",
            "X-Goog-Api-Client": "google-cloud-sdk vscode_cloudshelleditor/0.1",
            "Client-Metadata": getAntigravityHeaders()["Client-Metadata"],
          },
          body: JSON.stringify({ metadata }),
        },
        async (response) => (response.ok ? parseManagedProjectDiscovery(await response.json()) : null),
      )
      if (discovery) return discovery
    } catch (error) {
      logger?.debug("Failed to load managed project", { endpoint: baseEndpoint, error: String(error) })
    }
  }
  return null
}

/** Extracts only managed-project fields consumed by account project policy. */
function parseManagedProjectDiscovery(value: unknown): ManagedProjectDiscovery | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null
  const payload = value as Record<string, unknown>
  const project = payload.cloudaicompanionProject
  const managedProjectId =
    typeof project === "string"
      ? project
      : typeof project === "object" && project !== null && !Array.isArray(project)
        ? typeof (project as Record<string, unknown>).id === "string"
          ? ((project as Record<string, unknown>).id as string)
          : undefined
        : undefined
  const allowedTiers = Array.isArray(payload.allowedTiers)
    ? payload.allowedTiers.flatMap((tier): Array<{ id?: string; isDefault?: boolean }> => {
        if (typeof tier !== "object" || tier === null || Array.isArray(tier)) return []
        const record = tier as Record<string, unknown>
        return [
          {
            ...(typeof record.id === "string" ? { id: record.id } : {}),
            ...(typeof record.isDefault === "boolean" ? { isDefault: record.isDefault } : {}),
          },
        ]
      })
    : undefined
  return {
    payload: value as LoadCodeAssistPayload,
    ...(managedProjectId === undefined ? {} : { managedProjectId }),
    ...(allowedTiers === undefined ? {} : { allowedTiers }),
  }
}

/** Creates an endpoint cursor so account policy controls onboarding retries and delays. */
function createManagedProjectOnboardingSession(
  input: ManagedProjectOnboardInput,
): AccountManagedProjectOnboardingSession {
  let endpointIndex = 0
  const metadata: Record<string, string> = {
    ideType: "ANTIGRAVITY",
    platform: process.platform === "win32" ? "WINDOWS" : "MACOS",
    pluginType: "GEMINI",
  }
  if (input.projectId) metadata.duetProject = input.projectId
  const requestBody = { tierId: input.tierId, metadata }

  return {
    /** Sends one onboarding request to the current endpoint without retrying or waiting. */
    attempt: async (): Promise<AccountManagedProjectOnboardingAttempt> => {
      const baseEndpoint = ANTIGRAVITY_ENDPOINT_FALLBACKS[endpointIndex]
      if (!baseEndpoint) return { kind: "endpoint-unavailable" }
      try {
        return await fetchWithTimeout(
          `${baseEndpoint}/v1internal:onboardUser`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${input.accessToken}`,
              ...getAntigravityHeaders(),
            },
            body: JSON.stringify(requestBody),
          },
          async (response) => {
            if (!response.ok) return { kind: "endpoint-unavailable" }
            const payload = (await response.json()) as OnboardUserPayload
            const managedProjectId = payload.response?.cloudaicompanionProject?.id
            if (payload.done && managedProjectId) return { kind: "complete", projectId: managedProjectId }
            if (payload.done && input.projectId) return { kind: "complete", projectId: input.projectId }
            return { kind: "pending" }
          },
        )
      } catch (error) {
        input.logger?.debug("Failed to onboard managed project", { endpoint: baseEndpoint, error: String(error) })
        return { kind: "endpoint-unavailable" }
      }
    },
    /** Advances to the next configured endpoint when the current one is exhausted. */
    nextEndpoint: () => {
      if (endpointIndex + 1 >= ANTIGRAVITY_ENDPOINT_FALLBACKS.length) return false
      endpointIndex += 1
      return true
    },
  }
}

/** Discovers the OAuth account's default project, degrading to an empty ID on failure. */
export async function discoverOAuthProjectId(accessToken: string): Promise<{ projectId: string; errors: string[] }> {
  const errors: string[] = []
  const headers: Record<string, string> = {
    Authorization: `Bearer ${accessToken}`,
    "Content-Type": "application/json",
    "User-Agent": ANTIGRAVITY_AUTH_USER_AGENT,
    "Client-Metadata": getAntigravityHeaders()["Client-Metadata"],
  }
  const endpoints = Array.from(new Set<string>([...ANTIGRAVITY_LOAD_ENDPOINTS, ...ANTIGRAVITY_ENDPOINT_FALLBACKS]))
  for (const baseEndpoint of endpoints) {
    try {
      const discovery = await fetchWithTimeout(
        `${baseEndpoint}/v1internal:loadCodeAssist`,
        {
          method: "POST",
          headers,
          body: JSON.stringify({
            metadata: {
              ideType: "ANTIGRAVITY",
              platform: process.platform === "win32" ? "WINDOWS" : "MACOS",
              pluginType: "GEMINI",
            },
          }),
        },
        async (response) => {
          if (!response.ok) {
            const message = await response.text().catch(() => "")
            return { error: `loadCodeAssist ${response.status} at ${baseEndpoint}${message ? `: ${message}` : ""}` }
          }
          const data = await response.json()
          if (typeof data !== "object" || data === null || Array.isArray(data)) {
            return { error: `loadCodeAssist missing project id at ${baseEndpoint}` }
          }
          const project = (data as Record<string, unknown>).cloudaicompanionProject
          if (typeof project === "string" && project) return { projectId: project }
          if (project && typeof project === "object" && !Array.isArray(project)) {
            const id = (project as Record<string, unknown>).id
            if (typeof id === "string" && id) return { projectId: id }
          }
          return { error: `loadCodeAssist missing project id at ${baseEndpoint}` }
        },
      )
      if (typeof discovery.projectId === "string") return { projectId: discovery.projectId, errors }
      if (discovery.error) errors.push(discovery.error)
    } catch (error) {
      errors.push(`loadCodeAssist error at ${baseEndpoint}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  return { projectId: "", errors }
}

/** Managed-project transport port used by account project-context policy. */
export const antigravityManagedProjectPort: AccountManagedProjectPort<
  ManagedProjectLoadInput,
  ManagedProjectDiscovery,
  ManagedProjectOnboardInput
> = {
  load: ({ accessToken, projectId, logger }) => loadManagedProject(accessToken, projectId, logger),
  startOnboarding: createManagedProjectOnboardingSession,
}

/** OAuth project-discovery port used during account authorization. */
export const antigravityOAuthProjectDiscoveryPort: AccountOAuthProjectDiscoveryPort<
  string,
  { projectId: string; errors: string[] }
> = {
  discover: discoverOAuthProjectId,
}
