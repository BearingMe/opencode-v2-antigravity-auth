// A distinct module prevents OpenCode's built-in Google package migration from
// bypassing the OAuth SDK hook.
export { createGoogle } from "@ai-sdk/google"
