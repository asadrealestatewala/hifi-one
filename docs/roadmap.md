# Roadmap and status

Phases follow section 35 of [spec.md](spec.md).

## Contacts hub, synced with every board (done)

A GoHighLevel/Flowlu-style Contacts screen. One record per person or organization that leads, opportunities, clients, quotes, meetings and activities all point to.
- **Contacts screen:** All / Organizations / Contacts tabs with counts, search (name, email, phone, tag), filters (category, owner, tag, source, archived), sortable columns, avatars, category badges, owner avatars, tags, last activity, page by page; select rows for bulk assign, set category, tag or archive; inline pencil edit of phone and email; Export CSV (formula characters defused).
- **Add panel (slides in from the right):** Contact or Organization toggle; title, first and last name, organization (pick or type a new one, which is created and linked), job title, industry, assignee, followers; any number of phones and emails with types; website, preferred contact, time zone; address; source, campaign, tags; optional sales opportunity (value, currency, service, stage, expected close); notes and custom fields; a live completeness meter with bonus XP; a live duplicate warning while typing (matches any email or phone, and organization names, never revealing records the person cannot see); Save or Save & add another.
- **Contact 360 page:** header with quick Call, Email, WhatsApp, Meeting and Edit; a "synced with" strip; Overview, Activity, Deals, People (for organizations) and Billing tabs; activity composer and timeline; open an opportunity; client account, invoices, outstanding, quotes and subscriptions.
- **Sync rules (tested):** creating a lead creates or links its contact; editing a contact updates its leads (name, email, phone, place, tags, company) and its client (email, phone); editing a lead updates the contact; renaming an organization updates the company on its people's leads; converting a lead makes the contact and its organization Customers and links the client; activities logged on either side appear on both, once; existing leads and clients are given contacts automatically the first time the screen opens (`npm run contacts:backfill` does it on demand).
- **Gamified goals:** daily rings (contacts added, activities logged, overdue follow-ups cleared), XP, five levels, a streak counter, eight badges and a small celebration when all three goals are done.
- 16 new automated tests plus a browser run (list, panel, live meter and duplicate warning, save with redirect and celebration).
Limits: email can be sent and logged from the contact, but there is no inbound inbox and WhatsApp still opens your own app; tags and custom fields are free text; contact-level files are not built. (Merge was added later.)

## Module tabs and video meetings (done)

- Coloured pill tab strip at the top of every module (CRM, Services & Clients, Projects, Finance, People, Vendors, My Workspace, Administration), so the screens of the module you are in are one click away, like the reference design.
- Meetings & Workshops: schedule or start instantly, guest link with waiting room for clients, video, voice, screen sharing, active speaker, chat with transcript, host controls, attendance, project and client links, email and WhatsApp invitations, client portal list. See docs/MEETINGS.md.
Limits: peer-to-peer video for up to 8 people; no recording; a TURN relay is needed for strict networks; real camera, microphone and cross-network calls were not tested on this machine.

## Redesign, speed, CRM depth and activity monitoring (done)

- **Speed:** the slowness came from running the development server, which compiles every page when first opened. In production mode pages answer in about 35 to 140 ms on this machine. Use `npm run serve` (build then start). Also added: loading skeletons so screens respond instantly, and a per-request session cache (one database lookup instead of two per page).
- **New look:** a modern minimal shell. Grouped dropdown sidebar (each module opens to its screens, the current one opens itself, collapses to icons, remembers its state), top bar with search (Ctrl+K), a Create menu, light/dark theme, notifications and profile menu, mobile drawer; refreshed colours, buttons, forms, tables, cards; new login screen.
- **CRM:** Smart Lists (eight built-in lists plus saved, shareable custom filters), Campaigns with leads, wins and cost per lead, Sales Activity with daily and monthly targets, verified connected calls and a team ranking, lead scoring with visible reasons, extra lead fields (city, time zone, preferred contact, expected closing date, campaign, tags, owner), activity logging (calls with outcomes, emails, meetings, follow-ups, proposals), a timeline, and richer opportunity cards (avatar, probability, campaign, follow-up, score, column totals). 13 tests.
- **Monitoring:** see docs/MONITORING.md. Policy and consent per version, browser time tracker with idle detection and breaks, timesheets and correction requests, HR workforce report, logged screenshot access with employee dispute, device enrolment and revocation, desktop agent for Windows, retention purge. 18 tests plus a browser run and an end-to-end agent run.
Limits: the desktop agent is a console program, not a signed installer; no key or click counts from the desktop; contacts and companies are not separate screens; scheduled smart-list exports and AI qualification are not built.

