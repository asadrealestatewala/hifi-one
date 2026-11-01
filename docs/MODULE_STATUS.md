# Module status

Last checked against the code and the test run (2026-10-17): 905 automated tests in 72 files passing, `tsc` and `eslint` clean, production build succeeds. "Done" = works end to end, persisted, permission-checked, tested. "Partial" says what is missing. "Not built" = nothing exists. "Needs outside setup" = built, but cannot be verified without credentials or software that this machine lacks.

Master prompt section in brackets.

## CRM and sales [5]
- **Done:** contacts and organizations (360 page with Flowlu-style tabs, per-section in-place editing, birthday, tax ID, billing and shipping address, social, UTM, custom fields, followers, tags, documents), leads, opportunities board (configurable stages in the database), smart lists, prospecting worklists with CSV import and do-not-contact, campaigns, sales targets with verified calls, lead scoring, quotations from catalog plans, duplicate detection, merge with history preserved, CSV export of contacts, daily goals and levels, lead conversion (links or creates the client, keeps history, creates a draft invoice once).
- **Partial:** attachments exist on contacts and contracts, not on leads; reminders are follow-up dates with in-app counts (no email reminders); exports exist for contacts only; saved views = smart lists for leads.
- **Not built:** proposals separate from quotations, editing pipeline stages in the UI. (Company mailboxes with an inbox were added on 2026-11-01; see Mailboxes below.)

## Marketing agency operations [6]
- **Content calendar (done, tested at service level):** month calendar and sheet views, filters (search, platform, type, status, assignee, client), KPI cards, Plan-a-post panel (type, caption with count, nine platforms, date, time, client or our own account, assignee), drag a post to another day, creative files on the post, approval workflow kept (client review for clients, internal approval for own posts). Not built: posting to the platforms (needs their API credentials), per-platform captions, analytics.
- **Done:** service catalog with per-currency prices, clients, retainers as subscriptions, campaigns, content calendar with client approvals, contracts, project profitability.
- **Not built:** brands, deliverables as their own record, ad budgets and actual spend per platform, KPIs per channel, monthly client reports. Live ad metrics need provider accounts and are not faked.

## Projects and tasks [7]
- **Done:** projects, members, Kanban task board, milestones with billing, time entries and cost rates, profitability, client-visible tasks, progress derived from top-level tasks, meetings linked to projects, and (tested at the service level; the panel itself not yet checked signed in) a task panel with description, assignee, priority, due date, subtasks (one level, parent cannot finish while any are open), "waits for" dependencies (no loops, a blocked task cannot start or finish), repeat daily/weekly/monthly (completing creates the next one exactly once), internal comments with assignee notification, and files that follow the project's visibility.
- **Not built:** calendar and Gantt views, workload view, timesheet approval, client-visible comments, subtasks on the client portal.

## Reports, profile, projects and portals (2026-10-14, see `docs/PORTALS_AND_PROJECTS.md`)
- **Report downloads (done, tested):** CSV and PDF for profit and loss, balance sheet, cash movement, receivables and payables aging, sales tax, the leads report and the workforce report, from one route (`/reports/download`) that uses each report's own permission, the same loaders as the screens, and audits every download. Consolidated (multi-currency) reports are not downloadable yet.
- **My Profile (done, checked in browser):** tabs for Overview (official email and contact number with verification, alternate contact, personal email, address, own CNIC, employment details, assets), Work (campaigns, projects, open tasks, reports), Time and leave (attendance, balances, requests, Workfolio today), Pay (payslips, commissions) and Access (sign-in, two-step, roles, sessions).
- **Projects and tasks (done, tested):** Projects and Tasks tabs; task list across projects with assignee, status, priority, project, due and search filters; notifications for being added to a project, task assignment and reassignment, review or done, project status changes, comments and @mentions (members of the project only).
- **Customer and vendor (done, checked in browser):** customer page tabs (overview, billing, projects, campaigns, portal access); vendor page tabs (overview, work, bills and ledger, portal access); client portal Projects with shared tasks and messages to the team; staff can share a comment with the client; vendor portal Profile with editable contact details; Updates pages in both portals.
- **UI consistency pass:** 32 page headers moved to `PageHeader`, 59 inline alert boxes to `Notice`, avatar alt-text bug fixed. A crawl of 98 pages found no server errors, no literal "undefined" or "NaN", one `h1` per page, labelled controls and no horizontal overflow at 375 px on the pages tried.
- **Not built:** chat in the portals, task comments by email. (Support requests, vendor documents with expiry and deliverable approvals were added on 2026-10-17.)

