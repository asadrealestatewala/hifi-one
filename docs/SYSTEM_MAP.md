# System map

Verified against the repository on 2026-10-13 (commit `5f3e9d8`). If the code and this file disagree, the code wins: fix this file in the same change.

## Stack and entry points

| Area | Fact | Where |
|---|---|---|
| Framework | Next.js 15.5 App Router, React 19, server components and server actions | `package.json`, `src/app` |
| Language | TypeScript, `strict: true` | `tsconfig.json` |
| Styling | Tailwind v4 with CSS tokens | `src/app/globals.css`, `postcss.config.mjs` |
| Database | PostgreSQL 17 via Prisma 6 (105 models, 39 migrations); local server from `embedded-postgres` on port 54329 | `prisma/schema.prisma`, `prisma/migrations`, `scripts/db.mjs` |
| Validation | zod in 12 files; most actions parse `FormData` by hand and rely on service errors | `src/lib/*` |
| Tests | vitest; `*.test.ts` (pure) and `*.integration.test.ts` (real test DB, files run one at a time) | `vitest.config.ts`, `src/lib` |
| Package manager | npm (`package-lock.json`); `npm install --legacy-peer-deps` | `README.md` |
| Env | `DATABASE_URL`, `SESSION_SECRET` (plus optional SMTP, `ANTHROPIC_API_KEY`) | `.env.example`, `docs/DEPLOYMENT.md` |
| Deploy | `Dockerfile`, `docker-compose.yml`, `npm run serve` locally | `docs/DEPLOYMENT.md` |
| CI | GitHub Actions: tsc, eslint, vitest (Postgres 17 service), build. Not yet run (no remote) | `.github/workflows/ci.yml` |

Commands are listed in `CLAUDE.md`.

## Request path

```
Browser
  └─ (no middleware.ts) → src/app/layout.tsx (theme script, fonts)
       ├─ (app)/layout.tsx        requireUser → Shell (Sidebar, Topbar, NavProgress, RowClick)
       │    └─ <module>/page.tsx  requirePermission(...) → reads via db (Prisma) → renders
       │         └─ server action (inline "use server" or actions.ts) → src/lib service ($transaction) → audit → redirect
       ├─ portal/*                requireClientUser (client portal)
       ├─ vendor/*                requireVendorUser (vendor portal)
       ├─ join/[token], room/[id] meetings (guest link + waiting room; staff need meetings.use)
       └─ api/*                   route handlers (below)
```

Guards: `src/lib/auth.ts` (`getSessionUser` cached per request, `requireUser`, `requirePermission`, `requireClientUser`, `requireVendorUser`, `requireSession`, `audit`). Permissions and roles: `src/lib/permissions.ts` (80 permission keys, 23 role definitions synced with `npm run roles:sync`; matrix in `docs/ROLES.md`). Record scope helpers such as `leadScope`, `contactScope`, `projectScope`, and `src/lib/file-access.ts`. The test `src/lib/guards.test.ts` fails if a page or action lacks a guard.

## Route handlers (`src/app/api`)

`health`; `calendar/[token]` (ICS feed); `files/[id]` (signed downloads); `avatar/[id]`; `screenshots/[id]`; `meetings/[id]/{events,signal,chat,admin}` (SSE signalling); `agent/{enroll,policy,ingest,screenshot}` (Windows monitoring agent, device token). Plus `src/app/(app)/contacts/export/route.ts` (CSV).

## Module inventory (sidebar groups, `src/components/shell/nav.ts`)

