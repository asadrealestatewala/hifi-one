# Roadmap and status

Phases follow section 35 of [spec.md](spec.md).

## Phase 0: Foundation (in progress, core done)

Done and verified on localhost:
- Next.js + PostgreSQL + Prisma, versioned migration, seed with demo users
- Sign-in with lockout after repeated failures, revocable database sessions, secure cookie
- Permission-based access (checked on the server on every page and action), 22 spec roles seeded
- Audit log (sign-ins, company profile and bank account changes; bank numbers masked in logs)
- Company profile preloaded with the supplied name, UANs and both office addresses, editable by Super Admin, with change history
- Bank accounts: add, deactivate, default per currency (PKR/USD/AED/GBP), numbers masked unless permitted
- Unit tests for masking and role definitions

Still to do in Phase 0:
- Role and permission editor, user create/edit, branches and departments screens
- Dark/light toggle, collapsible sidebar, global search
- Integration tests for permissions and audit; Playwright smoke test
- Password reset and optional MFA

## Next: Phase 1 (CRM and commercial engine)

Leads, contacts, opportunities kanban, Smart Lists, worklists, service catalog and regional price books, quotes, client conversion.

## Decisions

- Brand colour follows the supplied red H logo; the spec's blue/purple can be added as a theme if wanted.
- Local database is PostgreSQL 17 from the `embedded-postgres` package (no Docker here). Production should use a managed PostgreSQL.
- Bank details and company profile edits never rewrite issued documents; documents will store snapshots (built with invoicing in Phase 3).
