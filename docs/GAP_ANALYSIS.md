# Gap analysis: what the spec asks for and what exists

Status as of the security and production-readiness pass. "Done" means working, persisted, permission-checked and tested. "Partial" says what is missing. "Not built" means nothing exists yet.

The spec ([spec.md](spec.md)) describes a very large platform. The accounting, HR, procurement, portal and delivery foundations are in place and tested. Much of the remaining list is breadth (more screens, more document types) and integrations that need outside accounts or software.

## Summary

| Area | Status |
|---|---|
| Identity, roles, permissions, audit | Done (no UI to edit roles; matrix is read-only in `docs/ROLES.md`) |
| CRM: leads, pipeline, conversion, prospecting worklists | Partial |
| Service catalog and per-currency pricing | Partial |
| Clients, invoices, payments, ledger, statements | Partial |
| Client portal | Partial |
| Projects, tasks, content calendar and approvals | Partial |
| HR: employees, attendance, leave | Partial |
| Payroll, payslips | Partial |
| Expenses and budgets | Done for the core flow |
| Vendors, procurement, vendor portal | Partial |
| Fixed assets, investments | Partial |
| Financial statements, executive dashboard | Partial |
| Notifications | Partial (in-app only) |
| Partnerships and joint ventures | Not built |
| Chat, meetings, WhatsApp, email, calendar, ad platforms, telephony | Not built (need provider accounts) |
| AI assistant | Not built (needs an AI provider and a knowledge base) |
| Employee activity monitoring | Not built, by design (needs a separate desktop agent and written policy) |
| File storage and uploads | Partial (receipts, vendor bill documents, employee documents, content media; no virus scanning) |
| Server-side PDF and document templates | Partial (invoice, receipt, credit note, statement, payslip, voucher; template toggles; Latin text only) |
| Exchange rates and multi-currency reporting | Not built |

## Detail by spec section

### 2 to 5: Interface and navigation
- Done: sidebar grouped by module and filtered by permission, role-specific dashboards for executives, kanban boards with drag and drop (pipeline, tasks), responsive layout, light and dark by system setting.
- Partial: tables have search only on leads; no sorting, pagination, column controls or export anywhere.
- Not built: collapsible sidebar, global search, quick-create menu, favorites and recent records, calendar, Gantt and timeline, keyboard shortcuts, user theme toggle, saved filters and views, skeleton loaders.

### 4: Access control
- Done: permission checks on every page and action (enforced by a test), record-level scoping, reporting hierarchy, separation of duties.
- Partial: temporary access delegation exists in the data model but has no screen.
- Done since the first version: user administration, role and permission editor (custom roles, escalation guards), first-run setup, password reset links, two-step verification.
- Not built: departments and branches management screens, enforcing two-step verification by role, logging of Super Admin read access, self-service password reset by email.

### 6 to 8: CRM and sales
- Done: leads with duplicate detection, notes, activity timeline; configurable stages (seeded; edit in the database); drag-and-drop pipeline; Closed Won conversion that links or creates the client and creates a draft invoice, once; prospecting worklists with CSV import, do-not-contact list, per-row reporting, separate metrics.
- Partial: lead fields (no timezone, campaign, probability, tags, custom fields), conversion (no multi-service plans, commission rules, proposal or contract, automatic portal invitation or invoice delivery).
- Not built: contacts and companies as separate records, Smart Lists, campaigns, call logs and connected-call counting, sales targets and daily dashboards, proposals, lead scoring, AI assistant and campaign knowledge base.

### 9: Service catalog and pricing
- Done: 20 categories, plan cards with a Most Popular highlight, independent price per currency (nothing converted), plan version bump on price changes.
- Not built: screens to create categories, plans, features and add-ons; setup fees, overage, discounts, tax rules, contract terms, internal cost and margin; public pricing page and quotations; price books and regional pricing beyond a price per currency.

### 10 and 11: Client portal and content
- Done: invitation by one-time link, own invoices (issued only), statement, projects with client-visible tasks, content approval with named, timestamped decisions and reasons, pending-approval count.
- Not built: announcements and offers, support requests, campaign and marketing reports, client ratings and reviews, project timeline view, content media attachments, PDF statement download (browser print works), receipts download.

### 12: Projects
- Done: projects, team members, task board, progress derived from tasks, completion blocked while tasks are open, client-visible tasks.
- Not built: Gantt and calendar views, workload view, subtasks, dependencies, milestones and deliverables, comments and files, risks, budget and cost per project, profitability, project creation from a won deal, team templates, resource reallocation tied to a project.

### 13 and 14: Chat and meetings
- Done: in-app notifications.
- Not built: chat, mentions, meeting center, video, screen sharing, transcripts, remote support. These should use established providers; see the spec's own advice.

