# Reference ERP audit: Agentify ERP vs Hifi One

Date: 2026-10-13. Method: read both repositories, count patterns with `grep`, run Hifi One's checks. The reference was inspected read-only at `C:\Users\HP\Documents\AgentifyERP` (commit `d944e35`, same project as `github.com/asadrealestatewala/Agentify-ERP`); nothing there was written, installed or run.

Labels: **Verified** = seen in code or command output (evidence path given). **Probable** = strongly suggested by code, not exercised. **Unknown** = could not be established here.

## 1. The two systems at a glance

| | Agentify ERP (reference) | Hifi One (active) |
|---|---|---|
| Business | Real-estate developer: plots, installments, construction, website | Marketing and IT agency: CRM, retainers, projects, content, HR, monitoring |
| Stack | React 18 SPA (Vite, JavaScript) → Express REST → `node:sqlite` | Next.js 15 App Router, TypeScript strict, server components and actions → Prisma 6 → PostgreSQL 17 |
| Money | Integer rupees, one currency (PKR) | `Decimal` with explicit currency, never mixed |
| Auth | JWT cookie, module × action permissions, `own_scope` roles | Signed cookie + DB sessions, 80 permissions, 23 roles, guard test |
| UI kit | `client/src/components/ui.jsx` (268 lines, ~30 exports) + `DataTable`, `FilterPanel`, `ResourcePage`, `CommandPalette`, `TodayFeed`, toasts with undo | `src/components/ui.tsx` (122 lines, 14 exports) + `Drawer`, `LineItems`, `Avatar` |
| Tests | `node --test`, 10 files, ~176 cases, HTTP-level acceptance tests | vitest, 52 files, 748 tests passing on 2026-10-13, real-database integration tests, guard test |
| CI | `.github/workflows/ci.yml` (tests + build on every push and PR) | none |

Do not read similarly named modules as the same thing: the reference's "sales" are property sales with installment schedules, its "projects" are construction sites, its "customers" own plots. Hifi One's sales are leads, quotations and retainers; projects are client delivery work.

## 2. Verified root causes: why the reference feels more consistent and integrated

The reference is not better engineered at the data layer. Hifi One is stronger there (types, exact decimals, multi-currency, immutable ledger trigger, idempotency keys, guard test). The difference is almost entirely in the **presentation and interaction layer** and in **how consistently shared pieces are used**.

### RC1. Hifi One's shared UI kit is too small, so pages hand-roll markup (Verified)
- The reference ships every screen-level primitive: `PageHead`, `Card` (title + actions), `Stat` with icon tile, `StatusBadge` with one tone map, `Field` (label, required mark, hint, error), `Select`, `CurrencyInput`, `Tabs`, `Modal`, `Drawer`, `ConfirmDialog` (optional reason), `DateRangeFilter`, `Menu`, `KV`, `LedgerSummary`, `BackLink`, `Loading` skeleton, `Empty` with call to action (`client/src/components/ui.jsx`). Adoption: `Loading` in 45 files, `Empty` 38, `Stat` 37, `Field` 36, `StatusBadge` 32, `PageHead` 31, `Modal` 28, `ConfirmDialog` 23; raw `<h1>` appears only 5 times in its pages.
- Hifi One: 102 `page.tsx` files, only **28 use `PageHeader`**, **73 write their own `<h1>`**; **53 files hand-write `<table>` markup** with repeated Tailwind classes; **64 files inline an error `<p role="alert">`** while `Notice` is used in 21; no `Card`, `Field`, `Tabs`, `Modal`, `ConfirmDialog`, `DateRangeFilter`, `KV` or `Money` component exists (`src/components/ui.tsx`).
- Effect: spacing, heading sizes, table headers and alert styles drift page by page, which is what makes the product read as "separate screens".

