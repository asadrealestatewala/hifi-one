# Module status

Last checked against the code and the test run (2026-10-13): 748 automated tests in 52 files passing, `tsc` and `eslint` clean, production build succeeds. "Done" = works end to end, persisted, permission-checked, tested. "Partial" says what is missing. "Not built" = nothing exists. "Needs outside setup" = built, but cannot be verified without credentials or software that this machine lacks.

Master prompt section in brackets.

## CRM and sales [5]
- **Done:** contacts and organizations (360 page with Flowlu-style tabs, per-section in-place editing, birthday, tax ID, billing and shipping address, social, UTM, custom fields, followers, tags, documents), leads, opportunities board (configurable stages in the database), smart lists, prospecting worklists with CSV import and do-not-contact, campaigns, sales targets with verified calls, lead scoring, quotations from catalog plans, duplicate detection, merge with history preserved, CSV export of contacts, daily goals and levels, lead conversion (links or creates the client, keeps history, creates a draft invoice once).
- **Partial:** attachments exist on contacts and contracts, not on leads; reminders are follow-up dates with in-app counts (no email reminders); exports exist for contacts only; saved views = smart lists for leads.
- **Not built:** proposals separate from quotations, editing pipeline stages in the UI, inbound email inbox (outbound email from a contact works when SMTP is configured).

## Marketing agency operations [6]
- **Content calendar (done, tested at service level):** month calendar and sheet views, filters (search, platform, type, status, assignee, client), KPI cards, Plan-a-post panel (type, caption with count, nine platforms, date, time, client or our own account, assignee), drag a post to another day, creative files on the post, approval workflow kept (client review for clients, internal approval for own posts). Not built: posting to the platforms (needs their API credentials), per-platform captions, analytics.
- **Done:** service catalog with per-currency prices, clients, retainers as subscriptions, campaigns, content calendar with client approvals, contracts, project profitability.
- **Not built:** brands, deliverables as their own record, ad budgets and actual spend per platform, KPIs per channel, monthly client reports. Live ad metrics need provider accounts and are not faked.

## Projects and tasks [7]
- **Done:** projects, members, Kanban task board, milestones with billing, time entries and cost rates, profitability, client-visible tasks, progress derived from top-level tasks, meetings linked to projects, and (tested at the service level; the panel itself not yet checked signed in) a task panel with description, assignee, priority, due date, subtasks (one level, parent cannot finish while any are open), "waits for" dependencies (no loops, a blocked task cannot start or finish), repeat daily/weekly/monthly (completing creates the next one exactly once), internal comments with assignee notification, and files that follow the project's visibility.
- **Not built:** calendar and Gantt views, workload view, timesheet approval, client-visible comments, subtasks on the client portal.

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

## Other
- **Meetings (built-in video):** done for up to 8 people, screen sharing, chat, guest links, waiting room. Not verified with real cameras across networks; no recording.
- **UI shell [2, 3]:** design system documented; the top tab strip and the sidebar level card were removed on request; navigation is the sidebar only (see `docs/ERP_AUDIT.md`, finding 1).

## Cross-cutting gaps (reference audit, 2026-10-13)

Found by comparing with the reference ERP; evidence in `docs/REFERENCE_ERP_AUDIT.md`. These affect every module above.
- **Paging (done 2026-10-13).** Invoices, payments, leads, quotes, expenses, clients, audit logs, my tasks, smart lists, worklist rows and the commission queue page 50 rows at a time with "x–y of N" (`src/lib/paging.ts`, `Pager`). Their KPI cards, the dashboard Assets tab, payments month and advances, and pipeline column totals now come from aggregates over every record. The pipeline board still draws the 500 most recently updated cards and says so when there are more. Not yet paged: notifications (latest 100), lead activity on the lead page (latest 100), exchange-rate history (100), monitoring devices (100).
- **States (done).** `error.tsx` in the staff area, client portal and vendor portal; `not-found.tsx` at the root and in the staff area. One shared `loading.tsx`.
- **Action safety (done for the listed actions).** `ConfirmButton` guards Cancel invoice and commission Void (both require a reason, kept in the audit log), Write off, Cancel voucher, Delete screenshot, Revoke device, Cancel meeting, Archive contacts, Delete department, Delete role. Slide-over forms show "Saving…" and cannot submit twice. Other plain forms still have no pending state.
- **Shared UI under-used.** About 70 pages still hand-roll the header and tables; bring each onto the kit when touched.
- **Notifications (done).** `src/lib/events.ts`: lead assigned, contacts assigned, invoice issued (client portal), payment received (sales owner and client), portal quote accepted or declined (quote author), payroll paid (each employee), vendor bill approved, rejected or paid (vendor portal). Tested in `events.integration.test.ts`. Not checked in a browser.
- **Batch jobs by button.** Commission accrual and subscription billing run on demand; payroll ignores approved commissions.
- **Exports** only for contacts.
- **CI (added, not yet run).** `.github/workflows/ci.yml` runs tsc, eslint, vitest with a Postgres service, and the build. The repository has no remote yet, so it has never run. No browser tests.

## Test coverage gaps
- Service rules are covered. `lead-to-cash.integration.test.ts` runs lead → client → quote → invoice → two payments (one retried) → commissions, checking after every step that debits equal credits and the receivable account equals open invoice balances. Not covered: page rendering and paging in a browser, the confirmation dialog in a browser, portal screens in a browser, drag and drop, mail delivery, video across networks.

## Next concrete actions
1. Check the sidebar and the new row-click behaviour signed in.
2. Auto-start script for database and server; first browser end-to-end tests (sign-in, invoice, contact edit).
3. Check the task panel signed in; then deliverables and monthly client report.
4. Tighten the content security policy.
5. Work through the five tasks at the end of `docs/REFERENCE_ERP_AUDIT.md` (pagination, error states, confirmations, notifications, CI).