## Staff directory, sign-in and campaigns (2026-10-13, see `docs/STAFF_AND_CAMPAIGNS.md`)
- **Done (tested, and checked in a browser):** staff directory with search, status chips, department and role filters, campaign and project filters, paging, CSV export without CNIC; add, edit, deactivate, mark exited, archive and restore with confirmation and audit; duplicate email, number and name detection; CNIC restricted; verification marks; setup links; sign-in by email or phone with the password; forgot-password page; CMO, COO, HR Coordinator and AI Developer Intern roles; campaigns with codes, shared categories, owner, team, clients, linked projects and leads, archive; campaigns in My tasks; clickable dashboard cards and bars with filters carried to the list; date filters on leads and payments; idempotent `npm run seed:initial` (run twice on the development database: 9 staff, 3 campaigns, no duplicates).
- **Not built:** SMS sending (boundary only, not configured); self-service verification of a phone number; campaign deliverables as their own record; campaign performance metrics beyond leads, wins, projects and tasks; sorting by clicking column headers (the staff and campaign lists sort through a Sort menu).
- **Not verified:** the forgot-password email (needs SMTP).

## HR [8]
- **Done:** employee profiles with restricted sensitive fields, attendance with breaks and HR correction, leave with balances and approvals, payroll runs with separation of duties and payslips, approved commissions and bonuses paid through payroll (done 2026-10-31, tested at data level; run page, payslip and PDF not checked in a browser), assets and assignment, employee documents with expiry, offices and departments.
- **Not built:** shifts, holidays calendar, onboarding and offboarding, training, performance reviews, recruitment, loans.

## Workfolio-style monitoring [9] (called Workfolio in the menu)
- **Browser screen sharing (2026-10-14):** a dock on every screen lets a clocked-in person share their screen; snapshots every policy interval while sharing, same server rules as the agent, a Working now panel for managers, tests in `workfolio.integration.test.ts`. Real capture not exercised in the automated browser; no live video view for managers.
- **Done (verified with a real agent session earlier):** policy with versions and employee consent, visible status, device enrolment and tokens, secure ingestion, activity and app usage with categories, attendance linkage, screenshots with access logging, retention purge, reports.
- **Needs outside setup:** the Windows agent is a console script, not a signed installer; macOS and Linux agents do not exist. No keylogging or covert capture by design.
- **Not built:** screenshot blurring, time-lapse, team comparison charts, low-activity alert rules, XLS export.

## Client portal [10]
- **Done:** one-time invitation, own dashboard, invoices (issued only), statement, projects with client-visible tasks, content approval with named decisions, quotation accept or decline, meetings, isolation tests.
- **Not built:** creative proof markup, revision workflow beyond content approval, campaign reports, support requests, messages, receipts download.

## Vendor portal [11]
- **Done:** vendor directory and approval, opportunities, applications, work orders, bills, payment status, vendor ledger, isolation.
- **Not built:** compliance document expiry, purchase orders separate from work orders, ratings.

## Finance, invoicing, commissions [12]
- **Done:** invoices (live-total editor, up to 20 lines), subscriptions, quotations, payments with allocation, advances and refunds, credit notes, write-offs, tax rates and report, vendor bills, expense vouchers with approval, budgets and transfers, bank reconciliation, manual journals, period lock, year-end close, exchange rates and consolidated reports, commissions and bonuses, statements, PDFs, email sending (needs SMTP).
- **Not built:** discounts, input tax on purchases, FX gain or loss accounting, direct bank feeds, reimbursements as a separate flow.

