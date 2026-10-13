# Data model: entities, relationships, source of truth

105 Prisma models in `prisma/schema.prisma`. Every business row carries `organizationId`; every query filters by it. This file lists the canonical entity for each thing and how the others point to it. If code and this file disagree, the code wins and this file is wrong: fix it.

## Canonical entities (one record per real-world thing)

| Thing | Canonical model | Others that point to it |
|---|---|---|
| Person or company you deal with | `Contact` (kind PERSON or ORGANIZATION; `parentId` links a person to an organization) | `Lead.contactId`, `Client.contactId`, `ContactActivity`, `Meeting.contactId`, files with owner CONTACT |
| Sales opportunity | `Lead` (stage on `PipelineStage`) | `LeadActivity`, `Contact` |
| Paying customer | `Client` | `Invoice`, `Quote`, `Subscription`, `Contract`, `Payment`, `Project.clientId`, `Meeting.clientId`, `ClientInvite`, portal `User.clientId` |
| Employee | `User` (userType EMPLOYEE) plus `EmployeeProfile` | attendance, leave, payroll, monitoring, tasks, commissions |
| Vendor | `Vendor` | `VendorOpportunity`, `VendorApplication`, `WorkOrder`, `VendorBill`, portal `User.vendorId` |
| Project | `Project` | `ProjectMember`, `Task`, `Milestone`, `TimeEntry`, `Budget` (scope PROJECT), `Meeting.projectId` |
| Money movement | `JournalEntry` and `JournalLine` (double entry, immutable once posted) | `Invoice`, `Payment`, `CreditNote`, `ExpenseVoucher`, `VendorBill`, `PayrollRun`, `ManualJournal`, `DepreciationEntry` reference their entry |

## Key relationships and rules

- **Contacts, leads and clients stay in sync.** A lead always has a contact (`ensureContactForLead`). Editing a contact pushes name, email, phone and place to its leads and client; editing a lead updates its contact. Converting a lead links or creates the client, marks the contact and its organization as customers, and keeps all history. Duplicates are found through `Contact.matchKeys` (every email and normalised phone, GIN-indexed). Merging archives the duplicate (never deletes), moves leads, client link, timeline, people, tags, phones and emails, and refuses two records that each have a client.
- **Activities are stored once.** `ContactActivity.leadActivityId` is unique, so an event logged on a lead and shown on the contact (or the reverse) is one fact counted once toward targets.
- **Invoices and payments.** `Invoice` → `InvoiceLine`; `Payment` → `PaymentAllocation` → `Invoice` (FIFO allocation, idempotency key per payment, row locks). Excess becomes an advance held on account. `CreditNote` (also write-offs) reduces the balance by reversal entries. Invoice totals are exact decimals; the company and bank details are frozen on the invoice when issued.
- **Revenue is recognised when an invoice is issued** (accrual). A payment never counts as revenue. Year-end close entries (`sourceType YEAR_END_CLOSE`) are excluded from period P&L and included in balance sheets. `PeriodLock` blocks posting into closed periods.
- **Currencies.** Amounts carry their own currency and are never mixed in totals. `ExchangeRate` is used only by the consolidated reports.
- **Commissions.** `CommissionEntry.allocationId` is unique: one payment allocation is commissioned once. Rules live in `CommissionRule`.
- **Content.** `ContentItem` has `platforms` (several), `postType`, `plannedDate` and `plannedTime`; `clientId` is empty for the company's own posts. Every wording change is a `ContentVersion`; status changes are `ContentEvent`s.
- **Profile.** `EmployeeProfile` now also holds `dateOfBirth`, `gender`, `fatherName` (set by HR); staff change only their own phone, emergency contact, personal email and address.
- **Quotes and subscriptions.** `Quote` → `QuoteLine`; accepted quotes convert to a draft invoice once (`Quote.invoiceId`). `Subscription` → `SubscriptionInvoice` (unique per period) so a period is billed once.
- **Tasks.** `Task.parentId` makes a subtask (one level); `Task.blockedBy` lists tasks in the same project that must be Done first (cycles refused); `Task.recurrence` plus unique `recurredFromId` makes the next occurrence exactly once; `TaskComment` is internal by default; files with owner TASK follow the project.
- **Projects.** Progress is derived from top-level tasks; completion is blocked while tasks are open. `TimeEntry` and cost rates feed profitability. Tasks flagged client-visible appear in the client portal.
- **Vendors.** Opportunity → application → work order → bill → payment, with accounts payable on the ledger; vendor users see only their own records.
- **HR and monitoring.** `AttendanceRecord` and `BreakRecord` are the source for worked time. Monitoring (`MonitoringPolicy`, `PolicyAck`, `WorkSession`, `ActivityBucket`, `AppUsage`, `Screenshot`, `MonitorDevice`, `MonitoringAccess`, `TimesheetCorrection`) is separate, consent-gated, and every screenshot view is logged.
- **Files.** `StoredFile` is polymorphic (`ownerType` EXPENSE, VENDOR_BILL, CONTENT, EMPLOYEE, CONTRACT, CONTACT). Access always follows the owning record (`src/lib/file-access.ts`); links are signed and short-lived.
- **Meetings.** `Meeting` → `MeetingParticipant`, `MeetingMessage`; guests join with a secret link, admitted from a waiting room; staff are tied to `User`.
- **Preferences.** `UserPreference(userId, key)` holds per-user settings such as the dashboard layout.
- **Audit.** `AuditLog` records who did what to which record for every sensitive action; `SettingChange` keeps before/after for company settings.

## Constraints that carry business rules

Unique per organization: `Client(name)`, `Account(code)`, `NumberSequence(key)`. Unique globally: `User.email`, `Meeting.joinToken`, `MeetingParticipant.ticket`. A database trigger makes posted journal lines immutable.

## Not modelled yet

Brands under a client, deliverables as their own entity, purchase orders separate from work orders, ad-platform metrics, saved views for arbitrary lists (smart lists exist for leads).
