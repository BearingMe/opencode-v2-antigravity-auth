/** A store that cannot be read safely for a write operation. */
export class AccountStoreUnreadableError extends Error {
  readonly code: string | undefined
  readonly storePath: string

  /** Creates the fail-closed error used when preserving the existing account file. */
  constructor(storePath: string, code: string | undefined, message?: string) {
    super(
      message ??
        "Antigravity account store is unreadable (" +
          (code ?? "unknown error") +
          "). Refusing to overwrite " +
          storePath +
          " so saved accounts are preserved.",
    )
    this.name = "AccountStoreUnreadableError"
    this.code = code
    this.storePath = storePath
  }
}
