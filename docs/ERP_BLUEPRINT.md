# Blueprint: requirements and architecture

Requirements source: `docs/spec.md` (owner's full specification) and the engineering master prompt (the checklist in `docs/MODULE_STATUS.md`).

## Architecture

```
Browser ── Next.js App Router (server components, server actions, route handlers)
              ├─ src/app/(app)      staff screens, each guarded by requirePermission
              ├─ src/app/portal     client portal   (requireClientUser)
              ├─ src/app/vendor     vendor portal   (requireVendorUser)
              ├─ src/app/join,room  meeting guests and rooms (secret link, waiting room)
              └─ src/app/api        health, calendar feed, meetings (SSE, signal, chat), monitoring agent ingestion, files, screenshots
           src/lib                  business rules and services (pure rules separated from database code, each with tests)
           Prisma ── PostgreSQL     105 models; money as Decimal; org-scoped rows
           agent/                   Windows desktop agent for work monitoring (separate process, device token)
```

## Layers and conventions

- **Authorization:** session cookie → `getSessionUser` (one lookup per request) → `requirePermission`/`requireUser`/`requireSession`/`requireClientUser`/`requireVendorUser`. Record-level scope helpers (`leadScope`, `projectScope`, `contactScope`, file `authorizeOwner`) are applied in queries. Roles can require two-step verification.
- **Services:** all multi-record changes go through `src/lib` functions inside transactions (invoice posting, payment allocation, lead conversion, payroll, merge). Server actions parse input, call a service, audit, redirect.
- **UI:** shared components and patterns in `docs/DESIGN_SYSTEM.md`. Forms are server actions or small client components that call actions; errors come back as messages.
- **Money:** `Decimal` in the database, exact arithmetic in `ledger-math`, explicit currency on every amount.
- **Files:** stored through a storage adapter; type and size validated; downloads via signed short-lived links after an owner-based access check.
- **Jobs:** no queue yet. Recurring work (subscription billing, depreciation, monitoring purge) is a button or script that is idempotent.

## Modules

CRM and sales; services and clients; projects and content; finance and accounting; people and HR (attendance, leave, payroll, monitoring); procurement and vendors; my workspace (attendance, time, leave, payslips, expenses, documents, calendar, assistant); administration (users, roles, company, bank accounts, documents, exchange and tax rates, email, monitoring, audit logs, security); client and vendor portals; built-in meetings. Per-module status: `docs/MODULE_STATUS.md`.

## Dependencies on things outside the code

Mail needs SMTP credentials. The assistant needs `ANTHROPIC_API_KEY`. Live ad metrics, WhatsApp Business, telephony and calendar sync need provider accounts. Real cross-network video needs a TURN relay. Monitoring needs the agent installed on staff computers. Production needs managed PostgreSQL, HTTPS and a secrets store (`docs/DEPLOYMENT.md`).
