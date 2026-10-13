# Data flows

How data moves between modules. Entities, canonical records and constraints are in `docs/DATA_MODEL.md`; this file covers ownership of each fact, the workflows that cross modules, and the contracts every change must keep. Verified against `src/lib` on 2026-10-13; "gap" lines are confirmed absences.

## Ownership: one writer per fact

| Fact | Owner (only place that writes it) | Readers |
|---|---|---|
| Person or company identity | `Contact` via `src/lib/crm-contacts.ts` (sync pushes name, email, phone, place to linked lead and client) | CRM, clients, meetings, search |
| Sales stage and follow-ups | `Lead` via `src/lib/leads.ts`, `crm.ts` | pipeline, smart lists, leads report, dashboard |
| Paying customer | `Client` (created or linked by `convertLead`, `src/lib/conversion.ts`) | quotes, invoices, subscriptions, contracts, projects, portal |
| Money | `JournalEntry`/`JournalLine`, only through `postJournal` (`src/lib/accounting.ts:28`) with an idempotency key | ledger, reports, statements, dashboard finance tab |
| Invoice balance | `Invoice.amountPaid`, `creditedAmount` updated inside the same transaction as the journal (`recordPayment`, `issueCreditNote`, `writeOffInvoice`) | invoices list, statements, portal, aging |
| Worked time | `AttendanceRecord` + `BreakRecord` (`src/lib/hr.ts`); project time is `TimeEntry` (`project-finance.ts`) | payroll, monitoring reports, profitability |
| Project progress | derived from top-level tasks (`task-rules.ts`), never typed | projects list, portal |
| Content state | `ContentItem` + `ContentVersion` + `ContentEvent` (`src/lib/content.ts`) | calendar, portal approvals |
| Dashboard numbers | the same loaders as the reports (`dashboard-home.ts`) | home dashboard |
| Staff record, sign-in identity | `src/lib/staff.ts` (`User` + `EmployeeProfile`) | directory, sign-in, assignments, payroll |
| Campaign, its team, clients and project links | `src/lib/campaigns.ts` | campaigns, My tasks, staff directory filter, projects, leads, dashboard |

Rule: a screen never computes a stored total itself, and a total is never copied into a second table unless it is a cache updated in the same transaction as its source.

## Cross-module workflows

### Lead to cash
1. Lead created → `ensureContactForLead` links or creates the `Contact`.
2. `convertLead` (`conversion.ts`) links or creates the `Client`, marks contact and organization as customers, keeps history, creates one draft invoice.
3. Quote (`sales.ts createQuote`) → `decideQuote` (staff or portal) → `convertQuoteToInvoice` once (`Quote.invoiceId`).
4. `issueInvoice` posts Dr receivable / Cr revenue (`sourceType INVOICE`); `cancelInvoice` posts a reversal.
5. `recordPayment` allocates FIFO (`PaymentAllocation`), excess becomes an advance; row locks and idempotency key.
6. Credit notes and write-offs reduce the balance by reversal entries (`bookkeeping.ts`).
7. Commissions: `accrueCommissions` (`commissions.ts:37`) creates `CommissionEntry` per allocation (unique `allocationId`), then approve → pay, each posting a journal.
- **Gap:** step 7 runs from a button, not when a payment is recorded. Payroll does not include approved commissions.
- Notifications (`src/lib/events.ts`): lead assigned; portal quote decision to the quote author; invoice issued to client portal users; payment received to the sales owner and client portal users.

### Retainers
`createSubscription` → `generateDueInvoices` (unique `SubscriptionInvoice` per period, so a period bills once). **Gap:** no scheduler; someone must run it.

### Projects
Project → members with cost rates → tasks (subtasks, dependencies, recurrence) → `TimeEntry` → `projectProfitability`; milestones can be billed (`billMilestone`) into invoices. Client-visible tasks show in the portal. Task assignment and comments notify (`src/app/(app)/projects/actions.ts`).

### Content
`createContent` → versions on every wording change → `transition` through review: client posts need client approval in the portal, own posts need internal approval → marked published by a person (no platform posting). Notifications on review steps (`content.ts`).

### Spend
Expense voucher: submit → review → approve (budget check, `budgetStatus`) → `postVoucher` (Dr expense / Cr payable) → `payVoucher`. Vendor: opportunity → application → work order → delivery → bill → approve → `postBill` → `payBill`; vendor ledger from the books (`vendorLedger`). Asset purchases are separate (`assets.ts`, `sourceType ASSET_PURCHASE`), not created from vouchers.

### People
Attendance and leave (balances, approvals) → payroll run: create → bonus → approve (separation of duties) → `postRun` → `payRun` → payslips; each employee is notified when the run is paid. Vendor portal users are notified when a bill is approved, rejected or paid. Monitoring is consent-gated and separate (`docs/MONITORING.md`).

### Staff and campaigns
Staff are created by `createStaff` (no password; setup link) and change status through `setStaffStatus` / `setStaffArchived`, which stop sign-in and keep history. Campaign membership (`setCampaignTeam`) notifies people added and shows the campaign in their My tasks. Leads and projects point to a campaign; `campaignMetrics` counts them from those rows, so nothing is copied or double-counted. Details: `docs/STAFF_AND_CAMPAIGNS.md`.

### Period controls
`PeriodLock` blocks posting into closed periods; year-end close posts `YEAR_END_CLOSE` entries excluded from period P&L.

## Contracts every change keeps

1. **Transactions.** A business event that touches more than one row runs in one `db.$transaction` inside a `src/lib` service. Pages and actions do not write multi-row changes themselves.
2. **Ledger.** Money moves only through `postJournal` with a deterministic idempotency key. Posted lines are immutable (DB trigger); corrections are reversals, credit notes or adjustments.
3. **Currency.** Every amount carries its currency; totals are per currency; only consolidated reports convert using `ExchangeRate`.
4. **Organization scope.** Every query filters by `organizationId`; record scope helpers apply for own-scope roles; portals never take a client or vendor id from the request.
5. **Audit.** Every sensitive change calls `audit(...)` (`src/lib/auth.ts:213`) with before/after where it matters.
6. **Notify.** When an event creates work or news for someone else, notify them after the service commits: add a function to `src/lib/events.ts` (recipients, wording, `dedupeKey`), test it in `events.integration.test.ts`, and call it from the action. Low-level helpers are in `src/lib/notifications.ts`.
7. **Derived numbers.** Progress, profitability, goals, balances and dashboard figures are computed from source rows, not typed in.
8. **Lists and KPIs.** Lists page with `paging()` (`src/lib/paging.ts`); KPIs come from aggregates (`count`, `groupBy`, `aggregate`), never from a page of rows or a capped `findMany`.

## External integration contracts

| Integration | State | Contract |
|---|---|---|
| SMTP | needs credentials | sending is a no-op with "not configured" shown |
| Anthropic assistant | needs `ANTHROPIC_API_KEY` | permission-checked queries only |
| WhatsApp | click-to-chat links only | labelled as links, never "sent" |
| Monitoring agent | `agent/`, device token | ingest only from enrolled devices; consent required |
| Ads, social posting, bank feeds, calendar sync | not built | never shown as connected |
