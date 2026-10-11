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

## Financial statements and executive dashboard (first slice done)

Done, 14 automated tests (9 pure, 5 against the database) plus a browser check (balance sheets balanced in PKR and USD):
- Profit and Loss for any period, Balance Sheet as at any date (earnings to date shown on their own line because year-end closing is not built), Cash Movement per bank account with opening and closing, Receivables Aging; all per currency, printable
- Every figure comes from the same journal lines as the ledger; tests prove the balance sheet balances, P&L uses recognised revenue (not cash), aging equals the AR control account, cash movement equals the bank ledger, dashboard equals the reports
- Executive dashboard: revenue, net profit, cash, owed by customers, payables per currency; open pipeline value; active projects, employees, overdue tasks; needs-attention list (vouchers, bills, payroll, leave, budget transfers, overdue invoices, open attendance sessions, budgets at 90%+), every card links to its detail
- Bugs found and fixed by the tests: period filters were shifted by the database time zone (bounds are now plain text cast to timestamp), and depreciation was dated in the following month (now the last day of the month it covers)
Limits: no year-end closing or fiscal period locking; no multi-currency consolidation (needs exchange rates); no proper cash flow statement (operating, investing, financing); no CSV/XLSX export or server-generated PDF yet (browser print only); no role-specific dashboards for HR, sales, project managers or clients beyond the portals; no saved or scheduled reports.

## Fixed assets and investments (first slice done)

Done, 21 automated tests plus a browser run (a USD 2,400 asset over 24 months: after 3 months accumulated depreciation 300, net book value 2,100, trial balance balanced):
- Asset register with numbers, serial, supplier, location, assignment history; purchases are capitalised (never expensed), paid from a bank or recorded as a payable
- Straight-line depreciation from the purchase month; the last month absorbs rounding so the total equals cost minus salvage; running it repeatedly or concurrently never posts a month twice
- Disposal requires depreciation posted through the disposal month; proceeds versus net book value books a gain or a loss; disposed assets stop depreciating and cannot be reassigned
- Investments: capital paid in, income recognised and cash received kept separate, with the outstanding gap shown; cash received cannot exceed recognised income; request keys make retries safe
Limits: no capitalisation threshold setting; only straight-line (no declining balance); no revaluation or impairment; no maintenance/warranty tracking or documents; partnerships and joint ventures (agreements, profit sharing, partner portal) are not built; investment valuation methods are not modelled.

## Vendors and procurement (first slice done)

Done, 8 database tests plus a browser run (vendor invited, signed in, applied; all internal pages bounce a vendor back to /vendor):
- Vendor directory with codes, pending/approved/suspended status, one-time invitation link to the vendor portal
- Formal flow, each step a human decision: opportunity, application (one per vendor, deadline enforced, only approved vendors), application approval, work order (idempotent when issued twice), delivery marked by vendor, accepted by staff, bill (only after acceptance, capped at the work order amount even under concurrent submissions), bill approval with an expense account, posting (expense and a payable tagged to the vendor), payment (separate step, bank in the same currency)
- Vendor ledger and vendor portal statement; vendors see only open opportunities and their own applications, orders, bills and statement (other vendors' quotes are never queried)
Limits: no contracts or compliance documents (needs file storage); no purchase orders separate from work orders; no retentions, advances or partial-payment allocation (a bill is paid in full); no vendor ratings; eligibility by category is not enforced (any approved vendor can apply); the person who approves a bill can also post and pay it (a separate payer rule is not enforced).

## Expenses and budgets (first slice done)

Done, verified in the browser plus 16 automated tests:
- Expense vouchers: Submitted, Under review, Approved, Posted, Paid (plus Rejected with reason, Cancelled by the submitter before review); reviewer and approver can never be the submitter; only expense accounts can be charged; others' vouchers stay private
- Posting records expense and payable only; payment (from a bank in the voucher currency) is what moves cash; double post/pay is idempotent
- Budgets keep their original amount; approved transfers (second person must approve, only unspent money, same currency) adjust what is available; committed vs incurred shown separately; warnings at 75/90/100%
- Approving over budget needs the budget.override permission plus a written reason; concurrent approvals cannot jointly overspend
Limits: receipt attachments need file storage (not built); no departments entity yet (budget scope DEPARTMENT is a label); tax on vouchers not split out; project actual-cost views not built; reimbursement to employees is recorded like any payee payment.

## Phase 4: HR (first slice done: employees, attendance, leave)

Done, verified in the browser plus 16 automated tests (10 rules, 6 against the database):
- Employee records with sequential numbers; restricted identity and bank fields only for hr.view_sensitive (audit logs record that they changed, never the values); starting password generated once and shown once; change-password page that signs out all devices
- Attendance: clock in/out, breaks, office or remote, times in the company timezone. Being signed in never counts as working. A forgotten clock-out blocks the next clock-in until HR corrects it with a reason, recorded against the HR user
- Leave: types with yearly allowances (unpaid has no limit), working-day counting (weekends skipped; public holidays not configured yet), overlap and balance checks, approval only by the employee's manager or HR (never self), double approval prevented, cancellation rules

Payroll (done, 12 automated tests): salary structures with effective-dated history; monthly run per currency calculated from structure, unpaid leave (pro rata on basic) and bonus; approval by a different person than the preparer; approved runs frozen by a database trigger; posting makes one balanced journal entry (expense, net payable, tax withheld); salary payment recorded separately against a bank account in the run currency; payslips (own only, after approval). Limits: tax is a flat percentage per employee (no jurisdiction rules, no statutory contributions), no loans/advances/overtime/commission lines yet, adjustments after approval need a later-period correction flow that is not built.

Still to do: shifts and grace rules, overtime, timesheets linked to projects, holidays calendar, documents with expiry, recruitment, performance, onboarding/offboarding, assets assignment.

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