## Dashboards and reports [13]
- **Home dashboard (done, tested at data level):** hero with period picker (this month, last month, this quarter, this year), collected, overdue and new-lead numbers; quick-action pills (new lead, receive payment, new voucher, mark attendance, leave requests, asset library, my tasks, ask the assistant) shown by role; tabs Overview, Leads & sales, Finance, People, Assets shown by role. Overview has the collected-and-spent chart, a Needs-attention list and arrangeable cards (follow-ups, overdue invoices, vouchers, commissions, attendance not marked, posts today, tasks, meetings, contacts, goals). Leads & sales is the leads report (also at CRM > Leads Report). Finance shows profit and loss for the period from the same ledger loader as Financial reports, position today, and overdue invoices. People: headcount, present, on leave, birthdays, new joiners. Assets: counts, cost, categories.
- **Arrange menu:** each person can reorder menu groups and hide groups or items (Arrange menu at the bottom of the sidebar), saved per person, reset to default. Hiding only tidies the menu; pages still check permission, and are reachable from search.
- **My Space:** My Profile (details, branch, company assets, update contact details, picture), Help & Guide, Account Security, My Attendance, My Leave, My Payroll, My Tasks; a floating Ask button opens the assistant.
- Old widgets (money tiles, KPIs) were replaced by the above; saved layouts keep any card ids that still exist.
- **Done:** personal dashboard (widgets: goals, follow-ups, my tasks, meetings, contacts, money, pipeline, attention, organisation; reorder, hide, save per user), financial reports with quick periods.
- **Not built:** separate dashboards per role beyond permission-filtered widgets, date-range and drill-down on every widget, report builder, XLS export.

## Search, files, data quality [14]
- **Done:** global search (permission-filtered), signed file links with owner-based access, type and size validation, duplicate detection, CSV import for worklists, contact CSV export.
- **Not built:** virus scanning, saved views on every list, general import with error report.

## Notifications [15]
- **Done:** in-app notifications and menu counts. **Needs outside setup:** email notifications (SMTP). **Not built:** scheduler for recurring reminders and deadline alerts.

## Security [17]
- **Done:** server-side guards enforced by a test, org isolation, two-step verification (required per role), session handling, audit log, rate limits on sign-in and guest meeting entry, security headers, backup and restore scripts.
- **Open:** content policy allows inline scripts; no third-party security review; no end-to-end browser tests.

## Automation, client service and growth (2026-10-17, see `docs/AUTOMATION_AND_GROWTH.md`)
- **Scheduled jobs (done, tested):** seven daily jobs (retainer billing drafts, commissions, quotation and contract expiry, invoice reminders, task reminders, monitoring retention, document expiry), idempotent per organization and day, run from `/settings/jobs`, `npm run jobs:run`, `POST /api/jobs/run` (`JOBS_TOKEN`) or the optional in-process scheduler (`JOBS_AUTORUN=1`). Not run unattended on a server yet.
- **Client support and deliverable approvals (done, tested):** portal support requests with staff queue, replies, internal notes and assignment; project deliverables sent to the client for approval or changes, with decision history and notifications. In-app notifications only.
- **Website lead capture (done, tested):** keyed public endpoint with website allow-list, honeypot, rate limits, de-duplication, round robin assignment and UTM tracking; source filter on Leads. Not tried from a real website.
- **Campaign performance (done, tested):** hand-entered spend, cost per lead and win, return on spend per currency, internal and client-safe reports (CSV and PDF). No ad account is connected.
- **Agreements with e-signature (done, tested):** templates, frozen and hashed text, one-time signing link, typed or drawn signature with evidence, decline, PDF; vendor compliance documents with expiry in the staff and vendor screens. A simple electronic signature, not identity-verified; email delivery of the link is not built.
- **Virus scanning (partial):** ClamAV boundary done and tested against a fake daemon; with no daemon configured files are honestly labelled not scanned. Not tried against a real ClamAV.
- **Smaller wins (done, tested):** Ctrl K command palette, sortable columns on clients, invoices and leads, saved views on clients and invoices, project timeline, manager review of logged time.
- **Intentionally not built this round:** going live (hosting, HTTPS, domain) and email, WhatsApp or SMS notifications.

