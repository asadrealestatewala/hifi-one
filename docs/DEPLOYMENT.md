# Deployment and operations

This is a Next.js 15 application with a PostgreSQL database. There are no background workers yet: everything runs inside the web process.

## What you need

- Node.js 20 or newer
- PostgreSQL 15 or newer, **UTF-8 encoding** (required for Urdu and Arabic text). A managed database (for example AWS RDS, Google Cloud SQL, Azure, Supabase, Neon or DigitalOcean) is recommended over running your own.
- A host that can run a Node server (a VM, a container platform, or a Node-capable PaaS) with HTTPS in front of it

The local development database (`npm run db:start`) is for development only. Do not use it in production.

## Environment variables

| Name | Purpose |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string, for example `postgresql://user:password@host:5432/hifi_one?sslmode=require` |
| `SESSION_SECRET` | 32+ random characters used to sign session cookies. Generate: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`. Changing it signs everyone out. |
| `SETUP_TOKEN` | Production only. 16+ random characters. Required to run first-run setup (see below). The setup page closes by itself once a user exists. |
| `STORAGE_DIR` | Folder for uploaded files (default `.data/files` next to the app). Use a persistent path outside the code, and back it up together with the database. |
| `NODE_ENV` | `production` (set by `next start`). Turns on secure cookies, HSTS and the strict Content-Security-Policy. |

Keep these in your host's secret store, never in git. Only `.env.example` (placeholders) is committed.

## First deployment

```bash
npm ci --legacy-peer-deps
npx prisma migrate deploy      # creates all tables; safe to re-run
# After upgrading to a version that adds permissions, run: npm run roles:sync (gives them to Super Admin; grant other roles in Roles & Permissions)
npm run build
npm run start                  # serves on port 3000 (use -p to change)
```

**Do not run the demo seed in production.** It creates demo users and example prices, and refuses to run when `NODE_ENV=production` unless `ALLOW_DEMO_SEED=1` is set.

### First-run setup

On an empty database, open the site. It sends you to **/setup**, where you enter the company name, main currency, time zone and the first administrator (12+ character password with upper case, lower case and a digit). In production the page also asks for the `SETUP_TOKEN` from the server environment, so a stranger who finds the URL first cannot take over. Setup creates the roles, permissions, a starter chart of accounts, pipeline stages and leave types in one all-or-nothing step, and **the page closes permanently as soon as any user exists**.

After that: sign in, turn on two-step verification (Account security), then fill in Company Settings and bank accounts, create staff under Users, and tune roles under Roles & Permissions.

Users receive a one-time link to set their own password (email is not connected, so you copy and send it). If the only Super Admin is locked out, recovery needs a database-level step (a one-off script that creates a reset token) or a restore from backup. Keep at least two Super Admins.

## HTTPS and proxies

Terminate HTTPS at a reverse proxy or the platform and forward to the Node process. Pass `X-Forwarded-For` and `X-Forwarded-Proto` (the sign-in rate limiter and invitation links use them). The application sends HSTS, so HTTPS must be working before you go live.

## Updating

1. Take a database backup (see below).
2. Deploy the new code.
3. `npx prisma migrate deploy` (migrations are additive and versioned in `prisma/migrations`).
4. `npm run build` and restart.

Never run `prisma migrate reset` or `prisma db push --force-reset` against a database that holds real data.

## Going live: the rehearsal checklist

Do this on the real server (or an identical staging one) before anyone relies on the system.

1. **Prepare the environment** from `.env.production.example`: strong database password, `SESSION_SECRET` (48+ random characters), `APP_URL` (https), `SETUP_TOKEN` (first run only), `STORAGE_DIR` on persistent storage.
2. **Run `node scripts/preflight.mjs`** with that environment. Fix every FAIL; read every WARN. It never prints secret values.
3. **Start it** either with Docker (`docker compose up -d --build`, which uses the `Dockerfile` and `docker-compose.yml`) or directly (`npm ci && npx prisma migrate deploy && npm run build && npm start`). Put an HTTPS reverse proxy in front; do not expose port 3000 or the database to the internet.
4. **Run `node scripts/smoke-prod.mjs https://your-address`.** It confirms the health check, the security headers (CSP, HSTS, framing, sniffing), that protected pages send a signed-out visitor to the login page, that files and the calendar feed give nothing away, and that repeated bad sign-ins never crash the server.
5. **Run first-run setup** at `/setup` with the setup token, sign in, and complete two-step enrolment (the first administrator's role requires it). Then delete `SETUP_TOKEN` from the environment and restart.
6. **Create a second Super Admin**, turn on two-step verification for the sensitive roles, and read Settings > Security Checklist until nothing says Fix.
7. **Prove backup and restore**: take a backup, restore it into a scratch database, sign in against it, then run `npm run backup:check` from your scheduler.
8. Optional: connect email (Settings > Email) and the assistant (`ANTHROPIC_API_KEY`) and test each from its page.

**What was rehearsed so far (on a development machine, not a server):** all migrations applied cleanly to an empty database; a production build started in production mode; `smoke-prod` passed every check; first-run setup with the token worked; the new administrator was sent to two-step enrolment on sign-in. **Not yet rehearsed:** the Docker image and compose file (Docker was not installed where they were written), the HTTPS proxy, a real mail server, and a real restore.

## Email

Outgoing email uses SMTP and is off until you set `SMTP_HOST` and `MAIL_FROM` (plus `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` if your provider needs them) in the server environment. With these set, invoices, quotations and customer statements can be emailed as PDFs from their pages. Use Settings > Email to test the connection and send yourself a test message; every attempt is logged there as sent, failed (with the provider's reason) or not sent. Invitation and password-reset links are still copied by hand. Use an app password or API key for the mail account, not a personal password, and add SPF/DKIM records for your sending domain or messages will land in spam.

## Video meetings

Serve Hifi One over HTTPS (browsers block camera, microphone and screen capture otherwise). For reliable calls across company firewalls and mobile networks, run a TURN relay (for example coturn) and set `ICE_SERVERS`, a JSON array such as `[{"urls":"stun:stun.l.google.com:19302"},{"urls":"turn:turn.example.com:3478","username":"u","credential":"p"}]`. Run a single application process (live meeting messages are held in memory), or use sticky routing. Details and limits are in docs/MEETINGS.md.

## Business assistant

Off until `ANTHROPIC_API_KEY` is set. When on, a person's question and the figures needed to answer it are sent to Anthropic's API; tell staff this (the page says so). The assistant only reads, only through tools that re-check the person's permissions, and every question is logged (who, what, which data sources, outcome; answers are not stored). Each person is limited to 20 questions an hour. Set a spending limit on the API key in the provider console.

## Scheduled jobs, scanning and backups (added 2026-10-17)

- **Jobs.** Pick one: (a) set `JOBS_AUTORUN=1` on an always-on server; (b) a daily OS task or container cron running `npm run jobs:run`; (c) a hosted scheduler calling `POST /api/jobs/run` with `Authorization: Bearer $JOBS_TOKEN` (token at least 24 characters). Running them twice in a day is safe. Check the Scheduled Jobs page after the first night.
- **Virus scanning.** Run ClamAV (`clamd`) reachable from the app and set `CLAMAV_HOST` (and `CLAMAV_PORT` if not 3310). If it goes down, uploads are refused until it is back. Without it, files are saved and labelled not scanned.
- **What to back up.** The database (agreements, signatures, lead sources, job history, saved views, support threads) and the upload folder (vendor documents, deliverable files and attachments). Both are needed for a restore; see below.
- Run `node scripts/smoke-prod.mjs <url>` after every deployment: it now also checks the jobs endpoint, lead capture, signing links and the new pages.

## Backup verification

A backup nobody has checked is a hope. Schedule this after your backup job and alert on a non-zero exit:

```
npm run backup:check -- /path/to/db-backups --max-hours 26 --files /path/to/upload-backups
```

It confirms the newest backup exists, is recent, is not empty and starts like a real PostgreSQL dump. It cannot prove a restore works: do a restore drill into a scratch database at least once a quarter and record the date.

## Backups and restore

Production (PostgreSQL tools):

```bash
# Backup: compressed, restorable with pg_restore
pg_dump --format=custom --file=hifi_one_$(date +%F).dump "$DATABASE_URL"

# Restore into an EMPTY database
pg_restore --no-owner --dbname="$TARGET_DATABASE_URL" hifi_one_2026-10-11.dump
```

- Schedule a backup at least daily and keep copies off the server. Most managed databases offer automated backups and point-in-time recovery; turn them on.
- **Rehearse a restore** into a scratch database before you need it, and confirm that you can sign in and that the trial balance balances.
- **Uploaded files** live in `STORAGE_DIR` (receipts, vendor bill documents, employee documents, content media). Back that folder up on the same schedule as the database and restore both together: the database stores each file's record and checksum, the folder stores the bytes. The storage layer is a small interface (`src/lib/storage.ts`), so moving to S3, Azure Blob or Google Cloud Storage means writing one provider class.

Local development database: stop it, then `npm run db:backup`. Restore with `npm run db:restore -- <folder-name> --yes` (the current data is moved aside, not deleted).

## Monitoring

- Health check: `GET /api/health` returns `{"status":"ok"}` (HTTP 200) or 503 when the database is unreachable. Point your uptime monitor at it.
- Logs go to the process output. Ship them to your log service. Application errors appear there; user-facing pages show a generic message.
- The in-app **Audit Logs** page records sign-ins, approvals, setting changes and financial postings.
- Alert on: health check failing, repeated 5xx responses, database disk space, backup job failures.

## Scaling notes

- Sessions are stored in the database, so you can run several web instances behind a load balancer.
- The sign-in rate limiter (`src/lib/rate-limit.ts`) is in memory per instance. With several instances the effective limit multiplies; move it to a shared store (Redis) or enforce limits at the proxy as well.
- Notification, report and PDF work runs inside requests today. If reports get slow, move them to a job queue (planned, not built).

## Known gaps before real production use

Read `docs/GAP_ANALYSIS.md` and `docs/SECURITY.md`. The most important: no file storage, no email delivery (invitations and starting passwords are copied by hand), no email delivery (links are copied by hand), no exchange rates, no year-end closing, and tax handling is a flat percentage.
