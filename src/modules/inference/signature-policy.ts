import { MIN_SIGNATURE_LENGTH, SKIP_THOUGHT_SIGNATURE } from "./constants.js"
import { getCachedSignature } from "./signature-cache.js"
import { defaultSignatureStore, type SignatureStore } from "./signature-store.js"

/** Optional collaborators for repairing thinking order around tool calls. */
export interface SignatureRepairOptions {
  signatureStore?: SignatureStore
  onDebug?: (message: string, fields?: Record<string, unknown>) => void
}

/** Cache scope used when repairing a missing signature on a function call. */
export interface RequestSanitizationOptions {
  signatureSessionKey?: string
}

/** Identifies Gemini-style tool calls that require preceding thought signatures. */
export function isGeminiToolUsePart(part: any): boolean {
  return !!(part && typeof part === "object" && (part.functionCall || part.tool_use || part.toolUse))
}

/** Identifies thought parts across Gemini and Anthropic-compatible payloads. */
export function isGeminiThinkingPart(part: any): boolean {
  return !!(
    part &&
    typeof part === "object" &&
    (part.thought === true || part.type === "thinking" || part.type === "reasoning")
  )
}

/** Reads plain text from either Gemini or Anthropic-style thinking parts. */
function getThinkingPartText(part: any): string {
  if (!part || typeof part !== "object") {
    return ""
  }

  if (typeof part.text === "string") {
    return part.text
  }

  if (typeof part.thinking === "string") {
    return part.thinking
  }

  return ""
}

/** Confirms a thinking block's provider signature belongs to this session cache. */
function hasCachedMatchingSignature(part: any, sessionId: string): boolean {
  if (!part || typeof part !== "object") {
    return false
  }

  const text = getThinkingPartText(part)
  if (!text) {
    return false
  }

  const expectedSignature = getCachedSignature(sessionId, text)
  if (!expectedSignature) {
    return false
  }

  if (part.thought === true) {
    return part.thoughtSignature === expectedSignature
  }

  return part.signature === expectedSignature
}

/** Preserves reusable signatures and restores cached signatures before using the sentinel. */
export function ensureThoughtSignature(part: any, sessionId: string): any {
  if (!part || typeof part !== "object") {
    return part
  }

  if (!sessionId) {
    return part
  }

  const text = getThinkingPartText(part)
  if (!text) {
    return part
  }

  const signatureField = part.thought === true ? "thoughtSignature" : "signature"
  if (isReusableThinkingSignature(part[signatureField])) {
    return part
  }

  const cachedSignature = getCachedSignature(sessionId, text)

  if (part.thought === true) {
    return { ...part, thoughtSignature: cachedSignature ?? SKIP_THOUGHT_SIGNATURE }
  }

  if (part.type === "thinking" || part.type === "reasoning" || part.type === "redacted_thinking") {
    return { ...part, signature: cachedSignature ?? SKIP_THOUGHT_SIGNATURE }
  }

  return part
}

/** Recognizes provider signatures or the explicit cache-miss sentinel. */
function isReusableThinkingSignature(signature: unknown): boolean {
  return (
    signature === SKIP_THOUGHT_SIGNATURE || (typeof signature === "string" && signature.length >= MIN_SIGNATURE_LENGTH)
  )
}

/** Finds the latest reusable signature from thinking immediately before a tool turn. */
function findPrecedingThinkingSignature(parts: unknown[], signatureSessionKey?: string): string | undefined {
  let signature: string | undefined

  for (const part of parts) {
    if (isGeminiToolUsePart(part)) {
      break
    }
    if (!isGeminiThinkingPart(part)) {
      continue
    }

    const thinkingPart = part as Record<string, unknown>
    const existingSignature =
      thinkingPart.thought === true
        ? (thinkingPart.thoughtSignature ?? thinkingPart.thought_signature)
        : (thinkingPart.signature ?? thinkingPart.thoughtSignature ?? thinkingPart.thought_signature)
    if (typeof existingSignature === "string" && isReusableThinkingSignature(existingSignature)) {
      signature = existingSignature
      continue
    }

    const text = getThinkingPartText(thinkingPart)
    const cachedSignature = signatureSessionKey && text ? getCachedSignature(signatureSessionKey, text) : undefined
    if (cachedSignature && isReusableThinkingSignature(cachedSignature)) {
      signature = cachedSignature
    }
  }

  return signature
}

/** Checks whether a thinking part has a sentinel or a session-owned provider signature. */
export function hasSignedThinkingPart(part: any, sessionId?: string): boolean {
  if (!part || typeof part !== "object") {
    return false
  }

  if (part.thought === true) {
    if (part.thoughtSignature === SKIP_THOUGHT_SIGNATURE) return true

    if (typeof part.thoughtSignature !== "string" || part.thoughtSignature.length < MIN_SIGNATURE_LENGTH) {
      return false
    }

    if (!sessionId) {
      return true
    }

    return hasCachedMatchingSignature(part, sessionId)
  }

  if (part.type === "thinking" || part.type === "reasoning" || part.type === "redacted_thinking") {
    if (part.signature === SKIP_THOUGHT_SIGNATURE) return true

    if (typeof part.signature !== "string" || part.signature.length < MIN_SIGNATURE_LENGTH) {
      return false
    }

    if (!sessionId) {
      return true
    }

    return hasCachedMatchingSignature(part, sessionId)
  }

  return false
}