| Group | Screens (`src/app/(app)/…`) | Main services (`src/lib/…`) |
|---|---|---|
| Overview | `dashboard`, `search` | `dashboard-home.ts`, `dashboard-layout.ts`, `dashboard-widgets.ts`, `search.ts`, `nav-stats.ts` |
| CRM & Sales | `contacts`, `leads`, `pipeline`, `leads/lists`, `leads/worklists`, `campaigns`, `sales/activity`, `sales/leads-report`, `quotes` | `crm-contacts.ts`, `contacts.ts`, `crm.ts`, `leads.ts`, `worklists.ts`, `leads-report.ts`, `conversion.ts`, `sales.ts`, `engagement` tests |
| Services & Clients | `services`, `clients`, `contracts`, `finance/subscriptions`, `finance/invoices`, `finance/payments` | `catalog.ts`, `sales.ts`, `accounting.ts`, `bookkeeping.ts`, `statements.ts` |
| Project Operations | `projects`, `content`, `meetings` | `projects.ts`, `tasks.ts`, `task-rules.ts`, `project-finance.ts`, `content.ts`, `content-rules.ts`, `meetings.ts`, `meeting-hub.ts` |
| Finance & Accounting | `finance/{ledger,accounts,journals,reconciliation,budgets,commissions,reports,close,year-end}`, `assets`, `investments` | `accounting.ts` (`postJournal`), `bookkeeping.ts`, `bank-rec.ts`, `expenses.ts`, `commissions.ts`, `fx.ts`, `tax.ts`, `period-lock.ts`, `year-end.ts`, `assets.ts` |
| People & HR | `hr/employees` (staff directory, `export`), `hr/attendance`, `payroll`, `hr/monitoring` | `staff.ts`, `hr.ts`, `hr-rules.ts`, `payroll.ts`, `payroll-rules.ts`, `monitoring.ts`, `org-structure.ts` |
| Procurement | `vendors`, `procurement` | `vendors.ts` |
| My Space | `me/{profile,help,attendance,leave,payslips,tasks,time,commissions,documents,calendar}`, `account/*`, `expenses`, `assistant` | `hr.ts`, `assistant.ts`, `mfa.ts`, `totp.ts` |
| Campaigns | `campaigns`, `campaigns/[id]` | `campaigns.ts` |
| Administration | `users`, `roles`, `settings/*`, `audit-logs`, `menu` | `permissions.ts`, `mfa-policy.ts`, `mailer.ts`, `menu-layout.ts` |
| Portals | `src/app/portal/*` (client), `src/app/vendor/*` (vendor) | `portal.ts`, `vendors.ts`, `statements.ts` |

Downloads: `/reports/download?report=…&format=csv|pdf` (`report-tables.ts`). Workfolio dock: `src/components/shell/WorkfolioDock.tsx` with `api/monitor/state` and `api/monitor/snapshot`. Client portal: `portal/{projects,notifications,…}`; vendor portal: `vendor/{profile,notifications,…}`.

Public pages: `login` (email or phone), `login/verify`, `login/forgot`, `invite/[token]`, `reset/[token]`, `setup`, `forbidden`, `join/[token]`.

## Shared UI

`src/components/ui.tsx` (`PageHeader`, `Stat`, `Badge`, `StatusBadge`, `Progress`, `Empty`, `Notice`, `Chips`, `SearchBox`, `NewButton`, `Pager`, `PanelForm`, `Avatar`, `SubmitButton`, `ConfirmButton`), `src/components/ui/{Drawer,LineItems,Avatar,SubmitButton,ConfirmButton,ErrorView}.tsx`, `src/components/shell/*`, `src/components/{FilesPanel,EmailDocForm,PhotoForm,PrintButton,WhatsAppButton}.tsx`. Details and gaps: `docs/DESIGN_SYSTEM.md`.

## Outside the web app

`agent/hifi-agent.mjs` (Windows monitoring agent); `scripts/` (database runner, role sync, role matrix, backups, monitoring purge, contact backfill, preflight, production smoke test).

## External integrations (all honest "not configured" without credentials)

SMTP mail (`mailer.ts`), Anthropic assistant (`assistant.ts`), WhatsApp click-to-chat links only (`whatsapp.ts`), TURN relay for video (not configured), ad platforms (not built), social posting (not built).

## Measured conventions (2026-10-13)

Baseline before the first improvement batch: 102 `page.tsx`; 28 used `PageHeader`, 73 rendered their own `<h1>`; 53 files hand-wrote `<table>`; 56 pages define inline server actions, 19 `actions.ts` files; 1 `loading.tsx`, 0 `error.tsx`, 0 `not-found.tsx`; 15 pages use `Drawer`. Now: `error.tsx` in `(app)`, `portal`, `vendor`; `not-found.tsx` at the root and in `(app)`; 11 lists paged.
