# Automation, client service and growth (2026-10-17)

What was added in this round, how it works, who may use it, and what it does not do. Code wins over this file where they differ.
Left out on request: going live (hosting, domain, HTTPS) and email/WhatsApp/SMS notifications. Notifications are in-app only; every place that
would send a message says "not configured" or hands the person a link to copy.

## 1. Scheduled jobs (`src/lib/jobs.ts`)

| Key | What it does each day |
|---|---|
| `subscription_billing` | Draft invoices for retainers that are due, then tells finance to review and issue them |
| `commission_accrual` | Commissions for payments received (once per payment), then tells the approvers |
| `expiry_sweep` | Sent quotations past valid-until and active contracts past their end date become expired |
| `invoice_reminders` | Weekly overdue reminder to finance and the client; heads-up to the client three days before the due date |
| `task_reminders` | Tasks due tomorrow and tasks that became overdue today |
| `monitoring_purge` | Workfolio screenshots and activity past the policy's retention |
| `document_expiry` | Vendor and employee documents expiring within 30 days, and ones already expired |

- **Idempotent.** One `JobRun` row per organization, job and day. A finished day is skipped ("Already ran today") unless forced. A partial unique index allows one `RUNNING` row per organization and job, so two schedulers cannot run the same job at once; a run stuck for more than 30 minutes is marked failed and may be retried. A failure in one job or organization never stops the others.
- **Three ways to run.** The Scheduled Jobs page (`/settings/jobs`, permission `jobs.run`) has Run now buttons and shows the last runs; `npm run jobs:run` for an operating-system scheduler; `POST /api/jobs/run` with `Authorization: Bearer <JOBS_TOKEN>` for a hosting platform's scheduler. The endpoint is off (404) unless `JOBS_TOKEN` is set to at least 24 characters, compares in constant time and rate limits wrong guesses.
- **Optional built-in scheduler.** Set `JOBS_AUTORUN=1` and the server checks every 15 minutes whether today's jobs have run and runs the missing ones (`src/instrumentation.ts`). Leave it off when an external scheduler is used.
- Not checked: a real unattended day on a server.

## 2. Client support and deliverable approvals

- **Support requests (`src/lib/support.ts`).** A client opens a request in the portal (`/portal/support`), staff work it in `/support` (permissions `support.view`, `support.manage`): assign, reply, mark waiting on client, resolve, reopen. The thread is one table; replies from staff are visible to the client, internal notes are not. Each side is notified of the other's reply (in-app). Clients see only their own requests, derived from the session.
- **Deliverables (`src/lib/deliverables.ts`).** Staff add a deliverable to a project and send it for approval (file or link plus notes). The client sees it under Approvals (`/portal/approvals`) and approves or asks for changes with a comment; each decision is kept with who and when, and the project team is notified. When changes are requested, editing the deliverable returns it to draft as a new version, and it must be sent again.

## 3. Website lead capture (`src/lib/lead-capture.ts`, `POST /api/leads/capture`)

- Staff create a **lead source** (`/settings/lead-sources`, `leadsources.manage`): a name, optional campaign, assignment (one person or round robin among chosen staff), and the websites allowed to use it. The key is shown **once** and only its hash is stored; it can be replaced at any time. The page gives a paste-in code snippet.
- The endpoint accepts JSON or a form with the key in `x-lead-key`. It checks the allowed websites (the `Origin` header), ignores a hidden honeypot field, limits submissions per address and per key, caps the size, de-duplicates by email or phone (a repeat adds an activity to the existing lead), assigns round robin under a row lock so simultaneous submissions rotate fairly, and stores the UTM fields and landing page. It gives the same answer for a new and a repeated lead so it cannot be used to look people up.
- Leads show their source; `/leads?source=<id>` filters by it.
- Not checked: a real website form, CORS behaviour in browsers other than by test.

## 4. Campaign performance and client reports (`src/lib/campaign-performance.ts`)

- Spend is entered by hand on the campaign page (date, platform, amount and currency, optional impressions, clicks, results). **No advertising account is connected** and the screen says so.
- Figures per currency, never mixed: spend, leads, won leads, conversion, cost per lead, cost per win, won deal value, return on spend, click-through rate. Leads and wins come from the CRM.
- Reports: `campaign` (internal, with spend) and `campaign_client` (for the client: leads and results only, never spend, budget, or cost), as CSV and PDF through `/reports/download?report=campaign&campaign=<id>`.

## 5. Agreements with electronic signature (`src/lib/agreements.ts`)