## WhatsApp click-to-chat (done); other integrations decided, not built

- "Message on WhatsApp" buttons on leads (follow-up), sent quotations (follow-up) and issued invoices with a balance (payment reminder). They open the person's own WhatsApp with the message ready; the person presses send. Numbers are cleaned to international form (a leading 0 uses +92 by default). 6 tests. Hifi One cannot tell whether the message was sent.
- **Not built, and why:** the WhatsApp Business API (needs a Meta business account, a verified number and approved message templates), ad platforms such as Meta Ads and Google Ads (need developer tokens and approved app access), telephony and video meetings (need provider accounts). Each should be built against a real account so it can be tested, not guessed. 
- **Employee monitoring** was first held back and has now been built to the brief's own rules (consent, minimal collection, visibility to the employee, logged access). See the section above and docs/MONITORING.md.

## Deployment package and rehearsal (done, Docker untested)

- `scripts/preflight.mjs`: refuses development passwords, short or placeholder secrets, non-production mode, non-https address, unwritable file storage; never prints secrets (9 tests)
- `scripts/smoke-prod.mjs`: checks a running instance's health check, security headers, signed-out redirects, file and calendar privacy, and bad-sign-in resilience
- `Dockerfile`, `docker-compose.yml` (database not published to the network), `.env.production.example`, `.dockerignore`
- Rehearsed on this machine: all migrations from an empty database, production build and start, every smoke check, first-run setup with the setup token, and forced two-step enrolment for the new administrator
Limits: the Docker image and compose file are written but have not been built or run; no HTTPS proxy, real mail server or restore drill was possible here.

## Everyday tools (done)

- Search box in the header and a Search page across clients, leads, invoices, quotations, contracts, projects, vendors and people. Each group appears only if you may view it, with the same record-level scope as the lists (agents find only their own leads, project members only their projects); typed % and _ are taken literally. 12 tests with the calendar and organization tests
- Offices and Departments screen: add and edit branches (type, country, address, time zone, archive), add/rename/delete departments (not while people are in them), assign a person to a branch and department (HR profile kept in step)
- Personal calendar feed (iCalendar): subscribe from Google Calendar, Outlook or Apple Calendar to your task deadlines, leave, lead follow-ups, projects you manage, and contract ends and planned posts if your role can view them. The address holds a 48-character secret, can be replaced (old one dies at once) or switched off, unknown and switched-off addresses are identical 404s, and it is rate limited. Browser-checked
Limits: the feed is read-only and shows all-day entries only; anyone with the link can read it, so it is as private as the link; no saved filters or favourites yet.

## Commissions and the assistant (done; the assistant needs an API key to go live)

- Commissions: a rate per salesperson, applied to the tax-free share of money actually received from clients they converted (lead owner), one commission per payment (database-unique), only on payments after the rate was set; manual bonuses; approval by someone other than the earner books the cost (Dr commissions, Cr payroll payable), payment settles it from a same-currency bank account; void while unapproved; each person has a private statement ("My Commissions"); 3 new permissions. 11 tests
- Assistant: asks in plain language, answers from six read-only data tools (receivables, overdue invoices, month profit, pipeline, projects, own tasks), each re-checked against the person's permissions; refuses forbidden tools; stops runaway loops; logs questions; off and honest ("Not connected") without ANTHROPIC_API_KEY. 8 tests with a scripted model; not exercised against the live service because no key was available
Limits: commission clawback after refunds or write-offs is manual (void before approval, or add a negative adjustment through finance); no tiers, targets or splits between people; the assistant cannot act, summarise documents or answer HR/payroll questions.

## Email (done, needs a mail account to go live)