### RC2. No shared list engine: lists are silently capped (Verified)
- Reference `DataTable` + `useTable` (`client/src/components/DataTable.jsx`) give every list server-side search, sort, pagination, column chooser, saved views, row actions, empty and loading states, and `ExportMenu` (CSV, Excel, PDF via `routes/helpers.js sendTable`).
- Hifi One lists use fixed `take:` caps with no pager: invoices 200 (`finance/invoices/page.tsx:66`), payments 100, leads 200, pipeline 500, quotes 200, expenses 200, audit logs 100. Only contacts paginate (`src/lib/crm-contacts.ts:343`). Nothing tells the user rows are missing. Only contacts export to CSV.
- Effect: once data grows, records disappear from lists without notice (Probable at today's data volumes; Verified in code). The Assets tab on the home dashboard computes counts and cost from a 500-row capped query (`dashboard/page.tsx:115`), so its totals become wrong beyond 500 assets (Verified in code).

### RC3. Feedback and safety around actions is thin (Verified)
- Reference: every mutation reports through one toast system; deletes and stage moves are undoable for 8 s; destructive actions go through `ConfirmDialog` (23 files), optionally demanding a reason (`client/src/context.jsx`, `ui.jsx`).
- Hifi One: 222 `<form>`s, about 10 client forms show a pending state; `PanelForm`'s submit button has none (`src/components/ui.tsx:118`), so double-clicks re-submit. There is no confirmation component: "Cancel invoice" (`finance/invoices/[id]/page.tsx:117`) and commission "Void" (`finance/commissions/page.tsx:103`) post on one click. Success is rarely confirmed (about 10 files pass `?ok=`/`saved=`).

### RC4. Loading and error states exist once, not per screen (Verified)
- Hifi One has a single `src/app/(app)/loading.tsx`, **no `error.tsx` and no `not-found.tsx`** anywhere. A thrown error in any page shows Next's default error screen. `docs/DESIGN_SYSTEM.md` says "every list has empty, loading and error states", which the code does not meet.

### RC5. Mutations are split between pages and action files (Verified)
- 56 of 102 `page.tsx` files define inline `"use server"` actions; 19 `actions.ts` files exist. Data reads live directly in 84 pages. Business rules are correctly in `src/lib` (24 transactional services), but the parse → call service → audit → notify → redirect sequence is re-typed per page, so steps get skipped (see RC6).
- Reference: routes are thin and always call `audit()`, `activity()` and `notify()/notifyPerm()` from one module (`server/src/audit.js`).

### RC6. Cross-module notifications are sparse (Verified)
- Hifi One calls `notify*` in 7 places (expenses, budgets, leave, projects, vendor work, content). None on: lead assignment, invoice issue or payment received, quote accepted from the portal, payroll, vendor bill decisions (`grep notify` over `src/app/(app)/leads`, `finance/*`, `portal/quotes`, `payroll`, `lib/sales.ts`, `lib/vendors.ts`, `lib/conversion.ts`: 0 hits).
- Reference: 17 route and service files notify; a "Today" feed (`routes/insights.js`) turns live queries into role-aware cards that link to filtered screens.

### RC7. Commission and recurring work are batch buttons, not event-driven (Verified / Probable)
- Commissions are created by `accrueCommissions` run from a button (`src/lib/commissions.ts:37`), not when a payment is allocated; subscriptions bill through `generateDueInvoices` on demand (`src/lib/sales.ts:169`); there is no scheduler (`docs/MODULE_STATUS.md`). Payroll does not pick up approved commissions (reference: `services/hr.js commissionDue`, payslip splits net into commission + salary). Probable effect: dashboards and statements lag reality until someone presses the button.

### RC8. Integration-level tests and CI are missing (Verified)
- Hifi One tests services thoroughly against a real database but has no browser or HTTP-level tests and no CI. Several screens are recorded as "not yet checked signed in" (`docs/ERP_AUDIT.md` items 11, 12).
- Reference: acceptance tests boot the real server and drive it over HTTP as different roles, and assert cross-ledger invariants (trial balance balances; receivable control account equals the sub-ledger) (`server/test/acceptance.test.js`). CI runs tests and the build on every push.

## 3. Where Hifi One is already stronger (keep)

Verified: TypeScript strict; Prisma schema with 105 models and additive migrations; exact decimals with currency; one posting engine `postJournal` with idempotency keys used by invoices, payments, credit notes, write-offs, expenses, vendor bills, payroll, assets, commissions, year-end (`src/lib/accounting.ts:28`); database trigger for immutable posted lines; period lock; test that every page and action has a guard (`src/lib/guards.test.ts`); org isolation; contact master record with merge history; honest "not configured" integrations; URL-driven filters and drawers (`?status=`, `?new=1`) that are shareable and work without client JavaScript.

The reference has weaknesses not to copy: three stacked stylesheets overriding each other (`styles.css`, `styles2.css`, `styles3.css`), plain JavaScript, single currency in integer units, saved views and column choices only in `localStorage`.

## 4. Transferable patterns (principles, not code)

| # | Pattern from the reference | How it fits Hifi One |
|---|---|---|
| P1 | One complete UI kit and a rule that pages compose it | Grow `src/components/ui.tsx` with `Card`, `Field`, `Tabs`, `KV`, `Money`, `ConfirmButton`, `SubmitButton`, `DateRange`; server-component friendly |
| P2 | One list engine: search, sort, paginate, export, empty and loading | A server `DataTable` driven by URL params (`?q&sort&dir&page`), `take`+`skip` with a total count, CSV export route per list |
| P3 | One feedback channel for every mutation | Flash message via cookie or `?ok=` read by a shared `<Flash>`; pending state on every submit |
| P4 | Confirm (and reason) before destructive or financial actions | `ConfirmButton` client component wrapping a form; reason field when the service needs one |
| P5 | One `audit + activity + notify` call per business event | A `record(event)` helper in `src/lib` called by services after commit |
| P6 | Derived, not stored, numbers | Already practised (progress, profitability); extend to goals and attention lists |
| P7 | A "today" feed of role-aware attention cards linking to filtered lists | Already partly built (Needs-attention list); feed it from the same loaders |
| P8 | Acceptance tests that cross modules and assert ledger invariants; CI | vitest integration test per end-to-end flow; GitHub Actions running `tsc`, `eslint`, `vitest`, `build` |
| P9 | Semantic status palette (success, warning, danger, info, neutral backgrounds) and icon tiles | Add `--info` and tone background tokens to `globals.css`; keep Hifi brand colours |
| P10 | Command palette (Ctrl+K) over permission-filtered navigation | Optional, after P1–P5 |

## 5. Incompatibilities (do not transfer)

Express routes, SQLite, JWT, `localStorage`-only state, PKR integer money, Asia/Karachi wall-clock storage, property/installment/plot domain, the website builder, Supabase, Capacitor, the teal "calm" palette and Plus Jakarta Sans (Hifi keeps its red logo and violet primary, Decision 5), offline write queue (conflicts with server actions and audit).

## 6. Prioritised gap analysis

| Priority | Gap | Label | Effect |
|---|---|---|---|
| 1 | Lists capped by `take:` with no pagination or notice; dashboard assets totals from capped list | Verified | Missing records and wrong totals as data grows |
| 2 | No `error.tsx` / `not-found.tsx`; one `loading.tsx` | Verified | Raw error screens; no per-section loading |
| 3 | No confirm step on Cancel invoice, Void commission and similar; no pending state on `PanelForm` | Verified | Accidental financial actions, double submits |
| 4 | Small UI kit, 73 pages with hand-rolled headers, 53 with hand-rolled tables, 64 inline alerts | Verified | Visual drift, slower and inconsistent new screens |
| 5 | Notifications missing on lead assignment, payments, invoice issue, portal quote decisions, payroll, vendor bills | Verified | Modules feel disconnected; work is missed |
| 6 | No CI, no browser or HTTP-level flow tests | Verified | Regressions found by hand |
| 7 | Commission accrual and subscription billing are manual batches; payroll ignores commissions | Verified (code), effect Probable | Lagging numbers, double handling |
| 8 | Export only on contacts | Verified | Users copy data by hand |
| 9 | Inline server actions in 56 pages | Verified | Audit and notify steps skipped inconsistently |
| 10 | Real-world behaviour of mail, video across networks, drag and drop | Unknown | Not testable on this machine |

## 7. Five highest-priority implementation tasks

Status 2026-10-13 (branch `feat/erp-consistency`): a first pass of all five is implemented and covered by tests. It has not been checked in a browser, and CI has not run because the repository has no remote. Remaining scope is in `docs/MODULE_STATUS.md` under "Cross-cutting gaps".

1. **Paginate every list** with a shared server `DataTable` (URL `page`, `sort`, `q`; `skip`/`take` plus `count`), show "x–y of N", and compute every KPI from aggregates, not capped lists. Start with invoices, payments, leads, quotes, expenses, audit logs; fix the dashboard assets tab.
2. **Add `error.tsx` and `not-found.tsx`** at `(app)`, `portal`, `vendor`; add section `loading.tsx` for finance, CRM, HR; give `PanelForm` a pending submit button.
3. **`ConfirmButton` with optional reason** for every destructive or financial action (cancel, void, write off, reverse, delete, reject), plus a shared success flash.
4. **Event helper and notifications**: one `src/lib` function that audits, writes the contact timeline and notifies, then wire lead assignment, invoice issued, payment received, quote accepted or declined, payroll paid, vendor bill decided.
5. **CI and flow tests**: a GitHub Actions workflow running `tsc`, `eslint`, `vitest` (with Postgres service) and `build`; one cross-module integration test per core flow (lead → client → quote → invoice → payment → commission) asserting trial balance and receivable control equals open invoices.

Each task must follow `CLAUDE.md` (guard, test with a denied case, docs update).

Update 2026-10-31 (branch `feat/paginated-lists`): tasks 1 and 2 completed.
- Task 1: the six lists use one address parser (`src/lib/list-params.ts`) and one filter per list (`src/lib/lists.ts`) shared by the page, its figures and a new streamed CSV export (`<list>/export`, same permission, no row cap, formula-safe, exact decimals with currency, no sensitive fields). Invoice outstanding is now a per-currency aggregate. The dashboard Assets tab was already aggregate-based. Still capped: pipeline board (500 cards, with a notice), notifications (100), lead activity on a lead (100), exchange-rate history (100), monitoring devices (100); contacts and staff exports stop at 5,000 rows. No column-config `DataTable` component (decision 41).
- Task 2: `not-found.tsx` added to `portal` and `vendor` (shared `NotFoundView`); section `loading.tsx` for finance, HR, leads, contacts and pipeline (`PageSkeleton`); `SubmitButton` also in `FilesPanel` and `PhotoForm`. `error.tsx` and the `PanelForm` pending state already existed. Hand-written forms elsewhere still lack a pending state. Nothing in this update was checked in a browser.
