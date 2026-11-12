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

Added 2026-10-17 (see `docs/AUTOMATION_AND_GROWTH.md`): staff routes `/settings/jobs`, `/support`, `/support/[id]`, `/settings/lead-sources`, `/agreements`, `/agreements/[id]` (+ `/pdf`); portal routes `/portal/support`, `/portal/support/[id]`, `/portal/approvals`, `/vendor/documents`; public routes `/sign/[token]`, `POST /api/leads/capture`, `POST /api/jobs/run`; `src/instrumentation.ts` (optional scheduler). Services: `jobs`, `support`, `deliverables`, `lead-capture`, `campaign-performance`, `agreements`, `virus-scan`, `sort`, `saved-views`, `project-timeline`.

Added 2026-11-01: public website at `/` and `/site` (see "Public website" below).

Added 2026-11-04: **Clout Leader** (`docs/CLOUT_LEADER.md`): staff routes `/clout`, `/clout/[id]`, `/clout/campaigns[/id]`, `/clout/influencers`, `/clout/settings`, `/clout/report`, `/clout/export`; portal `/portal/clout[/id]`; public secret-link `/clout-report/[token]`. Services `clout.ts`, `clout-rules.ts`, `clout-providers.ts`, `clout-views.ts`; background worker `scripts/clout-worker.mts` (pm2 `hifi-clout-worker`); yt-dlp installed by the deploy workflow.

## Public website (`/` and `/site`)

The company site hifimarketing.co, rebuilt on 2026-11-01 as Next.js pages in the route group `src/app/(site)/` (decision 46). Its layout (`(site)/layout.tsx`) has its own header, footer and stylesheet (`(site)/site.css`, every rule scoped under `.hs`), the Inter font from `public/site/vendor/google-fonts` through `next/font/local`, and inline SVG icons (`_components/Icon.tsx`). It shares only the root `<html>` with the ERP, so the light/dark choice (`hifi.theme`) carries over both ways. All copy and data live in `(site)/_content/`: `site.ts` (services, pricing plans, team, offices, careers sections), `jobs.ts` (open roles) and `blog.ts` (posts). Images go through `next/image` (resized, WebP/AVIF, lazy below the fold); originals stay in `public/site/`.

Routes: `/` (visitors; `(site)/page.tsx`, the only website file that reads the session: setup, then staff to `/dashboard`, otherwise the home page, never cached), `/site` (same home page for everyone, canonical `/`), `/site/services`, `/site/pricing`, `/site/about`, `/site/team`, `/site/careers`, `/site/careers/jobs`, `/site/careers/jobs/[id]`, `/site/blog`, `/site/blog/[id]`, `/site/contact`; `robots.txt` and `sitemap.xml` (website only, the ERP is disallowed). Everything except `/` is static.

Forms: the contact form posts to `/api/site/contact` (`src/lib/site-forms.ts`), which captures a CRM lead through the built-in lead source "Company website (contact form)", created on first use and managed under lead capture settings (assignment, campaign, switching it off). The apply form on each job page posts to `/api/site/apply` (`src/lib/job-applications.ts`): a `JobApplication` with the CV as a `StoredFile` (ownerType `JOB_APPLICATION`, PDF or DOCX up to 5 MB, virus-scanned when a scanner is configured), shown to HR at `/hr/applications` (hr.view; status and notes need hr.manage) with a notification to hr.manage. Both endpoints are public by design: same-site only (`src/lib/same-site.ts`), rate limited, size limited, with a hidden honeypot field. `src/lib/guards.test.ts` keeps the website static and the endpoints guarded.

Hero video: `public/site/images/herovideo.mp4` is the original `herovideo.mov` remuxed without re-encoding (index at the start, silent track dropped) so it starts playing after a few hundred KB; `hero-poster.webp` is its frame at 1 s and paints first.

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