/** Keeps Gemini tool-call turns valid by placing signed thinking before tool parts. */
export function ensureThinkingBeforeToolUseInContents(
  contents: any[],
  signatureSessionKey: string,
  options: SignatureRepairOptions = {},
): any[] {
  return contents.map((content: any) => {
    if (!content || typeof content !== "object" || !Array.isArray(content.parts)) {
      return content
    }

    const role = content.role
    if (role !== "model" && role !== "assistant") {
      return content
    }

    const parts = content.parts as any[]
    const hasToolUse = parts.some(isGeminiToolUsePart)
    if (!hasToolUse) {
      return content
    }

    const thinkingParts = parts.filter(isGeminiThinkingPart).map((p) => ensureThoughtSignature(p, signatureSessionKey))
    const otherParts = parts.filter((p) => !isGeminiThinkingPart(p))
    const hasSignedThinking = thinkingParts.some((part) =>
      isReusableThinkingSignature(part?.thought === true ? part.thoughtSignature : part?.signature),
    )

    if (hasSignedThinking) {
      return { ...content, parts: [...thinkingParts, ...otherParts] }
    }

    const lastThinking = (options.signatureStore ?? defaultSignatureStore).get(signatureSessionKey)
    if (!lastThinking) {
      // No cached signature available - strip thinking blocks entirely
      // Claude requires valid signatures, and we can't fake them
      // Return only tool_use parts without any thinking to avoid signature validation errors
      options.onDebug?.("Stripping thinking from tool_use content (no valid cached signature)", {
        signatureSessionKey,
      })
      return { ...content, parts: otherParts }
    }

    const injected = {
      thought: true,
      text: lastThinking.text,
      thoughtSignature: lastThinking.signature,
    }

    return { ...content, parts: [injected, ...otherParts] }
  })
}

/** Preserves reusable Anthropic signatures before falling back to cache or sentinel. */
function ensureMessageThinkingSignature(block: any, sessionId: string): any {
  if (!block || typeof block !== "object") {
    return block
  }

  if (block.type !== "thinking" && block.type !== "redacted_thinking") {
    return block
  }

  const text = getThinkingPartText(block)
  if (!text) {
    return block
  }

  if (!sessionId) {
    return block
  }

  if (isReusableThinkingSignature(block.signature)) {
    return block
  }

  return { ...block, signature: getCachedSignature(sessionId, text) ?? SKIP_THOUGHT_SIGNATURE }
}

/** Reports whether Gemini contents contain a function call. */
export function hasToolUseInContents(contents: any[]): boolean {
  return contents.some((content: any) => {
    if (!content || typeof content !== "object" || !Array.isArray(content.parts)) {
      return false
    }
    return (content.parts as any[]).some(isGeminiToolUsePart)
  })
}

/** Reports whether Gemini contents contain a recognized thought signature. */
export function hasSignedThinkingInContents(contents: any[], sessionId?: string): boolean {
  return contents.some((content: any) => {
    if (!content || typeof content !== "object" || !Array.isArray(content.parts)) {
      return false
    }
    return (content.parts as any[]).some((part) => hasSignedThinkingPart(part, sessionId))
  })
}

/** Reports whether Anthropic-style messages contain tool use or tool results. */
export function hasToolUseInMessages(messages: any[]): boolean {
  return messages.some((message: any) => {
    if (!message || typeof message !== "object" || !Array.isArray(message.content)) {
      return false
    }
    return (message.content as any[]).some(
      (block) => block && typeof block === "object" && (block.type === "tool_use" || block.type === "tool_result"),
    )
  })
}

/** Reports whether Anthropic-style messages contain a recognized thought signature. */
export function hasSignedThinkingInMessages(messages: any[], sessionId?: string): boolean {
  return messages.some((message: any) => {
    if (!message || typeof message !== "object" || !Array.isArray(message.content)) {
      return false
    }
    return (message.content as any[]).some((block) => hasSignedThinkingPart(block, sessionId))
  })
}

