# Roadmap and status

Phases follow section 35 of [spec.md](spec.md).

## Phase 0: Foundation (in progress, core done)

Done and verified on localhost:
- Next.js + PostgreSQL + Prisma, versioned migration, seed with demo users
- Sign-in with lockout after repeated failures, revocable database sessions, secure cookie
- Permission-based access (checked on the server on every page and action), 22 spec roles seeded
- Audit log (sign-ins, company profile and bank account changes; bank numbers masked in logs)
- Company profile preloaded with the supplied name, UANs and both office addresses, editable by Super Admin, with change history
- Bank accounts: add, deactivate, default per currency (PKR/USD/AED/GBP), numbers masked unless permitted
- Unit tests for masking and role definitions

Still to do in Phase 0:
- Role and permission editor, user create/edit, branches and departments screens
- Dark/light toggle, collapsible sidebar, global search
- Integration tests for permissions and audit; Playwright smoke test
- Password reset and optional MFA

## Phase 1: CRM and commercial engine (first slice done)

Done and verified on localhost:
- Service catalog: 20 categories, public-style pricing page with plan cards, Most Popular highlight, per-currency price (PKR/USD/AED/GBP), edit price with audit and plan version bump. Only AED example prices are seeded; other currencies show "Price not set".
- Leads: create with duplicate detection (email/phone), search, detail page with notes and activity timeline, record-level access (agents see own leads, managers see all).
- Pipeline board: configurable stages (seeded), drag and drop plus a stage menu for touch/keyboard, persisted, optimistic with rollback.
- Closed Won runs a controlled, repeatable conversion (needs the crm.convert permission): links or creates the client without duplicating, creates a DRAFT invoice from the deal value, keeps the lead history. Portal invitation and contract generation come with the client portal phase.

Still to do in Phase 1: contacts and companies, Smart Lists, prospecting worklists with CSV import, quotes, contracts, client conversion (needs accounting), commissions setup.

## Phase 2: projects and tasks (first slice done)

Done and verified on localhost:
- Projects with numbering, optional client, manager, deadline, budget, scope, team members with roles; record-level access (see all, or only projects you manage or belong to)
- Task board with drag and drop plus status menu, persisted; managers move any task, other members only their own
- Progress is derived from tasks (share Done); a project cannot be completed while tasks are open
- Tasks can be marked client-visible (used by the client portal later)

Still to do: Gantt/timeline, calendar, subtasks and dependencies, task comments, files, budget and cost tracking, project creation from a won deal, content calendar and approvals, success reviews, meetings.

## Phase 4: HR (first slice done: employees, attendance, leave)

Done, verified in the browser plus 16 automated tests (10 rules, 6 against the database):
- Employee records with sequential numbers; restricted identity and bank fields only for hr.view_sensitive (audit logs record that they changed, never the values); starting password generated once and shown once; change-password page that signs out all devices
- Attendance: clock in/out, breaks, office or remote, times in the company timezone. Being signed in never counts as working. A forgotten clock-out blocks the next clock-in until HR corrects it with a reason, recorded against the HR user
- Leave: types with yearly allowances (unpaid has no limit), working-day counting (weekends skipped; public holidays not configured yet), overlap and balance checks, approval only by the employee's manager or HR (never self), double approval prevented, cancellation rules

Still to do: payroll and payslips, shifts and grace rules, overtime, timesheets linked to projects, holidays calendar, documents with expiry, recruitment, performance, onboarding/offboarding, assets assignment.

## Client portal (first slice done)

Done and verified in the browser plus 4 isolation tests:
- One-time, 7-day invitation link per client contact (only a hash is stored; shown once; email delivery is not connected yet so staff copy the link)
- Separate /portal for client users: own outstanding balance, issued invoices (drafts and cancelled hidden), invoice view with frozen bank details and print/PDF, account statement, projects with only client-visible tasks
- Every portal query is scoped by the signed-in user's own client id; internal pages redirect client users to the portal; cross-client invoice ids return 404

Still to do: content calendar and approvals, support requests, announcements and offers, campaign reports, client review/ratings, receipts download, meetings, vendor/partner/investor portals.

## Phase 3 (started early): accounting core, first slice done

Done, covered by 21 automated tests including real-database concurrency tests:
- Chart of accounts (editable seed), double-entry journal; every entry must balance; posted lines are immutable (database trigger); corrections use reversing entries
- Clients, invoices (draft, issue, cancel by reversal), numbering, company and bank snapshot frozen at issue
- Payments with FIFO allocation across invoices, partial payments, advances for any excess, idempotency key so retries never duplicate, row locks so concurrent payments cannot over-allocate
- Client statement with running balance that reconciles to the AR control account; trial balance per currency
- Revenue is recognised on invoice issue (accrual); a payment never counts as revenue

Known limits: no exchange rates yet (balances are per currency, never mixed); invoice PDF is browser Print/Save as PDF (server PDF engine later); credit notes, refunds, write-offs, expense vouchers, budgets, vendor bills, bank reconciliation, fiscal period locking and financial statements are not built yet.

## Decisions

- Brand colour follows the supplied red H logo; the spec's blue/purple can be added as a theme if wanted.
- Local database must be UTF-8 (fixed after a WIN1252 default broke non-Latin text). Local database is PostgreSQL 17 from the `embedded-postgres` package (no Docker here). Production should use a managed PostgreSQL.
- Bank details and company profile edits never rewrite issued documents; documents will store snapshots (built with invoicing in Phase 3).
