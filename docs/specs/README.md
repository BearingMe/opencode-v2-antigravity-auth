# Normative specifications

AI-agent and reviewer source of truth. Specs define required behavior;
developer guides in `../dev/` explain how it works and how it is verified.
User guides in `../user/` describe what users can do.

## Authority

- When a guide and specs disagree on required behavior, specs win.
- When any doc and code disagree on facts, code wins — fix the doc.
- External contracts in `06-external-testing-compat.md` are version-scoped;
  re-verify against live traffic and pinned host types before treating them
  as stable.

## Reading order

1. `07-rule-index.md` — normative rule lookup (MUST/SHOULD/MAY with status).
2. Relevant `00-06` file for detail, evidence, and divergences `D-*`.
3. Open questions `U*` in `06-external-testing-compat.md` — do not invent answers.

## Status labels

- Explicit: code, test, or contract evidence.
- Strong: repeated consistent behavior.
- Inferred: likely intent.

## Identifiers

- `R-*` normative rules, `D-*` known divergences and accepted limitations,
  `U*` unresolved questions. Identifiers are stable; do not rename without
  updating all references.
- `R-ARCH-V2-DELEGATES-V1` keeps its historical name but means: V2 routes
  all Antigravity model traffic through the native engine in
  `src/plugin/engine.ts`. There is no V1 runtime anymore.
