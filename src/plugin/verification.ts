export function decodeEscapedText(input: string): string {
  return input
    .replace(/&amp;/g, "&")
    .replace(/\\u([0-9a-fA-F]{4})/g, (_, hex: string) => String.fromCharCode(Number.parseInt(hex, 16)))
}

export function normalizeGoogleVerificationUrl(rawUrl: string): string | undefined {
  const normalized = decodeEscapedText(rawUrl).trim()
  if (!normalized) {
    return undefined
  }
  try {
    const parsed = new URL(normalized)
    if (parsed.hostname !== "accounts.google.com") {
      return undefined
    }
    return parsed.toString()
  } catch {
    return undefined
  }
}

export function selectBestVerificationUrl(urls: string[]): string | undefined {
  const unique = Array.from(new Set(urls.map((url) => normalizeGoogleVerificationUrl(url)).filter(Boolean) as string[]))
  if (unique.length === 0) {
    return undefined
  }
  unique.sort((a, b) => {
    const score = (value: string): number => {
      let total = 0
      if (value.includes("plt=")) total += 4
      if (value.includes("/signin/continue")) total += 3
      if (value.includes("continue=")) total += 2
      if (value.includes("service=cloudcode")) total += 1
      return total
    }
    return score(b) - score(a)
  })
  return unique[0]
}

export type VerificationErrorDetails = {
  validationRequired: boolean
  message?: string
  verifyUrl?: string
}

export function extractVerificationErrorDetails(bodyText: string): VerificationErrorDetails {
  const decodedBody = decodeEscapedText(bodyText)
  const lowerBody = decodedBody.toLowerCase()
  let validationRequired = lowerBody.includes("validation_required")
  let message: string | undefined
  const verificationUrls = new Set<string>()

  const collectUrlsFromText = (text: string): void => {
    for (const match of text.matchAll(/https:\/\/accounts\.google\.com\/[^\s"'<>]+/gi)) {
      if (match[0]) {
        verificationUrls.add(match[0])
      }
    }
  }

  collectUrlsFromText(decodedBody)

  const payloads: unknown[] = []
  const trimmed = decodedBody.trim()
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      payloads.push(JSON.parse(trimmed))
    } catch {}
  }

  for (const rawLine of decodedBody.split("\n")) {
    const line = rawLine.trim()
    if (!line.startsWith("data:")) {
      continue
    }
    const payloadText = line.slice(5).trim()
    if (!payloadText || payloadText === "[DONE]") {
      continue
    }
    try {
      payloads.push(JSON.parse(payloadText))
    } catch {
      collectUrlsFromText(payloadText)
    }
  }

  const visited = new Set<unknown>()
  const walk = (value: unknown, key?: string): void => {
    if (typeof value === "string") {
      const normalizedValue = decodeEscapedText(value)
      const lowerValue = normalizedValue.toLowerCase()
      const lowerKey = key?.toLowerCase() ?? ""

      if (lowerValue.includes("validation_required")) {
        validationRequired = true
      }
      if (
        !message &&
        (lowerKey.includes("message") || lowerKey.includes("detail") || lowerKey.includes("description"))
      ) {
        message = normalizedValue
      }
      if (
        lowerKey.includes("validation_url") ||
        lowerKey.includes("verify_url") ||
        lowerKey.includes("verification_url") ||
        lowerKey === "url"
      ) {
        verificationUrls.add(normalizedValue)
      }
      collectUrlsFromText(normalizedValue)
      return
    }

    if (!value || typeof value !== "object" || visited.has(value)) {
      return
    }

    visited.add(value)

    if (Array.isArray(value)) {
      for (const item of value) {
        walk(item)
      }
      return
    }

    for (const [childKey, childValue] of Object.entries(value as Record<string, unknown>)) {
      walk(childValue, childKey)
    }
  }

  for (const payload of payloads) {
    walk(payload)
  }

  if (!validationRequired) {
    validationRequired =
      lowerBody.includes("verification required") ||
      lowerBody.includes("verify your account") ||
      lowerBody.includes("account verification")
  }

  if (!message) {
    const fallback = decodedBody
      .split("\n")
      .map((line) => line.trim())
      .find((line) => line && !line.startsWith("data:") && /(verify|validation|required)/i.test(line))
    if (fallback) {
      message = fallback
    }
  }

  return {
    validationRequired,
    message,
    verifyUrl: selectBestVerificationUrl([...verificationUrls]),
  }
}