- SMTP sending (Google Workspace, Microsoft 365, SendGrid, Mailgun, Amazon SES, any SMTP); settings from environment variables; Settings > Email shows status honestly ("Not connected" until configured), tests the connection, sends a test message to yourself, and lists a delivery log
- Email an issued invoice, a sent quotation or a client statement as a PDF from its page, recipient prefilled from the client record
- 9 automated tests (configuration, address injection refused, NOT_CONFIGURED vs SENT vs FAILED, hourly limit, PDF attached and correct, drafts refused, organization separation) plus a browser run showing a test send records "Not sent" when no account is connected
Limits: not verified against a real mail server (no account was available); no inbox or reply tracking; no automatic reminders or receipts by email; invitation and reset links still copied by hand.

## Tax, payables, write-offs and security pass (done)

- Named tax rates (suggested when writing invoices, quotations and subscriptions; invoices still keep their issued percentage); sales tax report by rate and currency from issued invoices, net of tax reversed by credit notes
- Payables aging report for posted unpaid vendor bills (age from posting; vendor bills have no due date yet)
- Write-offs of unpaid invoice balances as bad debt (new finance.writeoff permission, Finance Manager): balance falls like a credit note, cost goes to Bad Debt Expense, tax only reversed when the person ticks the relief box, repeatable by key, safe under simultaneous clicks, own numbering and PDF title
- Two-step verification can be required per role and is enforced on every page, action and download; Security Checklist page; `npm run backup:check`; 14 new tests plus a browser run (a protected role was redirected to setup everywhere except setup, password and health)
Limits: tax paid on purchases is not tracked, so the tax report is tax charged, not tax due; backups are verified for freshness and shape, not restorability.

## Catalog editing, project depth, bank reconciliation and year-end close (done)

About 45 new automated tests plus browser runs (a bank statement imported, suggestions confirmed, a bank fee posted from the statement, a wrong closing balance refused with the exact difference, the right one accepted; a milestone and time entry added to a project).
- Service catalog editing: new categories and plans, edit details, per-currency prices with optional setup fee, features, archive; every change bumps the plan version. Quotations can pick catalog plans per line (price in the quote currency, setup fee as its own line, refused if no price in that currency); each line remembers the plan and version used
- Projects: milestones with due dates and an optional billing amount (cannot be finished with open tasks; a finished milestone creates exactly one draft invoice linked to the project); time logging (no future dates, max 24 hours a day per person even under simultaneous entries); per-member hourly cost rates, frozen onto each time entry; profitability = issued invoices (before tax) minus labour, posted expenses and posted vendor bills, with open vendor orders shown as commitments and budget used; other-currency items listed as excluded. Money figures need the new projects.costs permission
- Bank reconciliation: CSV import (day-first dates, brackets and trailing minus, separate in/out columns), duplicates skipped, unambiguous suggestions only, one-to-one matching with database uniqueness, post bank charges or unrecorded deposits straight from a statement line, opening position for history, reconciliation passes only when the statement balance equals the books after named differences; completed matches cannot be undone. New bank.reconcile permission
- Year-end close: one entry per currency moving the year's profit or loss to Retained Earnings dated 31 December, optional book lock, repeatable without duplicates, refuses an unfinished year, pending manual journals or closing out of order, and flags a year whose profit changed after closing. Balance sheets include closing entries; profit and loss reports leave them out so a closed year still reports its profit
Limits: statements are CSV only (no bank feeds, PDF or OFX); a year-end close cannot be undone from the screen; no timesheet approval, Gantt or calendar; quotes still cannot be edited.

## Quotations, subscriptions and contracts (done)

