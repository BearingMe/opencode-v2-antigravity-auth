import { createAntigravityVersionService } from "../antigravity/version.js"
import { createLogger } from "./logger.js"

const { initAntigravityVersion } = createAntigravityVersionService(createLogger("version"))

/** Refreshes Antigravity's version before OpenCode model registration. */
export { initAntigravityVersion }