/** Keeps assistant tool turns valid by placing their thinking blocks first. */
export function ensureThinkingBeforeToolUseInMessages(
  messages: any[],
  signatureSessionKey: string,
  options: SignatureRepairOptions = {},
): any[] {
  return messages.map((message: any) => {
    if (!message || typeof message !== "object" || !Array.isArray(message.content)) {
      return message
    }

    if (message.role !== "assistant") {
      return message
    }

    const blocks = message.content as any[]
    const hasToolUse = blocks.some(
      (b) => b && typeof b === "object" && (b.type === "tool_use" || b.type === "tool_result"),
    )
    if (!hasToolUse) {
      return message
    }

    const thinkingBlocks = blocks
      .filter((b) => b && typeof b === "object" && (b.type === "thinking" || b.type === "redacted_thinking"))
      .map((b) => ensureMessageThinkingSignature(b, signatureSessionKey))

    const otherBlocks = blocks.filter(
      (b) => !(b && typeof b === "object" && (b.type === "thinking" || b.type === "redacted_thinking")),
    )
    const hasSignedThinking = thinkingBlocks.some((block) => isReusableThinkingSignature(block.signature))

    if (hasSignedThinking) {
      return { ...message, content: [...thinkingBlocks, ...otherBlocks] }
    }

    const lastThinking = (options.signatureStore ?? defaultSignatureStore).get(signatureSessionKey)
    if (!lastThinking) {
      // No cached signature available - use sentinel to bypass validation
      // This handles cache miss scenarios (restart, session mismatch, expiry)
      const existingThinking = thinkingBlocks[0]
      const thinkingText = existingThinking?.thinking || existingThinking?.text || ""
      options.onDebug?.("Injecting sentinel signature (cache miss)", { signatureSessionKey })
      const sentinelBlock = {
        type: "thinking",
        thinking: thinkingText,
        signature: SKIP_THOUGHT_SIGNATURE,
      }
      return { ...message, content: [sentinelBlock, ...otherBlocks] }
    }

    const injected = {
      type: "thinking",
      thinking: lastThinking.text,
      signature: lastThinking.signature,
    }

    return { ...message, content: [injected, ...otherBlocks] }
  })
}

/** Recognizes content-part shapes accepted by Antigravity request payloads. */
function isValidRequestPart(part: unknown): boolean {
  if (!part || typeof part !== "object") {
    return false
  }

  const record = part as Record<string, unknown>

  return (
    Object.prototype.hasOwnProperty.call(record, "text") ||
    Object.prototype.hasOwnProperty.call(record, "functionCall") ||
    Object.prototype.hasOwnProperty.call(record, "functionResponse") ||
    Object.prototype.hasOwnProperty.call(record, "inlineData") ||
    Object.prototype.hasOwnProperty.call(record, "fileData") ||
    Object.prototype.hasOwnProperty.call(record, "executableCode") ||
    Object.prototype.hasOwnProperty.call(record, "codeExecutionResult") ||
    Object.prototype.hasOwnProperty.call(record, "thought")
  )
}

/** Removes malformed parts and repairs tool-call signatures before request dispatch. */
export function sanitizeRequestPayloadForAntigravity(
  payload: Record<string, unknown>,
  options: RequestSanitizationOptions = {},
): void {
  const anyPayload = payload as any

  if (Array.isArray(anyPayload.contents)) {
    anyPayload.contents = anyPayload.contents
      .map((content: unknown) => {
        if (!content || typeof content !== "object") {
          return null
        }

        const contentRecord = content as Record<string, unknown>
        const rawParts = Array.isArray(contentRecord.parts) ? contentRecord.parts : []
        let foundFirstFunctionCall = false
        const precedingThinkingSignature = findPrecedingThinkingSignature(rawParts, options.signatureSessionKey)

        const sanitizedParts = rawParts.filter(isValidRequestPart).map((part: any) => {
          if (part && typeof part === "object" && part.functionCall) {
            let sig = part.thoughtSignature || part.thought_signature

            // Only the first functionCall part in a block should have the signature.
            // Recover a preceding thought signature before using the last-resort sentinel.
            if (!foundFirstFunctionCall) {
              foundFirstFunctionCall = true
              if (!isReusableThinkingSignature(sig)) {
                sig = precedingThinkingSignature ?? SKIP_THOUGHT_SIGNATURE
              }
            } else {
              // Parallel function calls MUST NOT have a signature
              sig = undefined
            }

            if (sig) {
              return { ...part, thought_signature: sig, thoughtSignature: sig }
            }

            // If not the first part, just return the part without adding any signature keys
            const newPart = { ...part }
            delete newPart.thoughtSignature
            delete newPart.thought_signature
            return newPart
          }
          return part
        })

        if (sanitizedParts.length === 0) {
          return null
        }

        return {
          ...contentRecord,
          parts: sanitizedParts,
        }
      })
      .filter((content: unknown): content is Record<string, unknown> => content !== null)
  }

  const systemInstruction = anyPayload.systemInstruction
  if (systemInstruction && typeof systemInstruction === "object" && !Array.isArray(systemInstruction)) {
    const sys = systemInstruction as Record<string, unknown>
    if (Array.isArray(sys.parts)) {
      const sanitizedSystemParts = sys.parts.filter(isValidRequestPart)
      if (sanitizedSystemParts.length > 0) {
        sys.parts = sanitizedSystemParts
      } else {
        delete anyPayload.systemInstruction
      }
    }
  }
}
