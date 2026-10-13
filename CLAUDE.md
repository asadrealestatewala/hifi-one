# Hifi One: engineering rules

ERP for Hifi Marketing and Technologies. Read this first, then `docs/MODULE_STATUS.md` for what is done and what is next.
Never touch the separate project "AgentifyERP".

## Stack

Next.js 15 (App Router, server components and server actions), TypeScript, Tailwind v4 with CSS tokens, PostgreSQL 17 through Prisma 6,
vitest. Auth is a signed cookie plus database sessions. Roles and permissions live in the database.

## Commands

| Task | Command |
|---|---|
| Local database (leave running) | `npm run db:start` (port 54329; dev DB `hifi_one`, test DB `hifi_one_test`) |
| Migrate | `npx prisma migrate dev --name <name>`; test DB: `DATABASE_URL=.../hifi_one_test npx prisma migrate deploy` |
| Seed demo data | `npm run db:seed` (passwords go to `.data/dev-credentials.txt`; never print them) |
| Dev server | `npm run dev` (compiles each page on first visit, so it feels slow) |
| Production-mode server | `npm run serve` (build, then `next start -p 3000`). Stop whatever holds port 3000 first |
| Checks | `npx tsc --noEmit`, `npx eslint src`, `npx vitest run`, `npm run build` |
| After adding a permission | `npm run roles:sync`, then `npm run docs:roles` |
| Initial staff and campaigns (idempotent, production-safe) | `npm run seed:initial` (private numbers and CNICs in `.data/initial-staff-private.json`) |

Prisma `generate` fails with an engine lock while the server runs: stop the server on port 3000 first.
Integration tests TRUNCATE their own tables in the test DB; never point `TEST_DATABASE_URL` at real data.

## Rules that never bend

- Server-side authorization on every page and action (`requirePermission` and friends). `src/lib/guards.test.ts` fails if a page or action is missing a guard. Hiding a link is not protection.
- Money uses exact decimals with an explicit currency. Posted entries are never edited or deleted: reverse, credit or adjust. Financial changes are audited.
- Never show an integration as connected when it is not (mail, ads, WhatsApp, monitoring telemetry). Say "not configured".
- Migrations are additive and safe. No destructive migration or database reset without explicit approval. New migration folders must sort after the latest one.
- No secrets, payroll, client financials or monitoring screenshots to people without the permission. No keylogging, covert recording or hidden monitoring.
- Real persisted data only: no fake buttons, mock statistics or simulated success.
- Every business rule gets a test, including a denied-access case.
- Staff details are never invented: missing email, number or CNIC stays empty. CNIC needs `hr.view_sensitive` and never appears in lists, exports or audit entries. Sign-in by email or phone always needs the password; nobody's password is set for them (setup links only).

## Operating contract (every meaningful task)

1. Read this file, the `.claude/rules/` that apply, and the docs for the area (map below).
2. Inspect the existing implementation before proposing changes; find the root cause.
3. Trace what the change touches: modules, routes, shared components, services, data models, permissions, reports, dashboard figures, portal views.
4. Write down acceptance criteria and a short plan.
5. Implement the whole outcome (persisted, guarded, audited, notified, with empty, loading and error states), not a mockup or a surface-only change.
6. Reuse `src/components/ui.tsx`, `src/components/ui/` and the `src/lib` services; add a shared piece once rather than duplicating markup or logic.
7. Update every affected integration and dependent view in the same change.
8. Run `tsc`, `eslint` and the focused tests after each batch; the whole suite and `npm run build` at checkpoints.
9. Read the actual diff; report what was verified (commands, counts) and what was not (for example "not checked in a browser").
10. Update the docs when architecture, a business rule or a module's status changes.

Notes: give exported server actions a named return type (the guard test parses function bodies). In scripts that write source files, use the Write tool or a `.py` file rather than shell heredocs with mixed quotes.

## Design contract

The reference ERP (Agentify, read-only) is the benchmark for polish, interaction quality and component reuse; its code, palette and font are not copied. Keep Hifi One's brand. Apply `docs/DESIGN_SYSTEM.md` consistently to dashboards, tables, forms, panels, filters, dialogs, empty states, notifications, mobile widths and accessibility. Lists paginate; destructive and financial actions confirm; submits show progress.

## Integration contract

Hifi One is one connected agency ERP. For each feature identify its source of truth, dependent entities, permission, workflow, financial effect, reports and client or vendor views (`docs/DATA_FLOWS.md`). No duplicate data entry; use the owning service and its transaction; money only through `postJournal`. Never silently change an established financial or business rule.

## Documentation map

| File | Holds |
|---|---|
| `docs/SYSTEM_MAP.md` | Architecture, request path, modules, routes, entry points |
| `docs/DESIGN_SYSTEM.md` | Tokens, shared components, layout patterns, interaction standards |
| `docs/DATA_MODEL.md` | Entities, canonical records, constraints |
| `docs/DATA_FLOWS.md` | Ownership of each fact, cross-module workflows, integration contracts |
| `docs/PORTALS_AND_PROJECTS.md` | Report downloads, My Profile, projects and tasks with notifications, customer and vendor tabs and portals |
| `docs/STAFF_AND_CAMPAIGNS.md` | Staff records, sign-in by email or phone, agency roles, campaigns, categories, dashboard routing, initial seed |
| `docs/MODULE_STATUS.md` | What is done, partial, missing; known defects; test gaps |
| `docs/DECISIONS.md` | Decisions with rationale; open questions |
| `docs/REFERENCE_ERP_AUDIT.md` | Comparison with the reference ERP and the prioritised task list |
| `docs/ROLES.md`, `SECURITY.md`, `DEPLOYMENT.md`, `MONITORING.md`, `MEETINGS.md` | Generated role matrix and operational detail |
| `docs/spec.md`, `roadmap.md`, `GAP_ANALYSIS.md`, `ERP_AUDIT.md`, `ERP_BLUEPRINT.md` | Owner's specification and earlier audits (history; the files above win where they differ) |

## Where things are

`src/app/(app)/…` staff screens; `src/app/portal`, `vendor`, `join`, `room` portals and meetings; `src/lib/…` business rules and services (each with tests);
`src/components/shell/…` sidebar, top bar, navigation; `prisma/schema.prisma` and `prisma/migrations`; `agent/` Windows monitoring agent; `scripts/` operations.