## Other
- **Public website (`/`, `/site`, rebuilt 2026-11-01):** Next.js pages with shared layout and content files (see `docs/SYSTEM_MAP.md`). Done: contact form creates CRM leads; job applications with CV reach HR at `/hr/applications` with notifications; sitemap, robots, canonical links, Open Graph and JSON-LD; dark mode shared with the ERP. Partial: open roles and news posts are edited in `src/app/(site)/_content/` (no admin screen yet); job pages have no JobPosting structured data because the original posting dates are unknown.
- **Meetings (built-in video):** done for up to 8 people, screen sharing, chat, guest links, waiting room. Not verified with real cameras across networks; no recording.
- **UI shell [2, 3]:** design system documented; the top tab strip and the sidebar level card were removed on request; navigation is the sidebar only (see `docs/ERP_AUDIT.md`, finding 1).

## Cross-cutting gaps (reference audit, 2026-10-13)

Found by comparing with the reference ERP; evidence in `docs/REFERENCE_ERP_AUDIT.md`. These affect every module above.
- **Paging (done 2026-10-13).** Invoices, payments, leads, quotes, expenses, clients, audit logs, my tasks, smart lists, worklist rows and the commission queue page 50 rows at a time with "x–y of N" (`src/lib/paging.ts`, `Pager`). Since 2026-10-31 invoices, payments, leads, quotes, expenses and the audit log read their address through `src/lib/list-params.ts` and their filter from `src/lib/lists.ts` (permission and record scope checked there too); the invoice "Outstanding" card is a per-currency `groupBy` sum instead of a scan of open invoices. Their KPI cards, the dashboard Assets tab, payments month and advances, and pipeline column totals now come from aggregates over every record. The pipeline board still draws the 500 most recently updated cards and says so when there are more. Not yet paged: notifications (latest 100), lead activity on the lead page (latest 100), exchange-rate history (100), monitoring devices (100).
- **States (done 2026-10-31).** `error.tsx` and `not-found.tsx` in the staff area, client portal and vendor portal (plus the root not-found). Section skeletons (`PageSkeleton`) for finance, HR, leads, contacts and the pipeline board; the rest of the staff area uses the shared `loading.tsx`. Not checked in a browser.
- **Action safety (done for the listed actions).** `ConfirmButton` guards Cancel invoice and commission Void (both require a reason, kept in the audit log), Write off, Cancel voucher, Delete screenshot, Revoke device, Cancel meeting, Archive contacts, Delete department, Delete role. Slide-over forms (`PanelForm`), file uploads (`FilesPanel`) and the profile photo form show a pending label and cannot submit twice. Other hand-written forms still have no pending state.
- **Shared UI under-used.** About 70 pages still hand-roll the header and tables; bring each onto the kit when touched.
- **Notifications (done).** `src/lib/events.ts`: lead assigned, contacts assigned, invoice issued (client portal), payment received (sales owner and client), portal quote accepted or declined (quote author), payroll paid (each employee), vendor bill approved, rejected or paid (vendor portal). Tested in `events.integration.test.ts`. Not checked in a browser.
- **Batch jobs (done 2026-10-17).** Commission accrual, subscription billing, reminders, expiry and retention now run daily through the scheduled jobs.
- **Exports (done 2026-10-31 for the paged lists).** CSV for contacts, staff, invoices, payments, leads, quotes, expenses and the audit log, each with the filters on screen and the list's permission. The six new ones stream every matching row (no cap, `src/lib/lists.ts`, tested in `lists.integration.test.ts`); contacts and staff still stop at 5,000 rows. Not checked in a browser.
- **CI (added, not yet run).** `.github/workflows/ci.yml` runs tsc, eslint, vitest with a Postgres service, and the build. The repository has no remote yet, so it has never run. No browser tests.

