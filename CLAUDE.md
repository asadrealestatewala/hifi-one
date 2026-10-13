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

## Workflow

1. Read the relevant files, find the root cause, then make a small targeted diff that follows the existing pattern.
2. Reuse the shared UI in `src/components/ui.tsx` and `src/components/ui/` (see `docs/DESIGN_SYSTEM.md`) before writing new markup.
3. Run `tsc`, `eslint` and the focused tests after each batch; the whole suite and `npm run build` at checkpoints.
4. Update `docs/MODULE_STATUS.md` (and `docs/DECISIONS.md` for architectural choices) in the same change.
5. Server action files: give exported actions a named return type (the guard test parses function bodies, and inline `{ ... }` return types confuse it).
6. In scripts that write source files, use the Write tool or a `.py` file rather than shell heredocs with mixed quotes.

## Where things are

`src/app/(app)/…` staff screens; `src/app/portal`, `vendor`, `join`, `room` portals and meetings; `src/lib/…` business rules and services (each with tests);
`src/components/shell/…` sidebar, top bar, module tabs; `prisma/schema.prisma` and `prisma/migrations`; `agent/` Windows monitoring agent; `scripts/` operations.
