/** Builds the cache scope that separates session, model, project, and conversation. */
export function buildSignatureSessionKey(
  sessionId: string,
  model?: string,
  conversationKey?: string,
  projectKey?: string,
): string {
  const modelKey = typeof model === "string" && model.trim() ? model.toLowerCase() : "unknown"
  const projectPart = typeof projectKey === "string" && projectKey.trim() ? projectKey.trim() : "default"
  const conversationPart =
    typeof conversationKey === "string" && conversationKey.trim() ? conversationKey.trim() : "default"
  return `${sessionId}:${modelKey}:${projectPart}:${conversationPart}`
}

/** Identifies model families whose thought signatures are reused across turns. */
export function shouldCacheThinkingSignatures(model?: string): boolean {
  if (typeof model !== "string") return false
  const lower = model.toLowerCase()
  return lower.includes("claude") || lower.includes("gemini-3")
}

/** Extracts the first textual segment from provider content without concatenating blocks. */
export function extractTextFromContent(content: unknown): string {
  if (typeof content === "string") return content
  if (!Array.isArray(content)) return ""

  for (const block of content) {
    if (!block || typeof block !== "object") continue
    const part = block as Record<string, unknown>
    if (typeof part.text === "string") return part.text
    if (part.text && typeof part.text === "object") {
      const nestedText = (part.text as Record<string, unknown>).text
      if (typeof nestedText === "string") return nestedText
    }
  }
  return ""
}

/** Selects the first user text, falling back to the latest user turn. */
export function extractConversationSeedFromMessages(messages: unknown[]): string {
  const records = messages.filter(isRecord)
  const system = records.find((message) => message.role === "system")
  const users = records.filter((message) => message.role === "user")
  const firstUser = users[0]
  const lastUser = users.at(-1)
  const systemText = system ? extractTextFromContent(system.content) : ""
  const userText = firstUser ? extractTextFromContent(firstUser.content) : ""
  const fallbackUserText = !userText && lastUser ? extractTextFromContent(lastUser.content) : ""
  return [systemText, userText || fallbackUserText].filter(Boolean).join("|")
}

/** Selects user text from Google contents, preferring the first user turn. */
export function extractConversationSeedFromContents(contents: unknown[]): string {
  const users = contents.filter(
    (content): content is Record<string, unknown> => isRecord(content) && content.role === "user",
  )
  const firstUser = users[0]
  const lastUser = users.at(-1)
  const firstParts =
    isRecord(firstUser) && Array.isArray(firstUser.parts) ? extractTextFromContent(firstUser.parts) : ""
  if (firstParts) return firstParts
  return isRecord(lastUser) && Array.isArray(lastUser.parts) ? extractTextFromContent(lastUser.parts) : ""
}

/** Resolves an explicit conversation id or derives a stable key from request content. */
export function resolveConversationKey(
  requestPayload: Record<string, unknown>,
  hashSeed: (seed: string) => string,
): string | undefined {
  const payload = requestPayload
  const metadata = isRecord(payload.metadata) ? payload.metadata : undefined
  const candidates = [
    payload.conversationId,
    payload.conversation_id,
    payload.thread_id,
    payload.threadId,
    payload.chat_id,
    payload.chatId,
    payload.sessionId,
    payload.session_id,
    metadata?.conversation_id,
    metadata?.conversationId,
    metadata?.thread_id,
    metadata?.threadId,
  ]

  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim()) return candidate.trim()
  }

  const systemInstruction = payload.systemInstruction
  const systemSeedContent = isRecord(systemInstruction)
    ? (systemInstruction.parts ?? systemInstruction)
    : (systemInstruction ?? payload.system ?? payload.system_instruction)
  const systemSeed = extractTextFromContent(systemSeedContent)
  const messageSeed = Array.isArray(payload.messages)
    ? extractConversationSeedFromMessages(payload.messages)
    : Array.isArray(payload.contents)
      ? extractConversationSeedFromContents(payload.contents)
      : ""
  const seed = [systemSeed, messageSeed].filter(Boolean).join("|")
  return seed ? `seed-${hashSeed(seed)}` : undefined
}

/** Returns the first conversation key found in the wrapped request candidates. */
export function resolveConversationKeyFromRequests(
  requestObjects: Array<Record<string, unknown>>,
  hashSeed: (seed: string) => string,
): string | undefined {
  for (const request of requestObjects) {
    const key = resolveConversationKey(request, hashSeed)
    if (key) return key
  }
  return undefined
}

/** Normalizes a project key, using a fallback when the candidate is absent. */
export function resolveProjectKey(candidate?: unknown, fallback?: string): string | undefined {
  if (typeof candidate === "string" && candidate.trim()) return candidate.trim()
  if (typeof fallback === "string" && fallback.trim()) return fallback.trim()
  return undefined
}

/** Narrows unknown provider entries to plain record-like objects. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
