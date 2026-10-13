# Implementation quality

Applies to every task in this repository.

- Finish the outcome, not the mockup: persisted data, server-side permission check, audit, notifications, empty and error states, tests, docs. No fake buttons, placeholder numbers or simulated success.
- Small, targeted diffs that follow the existing pattern. No broad refactors, redesigns or new dependencies unless the task asks for them and `docs/DECISIONS.md` records why.
- Prefer `actions.ts` per module for new server actions, with a named return type (the guard test parses function bodies).
- Read the actual diff before reporting. List what was verified (commands and counts) separately from what was not (screens not opened, services without credentials).
- Keep docs true: update `docs/MODULE_STATUS.md` when status changes, `docs/DATA_FLOWS.md` when a workflow or owner changes, `docs/DESIGN_SYSTEM.md` when a shared component is added, `docs/DECISIONS.md` for architectural choices, `docs/SYSTEM_MAP.md` when routes or modules change.
- Never touch the separate project "AgentifyERP"; it is a read-only reference.