20 new automated tests plus a browser run (quote created, PDF downloaded, sent, acceptance recorded, converted to a draft invoice with matching figures).
- Quotations: numbered QT-, draft, sent, accepted, declined, expired, invoiced or cancelled; line items with tax; valid-until date that expires open quotes; PDF with its own template settings; staff can record a decision received by email or phone; clients accept or decline in the portal (never see drafts or other clients' quotes); each transition is a single guarded update so a double click or two people cannot both win; converting creates exactly one draft invoice with the same figures
- Subscriptions: monthly, quarterly or annual, with optional end date; "Create due invoices" makes one draft invoice per due period (never issued or posted automatically), is safe to run repeatedly and concurrently, keeps the day of month steady across short months, and catches up missed periods; pause skips missed periods on resume; cancel stops billing
- Contracts: title, client, term, value, renewal reminder; draft, active, expired, terminated; active contracts expire after their end date; the signed document and attachments are stored privately with the same access rules as other files
- Dashboard flags: contracts ending within 30 days and subscriptions due for billing
- New permissions: quotes.view/manage, contracts.view/manage, subscriptions.manage (Sales roles, Finance Manager, CEO, Accountant as appropriate); run `npm run roles:sync` after upgrading
Limits: quotes cannot be edited after saving (cancel and recreate); not built from catalog plans yet; no e-signature; no emailing of quotes or reminders; subscriptions are one fixed amount per period (no usage billing or price changes mid-term).

## Exchange rates and consolidated reports (done)

- Base currency per organization (USD by default; changeable only before any rate exists) and an append-only rate history (a correction is a newer entry for the same date), with who entered it
- Exchange Rates screen; the new `fx.manage` permission goes to Super Admin and Finance Manager; viewing needs `reports.view`
- Consolidated Profit & Loss and Balance Sheet in the base currency, converting each currency at the rate in force on the report date; a currency without a rate is listed as not included and is never treated as 1:1; conversion rounding is shown on its own line and a real imbalance is flagged
- 12 automated tests (rate lookup by date, corrections, validation, organization separation, base currency lock, merge across currencies, missing rates, balance after conversion) plus a browser run
- `npm run roles:sync` registers new permissions and gives them to Super Admin after an upgrade
Limits: this is a presentation conversion at one rate, not accounting revaluation; no realised or unrealised exchange gains or losses are booked; rates are typed in, not fetched; the dashboard and receivables aging stay per currency.

## File storage, server-side PDFs and document templates (done)

Done, 48 automated tests plus a browser run (an invoice PDF downloaded and inspected visually; a receipt uploaded to an expense voucher; the download worked only with the right link; a missing or tampered link gave 404; an HTML file renamed .pdf was refused):
- Private file storage with a swappable provider; validation by content, macro and program checks, 15 MB limit; per-record access rules (expense receipts, vendor bill documents, content media, employee documents with category and expiry); signed 10-minute download links bound to the person; soft delete with retention purge; audit entries
- Employee self-service "My Documents"; dashboard flag for expired or soon-expiring employee documents
- PDFs for invoices, receipts (from recorded payments), credit notes, customer statements, payslips and expense vouchers, with portal versions for clients; multi-page, page numbers, consistent number formats
- Document templates: choose which company details, bank instructions, footer text and accent colour appear; preview with sample figures; issued invoices keep the details and template they were issued with
- Every route handler now needs a caller check (extended authorization test)
Limits: Latin characters only in PDFs (other scripts show as ? with a notice; Urdu/Arabic needs a different renderer); no virus scanning; no emailing of documents; quotations and contracts not built; file attachments exist on four record types only.

## First-run setup, user and role administration, password reset, two-step verification (done)

Done, 32 automated tests (9 against RFC 6238 vectors) plus a full browser run on a brand-new empty database: the home page redirected to /setup, setup created the installation and the page then closed; two-step verification was turned on with a real QR code and key, sign-in stopped at the code page, a wrong code and a recovery code behaved correctly, and the dashboard was unreachable without a code; a staff user set their own password from a one-time link, the old link died, and the new accountant could not open Users, Roles or Setup; a custom role was created.
- /setup: only on a system with no users; production also needs SETUP_TOKEN; all-or-nothing transaction; two setups at once create exactly one installation; audited
- Two-step verification (authenticator app): encrypted secret, replay-proof codes, 8 one-time recovery codes, password needed to disable, administrators can reset
- Password reset links; forced change of starting passwords for staff created by HR
- Users screen: create, roles, deactivate, reset link, reset two-step. Roles screen: custom roles and a permission editor grouped by module
- Safety rules in services and tested: always one active Super Admin (even under simultaneous changes), only Super Admins touch Super Admins, no granting or removing permissions you do not hold, sessions revoked on any access change
Limits: no email delivery; two-step not enforced by role; no branches and departments screens; no self-service forgot-password; if the only Super Admin is locked out, recovery is by database script or backup.

## Accountant essentials (done)

Done, 14 database tests plus a browser run (entry prepared by one person and posted by another; credit note reduced a balance from 3,410.93 less 1,000 paid to 2,000 due; closing the books blocked a backdated entry and a future close):
- Manual journal entries: prepared, then approved and posted by a different person; unbalanced entries, control accounts (receivables, payables, customer advances) and inactive accounts refused; rejection needs a reason; reversal of a posted manual entry (once, with reason)
- Chart of accounts: add accounts (unique valid codes), rename, deactivate only when empty, not system accounts, not bank-linked; code and type never change
- Period lock: every module's posting is refused on or before the closing date (invoices, payments, payroll, depreciation...); cannot close a period that has not ended; reopening needs a reason; history kept
- Credit notes against open invoices: revenue and tax reversed in proportion, balance and aging reduced, payments settle only what is still owed, fully credited invoices show CREDITED; idempotent and safe under simultaneous requests
- Refunds of money held on account, never above what the client holds
- Bug found and fixed: simultaneous duplicate submissions of a payment (a double click) raised an error instead of returning the first payment; payment, credit note and refund now take their lock before checking for a duplicate
Limits: no year-end close (profit stays in revenue and expense accounts); credit notes cannot refund an already-paid invoice (use a refund of the resulting advance only if the payment was left as an advance); no recurring or reversing-on-date entries; no attachments on journals (needs file storage).

## Production readiness pass (done)

- Security headers and strict CSP/HSTS in production; sign-in and invitation rate limiting (proved in the browser: blocked on the 9th attempt); dependency audit clean (two transitive packages pinned); demo seed refuses to run in production; `/api/health`
- Authorization coverage test: fails if any internal page lacks a permission check or any server action lacks a caller check (proved to fail on an unguarded page)
- Production build passes; `next start` smoke-tested (headers, health, redirects, sign-in and sign-out under the CSP, no console errors)
- Docs: DEPLOYMENT, SECURITY, ROLES (generated), GAP_ANALYSIS; local backup and restore scripts (production uses pg_dump, documented)
- Not done: first-run production setup command, MFA, password reset, third-party security review (see docs/SECURITY.md)

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

## Notifications, content calendar and prospecting worklists (first slice done)

Done, 28 automated tests (13 pure, 15 against the database) plus a browser run (CSV import with a bad email, an in-file duplicate and an Urdu name; a lead made from a row; content created, blocked from self-review, approved-for-review by a second person, then a client requested changes and staff were notified):
- Notifications: in-app bell with unread count and a notifications page; retried events notify once (dedupe key); users can only mark their own as read; wired to leave, expense vouchers, vendor bills, task assignment, budget transfers and content approvals
- Content calendar: platforms, versions of the copy, workflow Draft, Internal review, Client review, Changes requested, Approved, Scheduled, Published; copy locked while with the client; internal review must be done by someone other than the author; only the client can approve or request changes (reason required), recorded against the named client user; another client's items look like they do not exist; drafts never reach the portal; Published only after an authorized person confirms it
- Prospecting worklists kept apart from the CRM: CSV import (quotes, semicolons, BOM, Urdu), invalid and duplicate rows skipped with a row-by-row reason, CRM duplicates flagged, do-not-contact list that also blocks existing rows and conversion, rows convert to real leads once (even under concurrent clicks), and two separate metrics: records processed vs CRM leads generated
Limits: no email, WhatsApp or push delivery and no notification preferences; the client portal has no bell (it shows a pending count on the Content link); content has no media/file attachments (needs file storage), no calendar month grid (board view only), no auto-publishing to platforms; worklists accept CSV only (not XLSX), have no field-mapping screen (headers are matched by name) and no import history screen or export; clients cannot comment without making a decision.

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

## Interactive screens, contact merge and personal dashboard (done)

Done, with browser checks and new tests (merge: 4, dashboard layout: 3):
- Invoices, Clients, Projects, Quotations, Vendors and Employees share one pattern: KPI strip, status chips with counts, search, a richer table, and a slide-over "New ..." panel that reopens with the message if a save is refused. Filters live in the address, so a view can be bookmarked or shared.
- Invoices and quotations: a line editor with live subtotal, tax and total, tax presets, and the client's currency filled in on choosing a client. The server still does the real arithmetic (a 2 x 150.50 line at 5% tax matched exactly: 316.05). Up to 20 lines per document (was 6); quotations keep the catalog-plan picker per line.
- Contact merge (managers only): search for the duplicate, preview what moves, confirm. Leads, the client link, timeline, people of an organization, tags, followers, phones and emails move over; blanks are filled; the duplicate is archived with a note, not deleted. Refused when each record has its own client account, when kinds differ, or across organizations.
- Email from a contact: send to an address already on the record, logged on the timeline only when the mail server accepted it. With no mail account the attempt is listed as "not sent". The contact's email history shows mail sent from here; mail about invoices and statements to the same address is shown only to people with finance access.
- Dashboard: widgets (goals, follow-ups, my tasks, meetings, recent contacts, money, pipeline and operations, needs attention, organisation) that each person can drag or move with arrows, hide and restore, and reset. Saved per user; a widget a person has no permission for is never shown or stored.

Known limits: no inbound email (a true inbox needs IMAP or a provider webhook); WhatsApp opens are not logged as activity because a click cannot show a message was sent; drag and drop was not scripted in the browser test (arrows, hide, save, reload and reset were); the other list screens (leads, payments, contracts, subscriptions, procurement and HR sub-pages) still use the older layout.

## Gamified menu, faster feel, remaining list screens (done)

- Sidebar: each module has a coloured icon chip that lights up when you are inside it; a red count badge shows what waits for you (follow-ups due under CRM, your overdue tasks under Projects); the active page gets an accent bar; items nudge on hover. (The level card at the bottom and the top pill tab strip were later removed at the owner's request; see docs/DECISIONS.md, 18.) The numbers are cached for 20 seconds per person so the menu adds no noticeable cost.
- Speed: measured in production mode, pages render on the server in about 30 to 100 ms (the dashboard went from about 190 to about 100 ms by loading its widgets in parallel). A thin progress bar now starts the instant you click an in-app link and finishes when the page arrives, and the loading skeleton shows straight away. Most of the "slow" feeling comes from running `npm run dev`, which compiles each page the first time it is opened; use `npm run serve` (build plus production server) for day-to-day use.
- Contracts, Subscriptions, Payments and Leads now use the same KPI strip, chips, search and slide-over panels as the other list screens.

Known limits: nav numbers can lag up to 20 seconds; the older layout remains on the detail pages, HR sub-pages, procurement and finance reports.

## Detail pages and reports (done)

Invoice (balance due card with settled bar, tidy actions, credit note and write-off folded under one button), lead (pipeline stage stepper, quick call, email and contact links), contract (term progress bar), client (avatar header, link to its contact), quotation and project (status badges, progress colours), and Financial reports (report chips and quick periods: this month, last month, this quarter, year to date). The contract page had no contract in the demo data, so it was type-checked and built but not opened with real data.

## Contact page like Flowlu, edited section by section (done)

- The contact page now has the tabs Main, Opportunities, People (organizations), Projects, Tasks, Documents, Payments, Events, Email and Calls. Projects and tasks come from the contact's client account; Documents are files stored on the contact with the same visibility as the contact; Events lists meetings; Calls lists logged calls with their outcome.
- Main shows a summary strip (website, birthday, industry, category, owner) and a column of blocks: Contacts (emails and phones with type, WhatsApp link), Organization (card with email and call buttons), Followers, Description, Tags, Addresses (billing and shipping, with Copy billing address), Details (name parts, initials, full name, job title, tax ID), More (social profiles, source, UTM tags) and Custom fields. Next to it is the activity composer and timeline.
- Every block has its own pencil: it turns into a small form that saves on its own, so a customer's details are added or amended in place. New fields: birthday, tax ID, shipping address, social profiles, UTM tags. The Add contact and full Edit panels carry them too. Merge now carries them over.
- Tests: 5 new (profile fields kept across edits, birthday validation, organization link by name, file access for contacts).
- Also: consistent headings, tinted table headers and row highlight on every list and report page (70 files), KPI cards on Attendance and Budgets.

Known limits: documents are not virus-scanned (as elsewhere); the Payments tab shows the client's invoices, quotations and subscriptions, not a separate payment list; Projects and Tasks need a client account on the contact.

## Decisions

- Brand colour follows the supplied red H logo; the spec's blue/purple can be added as a theme if wanted.
- Local database must be UTF-8 (fixed after a WIN1252 default broke non-Latin text). Local database is PostgreSQL 17 from the `embedded-postgres` package (no Docker here). Production should use a managed PostgreSQL.
- Bank details and company profile edits never rewrite issued documents; documents will store snapshots (built with invoicing in Phase 3).