- **Templates** (kind, name, text with placeholders `{{company_name}} {{client_name}} {{vendor_name}} {{date}} {{signer_name}} {{amount}} {{start_date}} {{end_date}}`); unknown placeholders are rejected.
- **Agreement** (`AGR-0001`…) for one client or one vendor, from a template or typed text; editable only as a draft. Anything left in `{{braces}}` blocks sending.
- **Send** freezes the text, stores its SHA-256, and issues a one-time link (`/sign/<token>`, 14 days). Only the hash of the token is stored; the link is shown once and the person copies it (email is not connected). Issuing a new link kills the old one.
- **Signing** needs no account: read, tick the box, type the full name, optionally draw a signature (PNG, validated). It records the time, network address, browser and the fingerprint of the text; the link dies with the first signature, even when two people submit at once. If the stored text no longer matches the fingerprint it refuses. The signer can instead decline with a reason. The creator is notified either way.
- The PDF (`/agreements/<id>/pdf`) carries the text and, once signed, the signature record. This is a **simple electronic signature**: it shows who held the link and what they agreed to, not their legal identity. Whether it is enough for a given contract is a legal question for the business.
- Permissions: `contracts.view` to read and download, `contracts.manage` to write, send and void. The older Contracts page (dates, value, renewal) is unchanged.
- **Vendor documents.** A Documents tab on the vendor page and a Documents page in the vendor portal, using the shared files service (owner type `VENDOR_DOC`, category and expiry). The vendor's own people may add and see them; staff see them with `vendors.view` and manage with `vendors.manage`. The `document_expiry` job warns about expiring ones.

## 6. Safety and quality

- **Virus scanning (`src/lib/virus-scan.ts`).** With `CLAMAV_HOST` (and optional `CLAMAV_PORT`, default 3310) set, every upload is streamed to a ClamAV daemon before it is stored: infected files are refused and nothing is saved, and if the daemon cannot be reached the upload is refused rather than stored unchecked. Clean files are marked `CLEAN` and show "virus-checked". With no daemon configured, files are saved as `UNSCANNED` and the screen says "not virus-scanned". Tested against a fake daemon speaking the real protocol; **not tested against a real ClamAV**.
- **Headers.** Added `X-Permitted-Cross-Domain-Policies`, `X-DNS-Prefetch-Control`; signing pages are never cached or indexed (`no-store`, `noindex`).
- **Smoke checks.** `node scripts/smoke-prod.mjs <url> [--dev]` now also checks the jobs endpoint, lead capture, a made-up signing link, and that the new staff and portal pages send a signed-out visitor to sign-in.
- **Backups.** Uploaded files and the database are separate: back up both (`docs/DEPLOYMENT.md`). The signed agreements, lead sources and job history are in the database.

## 7. Smaller wins

- **Ctrl K / Cmd K command palette** over the pages the person may open and the Create actions, with "Search everything for…". Built from the server-filtered navigation, so it never offers a page the person could not open.
- **Sortable columns** (`SortTh`, `src/lib/sort.ts`) on clients, invoices and leads. The address names the column; only whitelisted columns are accepted; `id` is the tiebreak so paging is stable; empty values sort last.
- **Saved views** (`src/lib/saved-views.ts`) for clients and invoices: a named set of filters and sort, personal, ten per list, kept in `UserPreference`. A view stores only whitelisted filters and never grants access.
- **Project timeline** (`src/lib/project-timeline.ts`): a Gantt-style bar per task from creation to due date, the milestone dates, the deadline and today's line. Tasks with no due date are listed apart.
- **Time review.** A manager (`projects.manage`) approves or rejects logged time with a reason, never their own; the person is notified; approved time can only be removed by a manager. This is a review step: project profitability still counts every entry.

## New permissions

`jobs.run`, `support.view`, `support.manage`, `leadsources.manage` (88 permissions in total; see `docs/ROLES.md`). Agreements reuse `contracts.view` and `contracts.manage`.

## New environment variables

| Name | Purpose |
|---|---|
| `JOBS_TOKEN` | Enables `POST /api/jobs/run` (at least 24 characters) |
| `JOBS_AUTORUN` | `1` starts the in-process scheduler (checks every 15 minutes) |
| `CLAMAV_HOST`, `CLAMAV_PORT` | Turns on virus scanning of uploads |

## Verified and not verified

Verified: `tsc`, `eslint`, the whole vitest suite (every new rule has a test, including denied access), the guard test over every new page, action and route. Not verified: real SMTP/WhatsApp (left out), real ClamAV, a real website form, screens in other browsers or on a phone, drawing a signature with a touch screen, an unattended scheduled day.
