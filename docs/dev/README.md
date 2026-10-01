# Developer docs

Developer guides explain **how the plugin works and how it is verified**.
Normative rules live in `../specs/00-07`; when a guide and `specs/` disagree on
required behavior, `specs/` win. When any doc and the code disagree on facts,
the code wins — fix the doc.

| Guide                                                | When to read it                                               |
| ---------------------------------------------------- | ------------------------------------------------------------- |
| [architecture.md](architecture.md)                   | Request flow, module map, boundaries                          |
| [account-storage.md](account-storage.md)             | Store format, transactions, tombstones, credential precedence |
| [rpc-and-tui.md](rpc-and-tui.md)                     | `AntigravityAccounts` RPC contract and `/antigravity` dialog  |
| [quota-contract.md](quota-contract.md)               | Quota sources, aggregation, unknown semantics, timeouts       |
| [antigravity-api.md](antigravity-api.md)             | Observed upstream wire contracts and header rules             |
| [testing.md](testing.md)                             | Automated tests, commands, known gaps                         |
| [manual-testing.md](manual-testing.md)               | Hand-verified TUI checklist (no automated coverage by design) |
| [maintainer-operations.md](maintainer-operations.md) | Packaging, `dist/` hygiene, triage runner                     |

Observed host target: OpenCode v2.0.18. Claims below are scoped to that
target unless stated otherwise; no supported-version range has been verified.
