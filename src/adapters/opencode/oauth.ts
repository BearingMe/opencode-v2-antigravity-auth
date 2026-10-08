import { createAntigravityOAuth } from "../antigravity/oauth.js"
import { createLogger } from "./logger.js"

const antigravityOAuth = createAntigravityOAuth(createLogger("oauth"))

/** Builds the public Antigravity authorization URL for the OpenCode host. */
export const authorizeAntigravity = antigravityOAuth.authorizeAntigravity

/** Exchanges an OpenCode callback and records diagnostics through host logging. */
export const exchangeAntigravity = antigravityOAuth.exchangeAntigravity

export type { AntigravityAuthorization, AntigravityTokenExchangeResult } from "../antigravity/oauth.js"
