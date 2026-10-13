---
paths:
  - "src/lib/**/*.ts"
  - "src/app/**/actions.ts"
  - "src/app/**/page.tsx"
  - "src/app/api/**/*.ts"
  - "prisma/**"
---

# Integration safety

Full reference: `docs/DATA_FLOWS.md` (ownership, workflows, contracts) and `docs/DATA_MODEL.md` (entities).

Before changing behaviour, name: the source of truth, the dependent entities, the permission, the workflow steps, the financial effect, the reports and dashboard figures it feeds, and the client or vendor portal views it shows up in. Update all of them in the same change.

- One writer per fact. Use the owning service in `src/lib`; do not write the same fact from a page or a second service. Contacts are the master record for people and companies.
- Multi-row business events run in one `db.$transaction` inside a `src/lib` service. Server actions parse input, check permission, call the service, `audit`, notify, then redirect.
- Money moves only through `postJournal` (`src/lib/accounting.ts`) with a deterministic idempotency key. Posted entries are never edited or deleted: reverse, credit or adjust. Respect `PeriodLock`.
- Amounts are `Decimal` with an explicit currency; never add different currencies; never use floating point for money.
- Every query filters by `organizationId`; apply record scope helpers; portals derive the client or vendor from the session, never from the request.
- Notify the people who now have work (`src/lib/notifications.ts`), with a `dedupeKey` for reminders.
- Never change an established financial or business rule silently: record it in `docs/DECISIONS.md` and add a test.
- Migrations are additive; folder names sort after the latest; no reset or destructive migration without explicit approval.
- External services (mail, assistant, ads, WhatsApp, monitoring) show "not configured" until credentials exist; never simulate success.
