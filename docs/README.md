# Documentation

- Start here: [README.md](../README.md) (install, login, `/antigravity`, links)
- [Changelog](../CHANGELOG.md)

## User guides

| Guide                                                      | Contents                                                                    |
| ---------------------------------------------------------- | --------------------------------------------------------------------------- |
| [user/installation.md](user/installation.md)               | Install the plugin, connect Google, verify it works                         |
| [user/configuration.md](user/configuration.md)             | `antigravity.json` options, env overrides, recommended setups               |
| [user/models-and-variants.md](user/models-and-variants.md) | Model inventory, variants, routing between Antigravity and Gemini CLI pools |
| [user/accounts-and-quota.md](user/accounts-and-quota.md)   | Add/manage accounts, `/antigravity` dialog, quota bars, storage and safety  |
| [user/troubleshooting.md](user/troubleshooting.md)         | Common errors, what to try first, how to report a bug                       |

User guides describe **what you can do**. They do not track implementation
progress, task gates, or host internals.

## Developer guides

| Guide                                                        | Contents                                                                   |
| ------------------------------------------------------------ | -------------------------------------------------------------------------- |
| [dev/README.md](dev/README.md)                               | Map of developer docs and normative specs                                  |
| [dev/architecture.md](dev/architecture.md)                   | Request flow, module map, boundaries                                       |
| [dev/account-storage.md](dev/account-storage.md)             | Store format, transactions, tombstones, credential precedence              |
| [dev/rpc-and-tui.md](dev/rpc-and-tui.md)                     | `AntigravityAccounts` RPC contract, `/antigravity` dialog, transport rules |
| [dev/quota-contract.md](dev/quota-contract.md)               | Quota sources, aggregation, unknown semantics, timeouts                    |
| [dev/antigravity-api.md](dev/antigravity-api.md)             | Observed upstream wire contracts, header rules                             |
| [dev/testing.md](dev/testing.md)                             | Unit, regression, and E2E testing; coverage gaps                           |
| [dev/manual-testing.md](dev/manual-testing.md)               | Manual `/antigravity` checklist (the TUI flow has no automated coverage)   |
| [dev/maintainer-operations.md](dev/maintainer-operations.md) | Release packaging, `dist/` hygiene, triage runner                          |

## Normative specifications

[specs/00-07](specs/README.md) are the canonical rules for agents and reviewers
(invariants, contracts, divergences `D-*`, open questions `U*`).
Developer guides explain the system; `specs/` define what must stay true.
When they disagree, `specs/` win for behavior and code evidence wins for facts.
