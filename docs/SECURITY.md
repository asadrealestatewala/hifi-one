# Security notes

What is in place, how it is checked, and what is not done yet.

## Authentication and sessions

- Passwords are hashed with bcrypt (cost 12). Minimum length is 10 characters.
- Sessions are stored in the database and carried in a signed, `HttpOnly`, `SameSite=Lax` cookie (`Secure` in production). They last 12 hours, can be revoked, and changing a password signs the user out everywhere.
- Sign-in is limited per account (5 failures lock the account for 15 minutes), and per address and per email (20 and 8 attempts per 10 minutes). Error messages do not reveal whether an email exists.
- Invitation links are single-use, expire after 7 days, and only a hash of the token is stored.

## Authorization

- Access is permission based (`src/lib/permissions.ts`, matrix in `docs/ROLES.md`). Menus hide what a role cannot use, but the real checks run on the server in every page and every server action.
- **An automated test (`src/lib/guards.test.ts`) fails the build if any internal page lacks a permission check, or any server action lacks a caller check.** It was verified to fail when a page is left unguarded.
- Record-level rules sit on top: agents see their own leads, project members see their projects, clients see only their own client's data, vendors only their own vendor's data. Portal queries take the client or vendor id from the signed-in user's own record, never from the URL or form.
- Separation of duties is enforced in the services: the person who prepares payroll cannot approve it, submitters cannot review or approve their own vouchers, and so on.
- Staff, client and vendor sessions are separate: each type is redirected away from the other areas.

## Data integrity

- Posted journal lines cannot be edited or deleted (database trigger). Corrections are reversing entries.
- Approved payroll lines are frozen (database trigger). Amounts use exact decimals, never floating point.
- Financial actions are idempotent and use row locks, so retries and simultaneous clicks do not double-post. These behaviours are covered by tests against a real database.
- Issued invoices keep a snapshot of company and bank details.

## Application hardening

- Security headers on every response: `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy`, `Permissions-Policy`, and in production a Content-Security-Policy and HSTS.
- Next.js server actions check the request origin, which protects against cross-site request forgery.
- All input is validated on the server (zod and explicit checks). Database access goes through Prisma (parameterized queries); the few raw SQL statements use bound parameters.
- Sensitive values are masked or kept out of logs: bank account numbers are masked unless a role may see them, salary amounts and identity details never go into audit logs.
- `npm audit --omit=dev` reports no known vulnerabilities (two transitive packages are pinned to patched versions in `package.json` overrides). Re-run it regularly.
- The demo seed refuses to run in production.

## Not done yet (be aware before going live)

- **No multi-factor authentication and no self-service password reset.** An administrator must reset a lost password.
- No email delivery: invitation links and starting passwords are shown once and handed over manually.
- The rate limiter is per server process (see `docs/DEPLOYMENT.md`).
- The Content-Security-Policy allows inline scripts and styles, which Next.js needs without per-request nonces.
- No file storage, so no virus scanning, signed downloads or retention rules for uploaded documents yet.
- Employee activity monitoring (screenshots, app usage) is **not built**. The browser alone cannot do it legitimately; it needs a separate, transparent desktop agent and a written policy. Nothing here collects it.
- Audit logs can be read in the app but there is no tamper-evident export or retention schedule.
- A third-party security review and penetration test have not been done. Do one before storing real client financial data.
- Data protection duties (consent records, retention and deletion, data export requests) depend on the countries you operate in (United States, Pakistan, and your clients' jurisdictions) and need a policy decision.
