# Task 3 Login Runtime Notes — One Account Per Login Run

Date: 2026-09-29 (UTC-3, America/Sao_Paulo host clock)
Host: opencode v2.0.18 (Windows, PowerShell)
Plugin source: `C:/Users/gomes/Desktop/Projetos/opencode-v2-antigravity-auth` (loaded via global `~/.config/opencode/opencode.jsonc` `plugins` entry)
Build: `bun run build` (`tsc -p tsconfig.build.json`) green immediately before the run, so the host loaded the fresh Task 3 implementation.

## Exact command

Run from a neutral working directory (`C:\Users\gomes\AppData\Local\Temp\opencode`) with stdin closed (piped blank line + EOF) so the flow reaches the code prompt without performing Google consent. The closed stdin made the host abort at the code prompt with `Failed`, exit code 1 — this was not an interactive cancellation.

```powershell
cmd /c "echo. | opencode auth login google --standalone 2>&1"
```

No `--method` and no `--answer` flags were passed. No code was submitted and no browser consent was completed.

## Ordered host output (ANSI color codes stripped, text verbatim)

1. `┌ Connect an integration`
2. `◇ Authorization started`
3. `● Saved accounts: 5/10 — <4 redacted addresses, 3 marked (disabled)>, Unnamed account.`

(Full addresses appeared in the live output with per-account disabled markers; they are redacted here. The committed Task 3 instructions render `email ?? "Unnamed account"` plus ` (disabled)` markers.)
4. `One account per login. Run login again to add another account; signing in again refreshes an existing account.`
5. `Manage saved accounts: /antigravity.`
6. `Complete Google sign-in, then paste either the authorization code or the full localhost redirect URL.`
7. `● https://accounts.google.com/o/oauth2/v2/auth?client_id=1071006060591-tmhssin2h21lcre235vtolojh4g403ep.apps.googleusercontent.com&response_type=code&redirect_uri=http%3A%2F%2Flocalhost%3A51121%2Foauth-callback&scope=https%3A%2F%2Fwww.googleapis.com%2Fauth%2Fcloud-platform+https%3A%2F%2Fwww.googleapis.com%2Fauth%2Fuserinfo.email+https%3A%2F%2Fwww.googleapis.com%2Fauth%2Fuserinfo.profile+https%3A%2F%2Fwww.googleapis.com%2Fauth%2Fcclog+https%3A%2F%2Fwww.googleapis.com%2Fauth%2Fexperimentsandconfigs&code_challenge=iGbD9RXat-RXecqrDUDdBwKlzyk_SdWEo1Ic3T5J08s&code_challenge_method=S256&state=eyJ2ZXJpZmllciI6ImVKUnhZR09wNmNpOVZqVlBuSmQ5TXQ5ckJ1X25UbGJreVNZNHNHSFowS0FRTVNDcVlJaWtDeUdWME1xLWJxcWRLUU5Wano2aUpyUVNRXzVJTEpOOGtBIiwicHJvamVjdElkIjoiIn0&access_type=offline&prompt=consent`
8. `■ This login requires an interactive terminal to enter the authorization code`
9. `└ Failed` — process exit code 1.

## What the output confirms

- No method picker: the host went straight to the plugin OAuth method. No inherited env/key methods and no Skip option were offered.
- No form prompts: no account-action or project-id questions were asked, consistent with the form-less method and `authorize()` ignoring answers (`authorizeAntigravity("")`).
- Instructions show live pool state (`5/10`), saved labels with disabled markers, the one-per-login text, the `/antigravity` hint, and the paste-code fallback line.
- The OAuth URL uses a localhost redirect with PKCE (`code_challenge`, `state`) and `prompt=consent`.

## What was NOT verified

- No Google consent was performed and no authorization code was submitted, so the `callback → persistOAuthAccount(result, "add")` write path was exercised only by unit tests, not live.
- Post-success `N/10` channel behavior (what the host renders after a successful login) is unconfirmed. Instructions-only `N/10` is the documented fallback per user approval, not a failure.
- The at-cap (`10/10`) instructions branch was exercised only by unit tests, not live.
- Host credential-store state was not inspected: only the plugin file (`antigravity-accounts.json` mtime 2026-09-29 00:27:17, predating the ~00:30 run) was checked. Whether the host wrote anything to its own credential store during the aborted run is UNVERIFIED.

## Concurrency note (resolved 2026-09-29)

All account-service write paths (`persistOAuthAccount`, `mutateAccount`, `verifyAccount`, `persistRefreshRotation`, quota-rotation persistence) now run as single-lock-acquisition read-modify-write transactions via `updateAccounts` (`src/plugin/storage.ts`), which replaces the file with no merge. The pre-existing unlocked read-check-write race is closed for service paths. `AccountManager.saveToDisk` (`src/plugin/accounts.ts`) also writes through `updateAccounts`: disk is the source of truth for membership, tombstoned entries are never re-appended, and only tokens the manager refreshed itself are written back (a stale untouched token never clobbers a newer service rotation). Deletions (`mutateAccount` delete, `deleteAllAccounts`, manager `removeAccount` for invalid_grant eviction) tombstone the removed identity in the same transaction, and every load/persist path filters tombstoned entries, so a background manager save racing a service delete cannot resurrect the deleted entry. Host connection precedence (`getAuth` resolves the active host connection first) is unchanged and gated by Task 1.