`health`; `calendar/[token]` (ICS feed); `files/[id]` (signed downloads); `avatar/[id]`; `screenshots/[id]`; `meetings/[id]/{events,signal,chat,admin}` (SSE signalling); `agent/{enroll,policy,ingest,screenshot}` (Windows monitoring agent, device token); `mail/inbound` (Resend `email.received` webhook, Svix signature, `src/lib/mailboxes.ts`). Plus CSV exports in the staff area, each guarded by its list's permission: `contacts/export`, `hr/employees/export`, and (through `src/lib/lists.ts`) `finance/invoices/export`, `finance/payments/export`, `leads/export`, `quotes/export`, `expenses/export`, `audit-logs/export`.

## Module inventory (sidebar groups, `src/components/shell/nav.ts`)

| Group | Screens (`src/app/(app)/…`) | Main services (`src/lib/…`) |
|---|---|---|
| Overview | `dashboard`, `search` | `dashboard-home.ts`, `dashboard-layout.ts`, `dashboard-widgets.ts`, `search.ts`, `nav-stats.ts` |
| CRM & Sales | `contacts`, `leads`, `pipeline`, `leads/lists`, `leads/worklists`, `campaigns`, `sales/activity`, `sales/leads-report`, `quotes` | `crm-contacts.ts`, `contacts.ts`, `crm.ts`, `leads.ts`, `worklists.ts`, `leads-report.ts`, `conversion.ts`, `sales.ts`, `engagement` tests |
| Services & Clients | `services`, `clients`, `contracts`, `finance/subscriptions`, `finance/invoices`, `finance/payments` | `catalog.ts`, `sales.ts`, `accounting.ts`, `bookkeeping.ts`, `statements.ts` |
| Project Operations | `projects`, `content`, `meetings` | `projects.ts`, `tasks.ts`, `task-rules.ts`, `project-finance.ts`, `content.ts`, `content-rules.ts`, `meetings.ts`, `meeting-hub.ts` |
| Finance & Accounting | `finance/{ledger,accounts,journals,reconciliation,budgets,commissions,reports,close,year-end}`, `assets`, `investments` | `accounting.ts` (`postJournal`), `bookkeeping.ts`, `bank-rec.ts`, `expenses.ts`, `commissions.ts`, `fx.ts`, `tax.ts`, `period-lock.ts`, `year-end.ts`, `assets.ts` |
| People & HR (5 menu entries, 13 screens in four tab groups: `screen-groups.ts`) | `hr/employees` (staff directory, `export`), `hr/documents`; `hr/attendance`, `hr/reports`, `hr/reports/eod`, `hr/scorecards`, `hr/visits`, `hr/monitoring`; `hr/leave`, `hr/requests`, `hr/circulars`; `hr/applications`, `hr/onboarding`; `payroll` | `staff.ts`, `hr.ts`, `hr-rules.ts`, `payroll.ts`, `payroll-rules.ts`, `monitoring.ts`, `org-structure.ts` |
| Procurement | `vendors`, `procurement` | `vendors.ts` |
| My Space | `me/{profile,help,attendance,leave,visits,report,scorecard,requests,payslips,tasks,time,commissions,documents,calendar}`, `account/*`, `expenses`, `assistant` | `hr.ts`, `assistant.ts`, `mfa.ts`, `totp.ts` |
| Campaigns | `campaigns`, `campaigns/[id]` | `campaigns.ts` |
| Administration | `users`, `roles`, `settings/*`, `audit-logs`, `menu` | `permissions.ts`, `mfa-policy.ts`, `mailer.ts`, `menu-layout.ts`, `working-calendar.ts` |
| Portals | `src/app/portal/*` (client), `src/app/vendor/*` (vendor) | `portal.ts`, `vendors.ts`, `statements.ts` |

Downloads: `/reports/download?report=…&format=csv|pdf` (`report-tables.ts`). Workfolio dock: `src/components/shell/WorkfolioDock.tsx` with `api/monitor/state` and `api/monitor/snapshot`. Client portal: `portal/{projects,notifications,…}`; vendor portal: `vendor/{profile,notifications,…}`.

