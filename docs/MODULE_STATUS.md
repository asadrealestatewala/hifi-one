# Module status

Last checked against the code and the test run: 704 automated tests passing, `tsc` and `eslint` clean, production build succeeds. "Done" = works end to end, persisted, permission-checked, tested. "Partial" says what is missing. "Not built" = nothing exists. "Needs outside setup" = built, but cannot be verified without credentials or software that this machine lacks.

Master prompt section in brackets.

## CRM and sales [5]
- **Done:** contacts and organizations (360 page with Flowlu-style tabs, per-section in-place editing, birthday, tax ID, billing and shipping address, social, UTM, custom fields, followers, tags, documents), leads, opportunities board (configurable stages in the database), smart lists, prospecting worklists with CSV import and do-not-contact, campaigns, sales targets with verified calls, lead scoring, quotations from catalog plans, duplicate detection, merge with history preserved, CSV export of contacts, daily goals and levels, lead conversion (links or creates the client, keeps history, creates a draft invoice once).
- **Partial:** attachments exist on contacts and contracts, not on leads; reminders are follow-up dates with in-app counts (no email reminders); exports exist for contacts only; saved views = smart lists for leads.
- **Not built:** proposals separate from quotations, editing pipeline stages in the UI, inbound email inbox (outbound email from a contact works when SMTP is configured).

## Marketing agency operations [6]
- **Done:** service catalog with per-currency prices, clients, retainers as subscriptions, campaigns, content calendar with client approvals, contracts, project profitability.
- **Not built:** brands, deliverables as their own record, ad budgets and actual spend per platform, KPIs per channel, monthly client reports. Live ad metrics need provider accounts and are not faked.

## Projects and tasks [7]
- **Done:** projects, members, Kanban task board, milestones with billing, time entries and cost rates, profitability, client-visible tasks, progress derived from tasks, meetings linked to projects.
- **Not built:** subtasks, dependencies, recurring tasks, calendar and Gantt views, workload view, task comments and files, timesheet approval.

## HR [8]
- **Done:** employee profiles with restricted sensitive fields, attendance with breaks and HR correction, leave with balances and approvals, payroll runs with separation of duties and payslips, assets and assignment, employee documents with expiry, offices and departments.
- **Not built:** shifts, holidays calendar, onboarding and offboarding, training, performance reviews, recruitment, loans.

## Workfolio-style monitoring [9]
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

## Other
- **Meetings (built-in video):** done for up to 8 people, screen sharing, chat, guest links, waiting room. Not verified with real cameras across networks; no recording.
- **UI shell [2, 3]:** design system documented; the sidebar level card is compact and foldable on short screens (see `docs/ERP_AUDIT.md`, finding 1).

## Next concrete actions
1. Verify the sidebar at several window heights while signed in; confirm nothing is clipped or overlapped.
2. Auto-start script for database and server; first browser end-to-end tests (sign-in, invoice, contact edit).
3. Task depth (subtasks, dependencies, recurring), then deliverables and monthly client report.
4. Tighten the content security policy.