### 15 to 17: HR, payroll, incentives
- Done: employee records with restricted sensitive fields, attendance with breaks and correction by HR, leave with balances and approvals, payroll runs with separation of duties, locking, posting and payment, payslips.
- Partial: payroll tax is a flat percentage; bonus is entered per run.
- Not built: shifts, grace rules, overtime, timesheets, holiday calendar, employee documents and expiry, recruitment, performance reviews, onboarding and offboarding, loans and advances, commission engine, sales rebates, project success incentives, achievement and leaderboard portal.

### 18 to 20: Accounting and expenses
- Done: chart of accounts (view), double-entry journal with immutable posted lines, invoices, payments with allocation, advances, customer statements, trial balance, profit and loss, balance sheet, cash movement, receivables aging, expense vouchers with approval chain, budgets with controls and transfers.
- Done since the first version: manual journal entries with approval and reversal, chart of accounts editing, period locking, credit notes, refunds of money held on account.
- Not built: year-end closing (profit is not moved to retained earnings), write-offs, discounts, multiple tax rates and tax reports, bank reconciliation and statement import, accounts payable aging, project profitability, departmental expense reports, commission and payroll liability reports, general ledger by account with drill-down, receipt documents, expense voucher printing, document template manager.

### 21 and 22: Vendors, partners
- Done: vendor directory, portal, opportunity to payment workflow, vendor ledger.
- Not built: contracts and compliance documents, purchase orders separate from work orders, retentions and advances, vendor ratings, partnerships and joint ventures, partner and investor portals.

### 23: Assets and investments
- Done: asset register, purchase capitalisation, straight-line depreciation, disposal with gain or loss, assignment history, investments with income recognised versus cash received.
- Not built: other depreciation methods, capitalisation threshold, documents, maintenance, valuation methods.

### 24 and 25: Marketing analytics and success management
- Not built: campaign configuration, ad platform imports, performance reporting, review cycles, client ratings, success incentives.

### 26: Employee monitoring
- Not built, deliberately. Screenshots, app and website usage need a separate signed desktop agent, a written monitoring policy and employee disclosure. A browser cannot and should not do this silently. Attendance and time worked are built; activity tracking is not.

### 27 and 28: Integrations and AI
- Not built: WhatsApp Business, email, calendar, ad platforms, telephony, AI assistants with permission-aware retrieval. Each needs credentials from the provider and setup guides.

### 29 and 30: Dashboards, reports, PDF
- Done: executive dashboard, financial reports reconciled to the ledger.
- Not built: finance, HR, sales and project manager dashboards, report builder, saved and scheduled reports, CSV and Excel export, server-generated PDFs with templates and background jobs.

### 32 to 34: Workflow engine, security, tests
- The "automation engine" is implemented as direct service calls that are idempotent and transactional (invoice posting, payment allocation, conversion, payroll posting). There is no configurable workflow or event queue.
- Security: see `docs/SECURITY.md`. Missing: multi-factor authentication, password reset, file scanning.
- Tests: about 270 automated test cases (about 115 of them are generated per-page and per-action permission checks), including real-database tests for concurrency, idempotency, immutability and access isolation. Not built: end-to-end browser tests, API tests, accessibility audits. Browser checks were done by hand for each feature.

### 36 to 44: Settings and company information
- Done: company profile preloaded with the supplied name, both phone numbers (UANs) and both office addresses, editable with change history; bank accounts (add, deactivate, default per currency, masked numbers).
- Partial: editing an existing bank account's details is not possible (add a new one); no approval step or re-authentication for new bank accounts.
- Not built: offices and branches editor, tax and legal section, numbering formats, payment methods, expense category and approval threshold settings, document and email templates, regional preferences, custom fields and statuses editor, system health page.

### 37: Deliverables
- Done: clean codebase, migrations, seed data, `.env.example`, start, test, build commands, deployment and security docs, role matrix, backup and restore instructions, health check.
- Not built: API documentation (the app uses server actions, not a public API), integration setup guides, background worker docs (no workers yet).

## Suggested order for the next work

1. ~~Manual journal entries, chart of accounts editing, period locking, credit notes and refunds~~ (done). Still needed for accountants: year-end closing, bank reconciliation, tax rates and tax reports, accounts payable aging, write-offs.
2. ~~First-run setup, user and role administration, password reset, multi-factor authentication~~ (done). Still needed: branches and departments screens, enforce two-step verification for sensitive roles.
3. ~~File storage~~ (done for receipts, bill documents, employee documents and content media). Still needed: contracts, a virus scanner, other attachment points (quotes, projects, assets).
4. ~~Server-side PDF and document templates~~ (done for six document types). Still needed: right-to-left languages such as Urdu and Arabic, quotations and contracts, emailing documents, letterheads.
5. **Exchange rates** and consolidated reports.
6. **Service catalog editing, quotations, contracts, subscriptions and renewals**, completing the sales-to-cash flow.
7. **Project depth**: milestones, deliverables, costs, profitability, timeline and calendar views.
8. **Integrations** one at a time (email first, then WhatsApp, then ads), each needing your provider accounts.
9. **Commissions and incentives**, then the AI assistant.
10. A third-party security review before real client data goes in.