Public pages: `login` (email or phone), `login/verify`, `login/forgot`, `invite/[token]`, `reset/[token]`, `setup`, `forbidden`, `join/[token]`.

## Shared UI

`src/components/ui.tsx` (`PageHeader`, `Stat`, `Badge`, `StatusBadge`, `Progress`, `Empty`, `Notice`, `Chips`, `SearchBox`, `NewButton`, `Pager`, `PanelForm`, `Avatar`, `SubmitButton`, `ConfirmButton`), `src/components/ui/{Drawer,LineItems,Avatar,SubmitButton,ConfirmButton,ErrorView}.tsx`, `src/components/shell/*`, `src/components/{FilesPanel,EmailDocForm,PhotoForm,PrintButton,WhatsAppButton}.tsx`. Details and gaps: `docs/DESIGN_SYSTEM.md`.

## Outside the web app

`agent/hifi-agent.mjs` (Windows monitoring agent); `scripts/` (database runner, role sync, role matrix, backups, monitoring purge, contact backfill, preflight, production smoke test).

## External integrations (all honest "not configured" without credentials)

Mail through the Resend API or SMTP (`mailer.ts`), company mailboxes with Resend inbound (`mailboxes.ts`, `mail-store.ts`; staff screens `/mail`, admin `/settings/mailboxes`), Anthropic assistant (`assistant.ts`), WhatsApp click-to-chat links only (`whatsapp.ts`), TURN relay for video (not configured), ad platforms (not built), social posting (not built).

## Measured conventions (2026-10-13)

Baseline before the first improvement batch: 102 `page.tsx`; 28 used `PageHeader`, 73 rendered their own `<h1>`; 53 files hand-wrote `<table>`; 56 pages define inline server actions, 19 `actions.ts` files; 1 `loading.tsx`, 0 `error.tsx`, 0 `not-found.tsx`; 15 pages use `Drawer`. Now: `error.tsx` in `(app)`, `portal`, `vendor`; `not-found.tsx` at the root and in `(app)`; 11 lists paged.

Added 2026-11-12: **Working calendar** (`/settings/calendar`, view `settings.company.view`, edit `settings.company.edit`). `src/lib/working-calendar.ts` owns office hours, lunch, the lateness grace period, which weekdays are working days and the public holidays (`WorkingCalendar`, `PublicHoliday`), with Pakistan's list built in for the current and next year. Leave, daily reports, scorecards, the end-of-day job, the sales quest streak and payroll read it instead of their own constants; `src/lib/jobs.ts` passes the calendar to every job in its context and the end-of-day job waits for the calendar's closing time (`notBeforeClose`).

Added 2026-11-12: **My day** (`/me`, `requireUser`, every signed-in employee). `src/lib/my-day.ts` reads one person's day — the clock, the daily report, circulars still to confirm, tasks due and overdue, today's meetings — and turns it into a short "still to do" list that both `/me` and the home dashboard show. The sidebar's My space is six entries (My day, My attendance, My tasks, My leave, My payslips, My profile); everything else a person owns is grouped on `/me`, and Mailbox and Assistant moved to Overview.

Added 2026-11-12 (step 4 of the UI fixes): **Approvals** (`/approvals`, `requireUser`; every kind inside is gated by its own permission in `src/lib/approvals.ts`), **Staff leave** (`/hr/leave`, `leave.approve`; HR with `attendance.view_all` sees everyone, a manager only their direct reports) and **My team** (`/me/team`, `leave.approve`). `src/lib/approvals.ts` is a read-only aggregator: it gathers leave, off-site days, employee requests, expense vouchers, commissions, lead conversions, onboarding, time corrections and client deliverables, and links each to the screen that owns the decision. My scorecard (`/me/scorecard?user=`) now also opens for a manager's own direct report, not only for `attendance.view_all`.