## Test coverage gaps
- Service rules are covered. `lead-to-cash.integration.test.ts` runs lead → client → quote → invoice → two payments (one retried) → commissions, checking after every step that debits equal credits and the receivable account equals open invoice balances. Not covered: page rendering and paging in a browser, the confirmation dialog in a browser, portal screens in a browser, drag and drop, mail delivery, video across networks.

## Next concrete actions
1. Check the sidebar and the new row-click behaviour signed in.
2. Auto-start script for database and server; first browser end-to-end tests (sign-in, invoice, contact edit).
3. Check the task panel signed in; then deliverables and monthly client report.
4. Tighten the content security policy.
5. Work through the five tasks at the end of `docs/REFERENCE_ERP_AUDIT.md` (pagination, error states, confirmations, notifications, CI).

## Mailboxes (added 2026-11-01)

- **Done (tested):** system mailboxes (noreply, billing, hr, onboarding, finance) with one click; personal mailboxes per employee (more than one allowed) and shared team mailboxes with read-and-send or read-only members; /mail inbox with Inbox, Sent and Archived, search, unread counts, conversation view, reply with threading headers, compose (also from a client page); threads linked to the client, CRM contact or employee on the other side; invoices, quotations and statements sent from billing@ with a Sent copy, so client replies thread back; Resend API or SMTP sending; signed Resend inbound webhook at /api/mail/inbound (idempotent, notifies members).
- **Needs outside setup:** the domain verified in Resend for sending, and for receiving an MX record plus the webhook and `RESEND_API_KEY` / `RESEND_WEBHOOK_SECRET` (docs/DEPLOYMENT.md).
- **Not built:** attachments on mailbox emails (names of received attachments are shown, files are not downloaded), HTML rendering of received mail (plain text is shown), drafts, forwarding, bounce/delivery status from Resend events, emailing staff invitations and setup links from onboarding@.
- **Not verified:** a real send and receive through Resend (no hifimarketing.co domain in Resend yet).


## Email templates, onboarding approval and follow-up automation (added 2026-11-01)

- **Done (tested):** branded HTML email layout (logo, company details from Company Settings, pill buttons, code box, progress bar, details card, highlight cards, phone-width layout) with a plain-text twin, used by the onboarding code, approval request, welcome, rejection, task assigned, lead assigned, password reset, invoice, quotation and statement emails; Settings › Email Templates edits the wording with a live desktop/phone preview and a test send, and resets to default. Onboarding: code email, `/onboarding/<token>` (code + password), approvers notified in-app and by email, People & HR › Onboarding Approvals (approve, reject with reason, resend code), sign-in blocked until approved. Follow-up automation (CRM › Follow-up Automation): sequences with day offsets, four ready-made emails (day 0, 2, 5, 10), automatic enrolment of new leads (optionally by website form or tag), manual add/stop from the lead page, sending from the lead owner's mailbox or a chosen one, stop on reply/stage change/won/lost/unsubscribe, three failed tries then stop, send log, lead timeline entries. Task and lead assignment send an email alongside the in-app notification (once per assignment, never to yourself).
- **Needs outside setup:** sending only works once Resend (or SMTP) is connected and the domain verified; replies stop sequences only for mailboxes with receiving set up; the runner needs `JOBS_AUTORUN=1` or a scheduler (docs/DEPLOYMENT.md); `APP_URL` must be the public address so logos and links in emails work.
- **Not built:** per-person email preferences (opting out of task emails), A/B tests and open/click tracking, sending windows (business hours), branching sequences, SMS/WhatsApp steps, HTML editing beyond the structured fields.
- **Not verified:** a real delivery through Resend and how the layout renders in Outlook desktop and Gmail apps (checked in Chromium at desktop and 380px widths only).
