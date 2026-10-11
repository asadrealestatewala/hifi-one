# Security notes

What is in place, how it is checked, and what is not done yet.

## Authentication and sessions

- Passwords are hashed with bcrypt (cost 12). Minimum length is 10 characters.
- Sessions are stored in the database and carried in a signed, `HttpOnly`, `SameSite=Lax` cookie (`Secure` in production). They last 12 hours, can be revoked, and changing a password signs the user out everywhere.
- Sign-in is limited per account (5 failures lock the account for 15 minutes), and per address and per email (20 and 8 attempts per 10 minutes). Error messages do not reveal whether an email exists.
- **Two-step verification** with any authenticator app (RFC 6238 codes). Secrets are encrypted at rest, a code works once (replay is blocked, even with simultaneous attempts), eight single-use recovery codes are stored as hashes, and turning it off or making new recovery codes needs the password. A correct password without a code gives no session. Administrators can reset it for a user (that signs them out).
- **Password reset** uses one-hour, single-use links created by an administrator (nothing is emailed yet). Using one signs the person out everywhere and cancels any other outstanding link. New staff get a 24-hour link to set their own password, so no temporary password is ever typed or shown.
- Invitation links are single-use, expire after 7 days, and only a hash of the token is stored.

## Authorization

- Access is permission based (`src/lib/permissions.ts`, matrix in `docs/ROLES.md`). Menus hide what a role cannot use, but the real checks run on the server in every page and every server action.
- **An automated test (`src/lib/guards.test.ts`) fails the build if any internal page lacks a permission check, or any server action lacks a caller check.** It was verified to fail when a page is left unguarded.
- Record-level rules sit on top: agents see their own leads, project members see their projects, clients see only their own client's data, vendors only their own vendor's data. Portal queries take the client or vendor id from the signed-in user's own record, never from the URL or form.
- Separation of duties is enforced in the services: the person who prepares payroll cannot approve it, submitters cannot review or approve their own vouchers, and so on.
- **User and role administration is guarded by rules in the service layer:** the system always keeps an active Super Admin (even when two admins change each other at once), only a Super Admin can grant, remove or reset a Super Admin, nobody can grant or remove a permission they do not hold themselves, changing a role or deactivating a user signs the people affected out, and built-in roles cannot be deleted. All changes are audited.
- Staff, client and vendor sessions are separate: each type is redirected away from the other areas.

## Two-step verification and the security checklist

- Each role has a "require two-step verification" switch (Roles & Permissions). Anyone holding such a role is taken to the setup page at their next page load and can open nothing else (pages, downloads, actions) until it is on; the setup, password and health pages stay reachable so nobody is locked out.
- New installations created through first-run setup require it for Super Admin, CEO, Finance Manager, Accountant and HR Manager. Existing installations and the development seed are left optional so an upgrade never locks people out; turn it on per role, then run the checklist.
- Settings > Security Checklist shows live findings: session secret strength, roles without the requirement, users still to enrol, number of Super Admins, production mode, file storage location, virus scanning and starting passwords.

## Email

- Mail credentials live only in the server environment; no screen shows or edits them. The Email page shows the server name and sender, never the password.
- Recipients must be exactly one valid address (control characters, commas and brackets are refused so a value can never add headers or recipients), subjects are flattened to one line, and an organization can send at most 60 emails an hour.
- Documents are generated server-side from the same loaders as downloads; drafts and cancelled documents cannot be emailed, and another organization's records are never found.
- Every attempt is logged (who, to whom, which document, result). The log says SENT only when the mail server accepted the message.

## Files and documents

- Uploads are checked on the server by looking inside the file: the extension must match the contents, programs, scripts, HTML and SVG are refused, Office files with macros are refused, and the size limit is 15 MB. The server decides the content type; the uploader cannot.
- Files are stored outside any public folder under random names. The only way to get one is the download route, which needs a signed-in user, a link signed for that user and file that expires after 10 minutes, and the access rule of the record the file belongs to (for example only the submitter and reviewers see an expense receipt; only the employee and sensitive-data HR see employee documents; clients see content media only once it reaches client review). A file you may not see looks exactly like one that does not exist.
- Downloads are sent with `nosniff`, a sandboxing Content-Security-Policy and `no-store`.
- Removal is soft (recoverable) until a retention purge deletes the bytes.
- **Not done:** virus scanning (every file is marked not scanned; add a scanner such as ClamAV behind `scanStatus` before accepting files from the public), encryption of files at rest beyond what your disk or object store provides, and per-type retention schedules.
- PDF documents are generated on the server from recorded data, with the same access rules as the screens. Issued invoices are rebuilt from the details frozen at issue.

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

- Two-step verification is available but **not enforced**: nothing forces administrators or finance users to turn it on yet. There is no self-service "forgot password" (it needs email); an administrator creates the reset link.
- No email delivery: invitation links and starting passwords are shown once and handed over manually.
- The rate limiter is per server process (see `docs/DEPLOYMENT.md`).
- The Content-Security-Policy allows inline scripts and styles, which Next.js needs without per-request nonces.
- No file storage, so no virus scanning, signed downloads or retention rules for uploaded documents yet.
- Employee activity monitoring (screenshots, app usage) is **not built**. The browser alone cannot do it legitimately; it needs a separate, transparent desktop agent and a written policy. Nothing here collects it.
- Audit logs can be read in the app but there is no tamper-evident export or retention schedule.
- A third-party security review and penetration test have not been done. Do one before storing real client financial data.
- Data protection duties (consent records, retention and deletion, data export requests) depend on the countries you operate in (United States, Pakistan, and your clients' jurisdictions) and need a policy decision.
