# Reports, profile, projects and portals

Feature reference for the work added on 2026-10-14. The code is the source of truth; update this file in the same change when it drifts.

## Report downloads

`/reports/download?report=<key>&format=csv|pdf&from=YYYY-MM-DD&to=YYYY-MM-DD` (`src/app/(app)/reports/download/route.ts`).

| Key | Report | Permission |
|---|---|---|
| `pl`, `bs`, `cash`, `aging`, `ap`, `tax` | Profit and loss, balance sheet, cash and bank, receivables aging, payables aging, sales tax | `reports.view` |
| `leads` | Leads report (only leads the person may see) | `crm.view` |
| `workforce` | Workfolio time and activity (logged as a report view for each person) | `monitoring.view_team` |

Each report is built by `src/lib/report-tables.ts` from the same loaders as its screen, then written as CSV (spreadsheet formulas defused) or PDF (`reportPdf` in `src/lib/pdf.ts`, letterhead from company settings). Every download is audited (`report.download`). `DownloadButtons` (`src/components/ui.tsx`) adds the links.

## Workfolio

See `docs/MONITORING.md`. In short: the menu entries are Workfolio (HR and managers) and My Workfolio (everyone); a dock on every screen lets a clocked-in person share their screen, saves a snapshot every policy interval while sharing, and shows a red indicator and a countdown. Managers see **Working now** (clocked in, on break, no signal, last snapshot) but no live video. The interval is set in Settings > Monitoring Policy (5 to 120 minutes).

## My Profile

`/me/profile` has tabs: Overview, Work, Time and leave, Pay (only for people with `self.payslip` or `commissions.own`) and Access. Everything shown belongs to the signed-in person; the CNIC is their own. HR edits the record on the staff page; people update their own alternate contact, personal email, address and picture.

## Projects and tasks

- `/projects` (Projects tab) and `/projects?view=tasks` (Tasks tab: assigned to me or everyone, status, priority, project, due, search; 50 per page).
- Notifications (`src/lib/events.ts`, tested in `project-events.integration.test.ts`): added to a project; task assigned or reassigned; task sent to review or finished (to the manager and creator); project status changed (to the team); comments (assignee, creator, manager, earlier commenters); `@Name` mentions (members of the project only).
- A comment on a client-visible task can be shared with the client (checkbox). Client messages appear on the task marked "client".

## Customers and vendors

- Customer page tabs: Overview, Billing (statement, quotations, contracts), Projects, Campaigns, Portal access (people who can sign in, last sign-in).
- Vendor page tabs: Overview, Work (work orders and applications), Bills and ledger, Portal access.
- Client portal: Overview, Projects (progress, shared tasks, messages to the team), Content, Quotations, Meetings, Updates (notifications), Statement. Everything is scoped by the signed-in client; nothing takes a client id from the address.
- Vendor portal: Opportunities, Work and bills, Statement, Profile (edit email and phone only), Updates.
- Notifications sent to portal users: invoice issued, payment received, shared task comment (client); vendor bill approved, rejected or paid (vendor).

## Not built

Support tickets or chat in the portals; vendor document uploads and compliance expiry; a live video view of employees; downloads of the consolidated multi-currency reports.
