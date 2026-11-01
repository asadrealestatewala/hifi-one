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
| `SETUP_TOKEN` | Optional, production only. If set, first-run setup checks it when it is entered; a blank field skips the check. The setup page closes by itself once a user exists. |
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

On an empty database, open the site. It sends you to **/setup**, where you enter the company name, main currency, time zone and the first administrator (12+ character password with upper case, lower case and a digit). The setup token is optional: if `SETUP_TOKEN` is set on the server the page shows a token field and checks any value entered there, but you can leave it blank. **Until setup is finished, whoever reaches `/setup` first can create the administrator account**, so complete setup immediately after the first deploy. Setup only ever runs on a database with no users, so it cannot add a second administrator or reset anything later. Setup creates the roles, permissions, a starter chart of accounts, pipeline stages and leave types in one all-or-nothing step, and **the page closes permanently as soon as any user exists**.

After that: sign in, turn on two-step verification (Account security), then fill in Company Settings and bank accounts, create staff under Users, and tune roles under Roles & Permissions.

Users receive a one-time link to set their own password (email is not connected, so you copy and send it). If the only Super Admin is locked out, recovery needs a database-level step (a one-off script that creates a reset token) or a restore from backup. Keep at least two Super Admins.

## HTTPS and proxies

Terminate HTTPS at a reverse proxy or the platform and forward to the Node process. Pass `X-Forwarded-For` and `X-Forwarded-Proto` (the sign-in rate limiter and invitation links use them). The application sends HSTS, so HTTPS must be working before you go live.

## Serving hifimarketing.co (website and ERP on one domain)

Production runs on the VPS behind hifimarketing.co (DNS pointed there on 2026-10-31; nginx 1.24 with a Let's Encrypt certificate for hifimarketing.co and www already answered on 443): `.github/workflows/deploy.yml` deploys every push to `main` into `/var/www/hifi-one` and restarts it with pm2 (`hifi-one`, port 3000). `/` shows the public website to visitors and sends signed-in staff to `/dashboard`. Steps to put the domain on it (run on the VPS as root or with sudo; each is safe to repeat):

1. **Check the app is up:** `pm2 ls` shows `hifi-one` online; `curl -sI http://127.0.0.1:3000/site` returns 200.
2. **DNS (Namecheap → Domain List → hifimarketing.co → Advanced DNS):** an `A` record for `@` and one for `www` pointing at the VPS IP; remove the old records that point at the PHP host. Optional `AAAA` records if the VPS has IPv6. Wait until `nslookup hifimarketing.co` returns the VPS IP.
3. **nginx:** `apt install nginx`, copy `deploy/nginx/hifimarketing.co.conf` to `/etc/nginx/sites-available/`, link it into `sites-enabled`, remove `sites-enabled/default` if it is the stock page, then `nginx -t && systemctl reload nginx`.
4. **Firewall:** allow 80 and 443 (`ufw allow 'Nginx Full'`); keep 3000 and the database closed to the internet.
5. **HTTPS:** `apt install certbot python3-certbot-nginx`, then `certbot --nginx -d hifimarketing.co -d www.hifimarketing.co --redirect`. Renewal runs from certbot's timer; `certbot renew --dry-run` checks it.
6. **App environment:** set `APP_URL=https://hifimarketing.co` in the app's environment file and `pm2 restart hifi-one --update-env`.
7. **First-run setup:** until a user exists, `/` and `/login` send every visitor to `/setup`, so the website is not shown. Complete setup at `https://hifimarketing.co/setup` straight after the deploy (until then anyone who opens it can create the administrator). If you set `SETUP_TOKEN`, remove it afterwards and restart.
8. **Check:** `node scripts/smoke-prod.mjs https://hifimarketing.co` (it also checks that `/` serves the website uncached), then open `/` signed out (website) and `/login` (ERP sign-in).

The old PHP site (job applications, applicant accounts, its client portal) stops being reachable once DNS moves; the website copy sends those visitors to the contact page.

## Updating

1. Take a database backup (see below).
2. Deploy the new code.
3. `npx prisma migrate deploy` (migrations are additive and versioned in `prisma/migrations`).
4. `npm run build` and restart.

Never run `prisma migrate reset` or `prisma db push --force-reset` against a database that holds real data.

## Going live: the rehearsal checklist

Do this on the real server (or an identical staging one) before anyone relies on the system.

1. **Prepare the environment** from `.env.production.example`: strong database password, `SESSION_SECRET` (48+ random characters), `APP_URL` (https), `SETUP_TOKEN` (optional, first run only), `STORAGE_DIR` on persistent storage.
2. **Run `node scripts/preflight.mjs`** with that environment. Fix every FAIL; read every WARN. It never prints secret values.
3. **Start it** either with Docker (`docker compose up -d --build`, which uses the `Dockerfile` and `docker-compose.yml`) or directly (`npm ci && npx prisma migrate deploy && npm run build && npm start`). Put an HTTPS reverse proxy in front; do not expose port 3000 or the database to the internet.
4. **Run `node scripts/smoke-prod.mjs https://your-address`.** It confirms the health check, the security headers (CSP, HSTS, framing, sniffing), that protected pages send a signed-out visitor to the login page, that files and the calendar feed give nothing away, and that repeated bad sign-ins never crash the server.
5. **Run first-run setup** at `/setup` right away (the setup token is optional), sign in, and complete two-step enrolment (the first administrator's role requires it). If you set `SETUP_TOKEN`, delete it from the environment and restart.
6. **Create a second Super Admin**, turn on two-step verification for the sensitive roles, and read Settings > Security Checklist until nothing says Fix.
7. **Prove backup and restore**: take a backup, restore it into a scratch database, sign in against it, then run `npm run backup:check` from your scheduler.
8. Optional: connect email (Settings > Email) and the assistant (`ANTHROPIC_API_KEY`) and test each from its page.

**What was rehearsed so far (on a development machine, not a server):** all migrations applied cleanly to an empty database; a production build started in production mode; `smoke-prod` passed every check; first-run setup with the token worked; the new administrator was sent to two-step enrolment on sign-in. **Not yet rehearsed:** the Docker image and compose file (Docker was not installed where they were written), the HTTPS proxy, a real mail server, and a real restore.

## Email

Outgoing email is off until a way to send is configured in the server environment. Either set `RESEND_API_KEY` (preferred; used when both are set) or `SMTP_HOST` (plus `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`; Resend's SMTP is `smtp.resend.com`, user `resend`, password = an API key). `MAIL_FROM` is the sender for anything no mailbox owns. Use Settings > Email to test the connection; every attempt is logged there as sent, failed (with the provider's reason) or not sent. Add the sending domain's SPF/DKIM records (Resend shows them) or messages land in spam.

### Mailboxes (Settings > Mailboxes, permission `mail.manage`)

- `MAIL_DOMAIN` (default `hifimarketing.co`) is the domain new mailbox addresses are created on. That domain must be added and verified for sending in Resend before mail from those addresses is accepted.
- `STAFF_MAIL_DOMAIN` (optional, defaults to `MAIL_DOMAIN`) is the domain for employee (personal) mailboxes. Use it with a receiving subdomain: Resend receives on `mail.hifimarketing.co`, employees get `name@mail.hifimarketing.co` the moment the mailbox is created (no DNS step), and the main domain keeps only forwards for its shared addresses (billing@, sales@, support@, hello@, noreply@ ...) to the same names on the subdomain. Add that subdomain in Resend with receiving on; sending from it needs its own DKIM/SPF records there. An unlisted address on the main domain is then rejected by the forwarding service instead of landing in Resend, which keeps spam from using up Resend's receiving quota.
- "Create them" makes noreply@, billing@, hr@, onboarding@ and finance@. Once billing@ exists, invoices, quotations and statements are sent from it and a copy is kept in its Sent folder; password resets, meeting invitations and test emails go from noreply@.
- Each employee gets one or more personal mailboxes, and shared team mailboxes can have several members (read and send, or read only). People use them at /mail with their normal Hifi One sign-in. Membership is the only access: `mail.manage` assigns people but never opens anyone's mail.
- After upgrading, run `npm run roles:sync` so Super Admin receives `mail.manage`; grant it to other roles in Roles & Permissions if needed.

### Receiving mail (optional)

1. In Resend, add the receiving domain and switch on receiving. Resend shows an MX record; add it at the DNS host. **The MX record decides where all of the domain's mail goes.** If `hifimarketing.co` already receives mail elsewhere (Google Workspace, Zoho, cPanel), do not replace that record: either receive on a subdomain (for example `mail.hifimarketing.co`, then set `MAIL_DOMAIN` to it) or forward from the existing provider to an address on a Resend receiving domain.
2. In Resend > Webhooks, add `https://<your host>/api/mail/inbound` for the `email.received` event and copy its signing secret.
3. Set `RESEND_API_KEY` (a full-access key: it is used to fetch each received email's content) and `RESEND_WEBHOOK_SECRET` (the `whsec_...` value), then restart.
4. Send a test email to one of the mailboxes. The webhook refuses unsigned or stale requests, ignores addresses nobody has a mailbox for, and stores each email once even when Resend retries.

## Video meetings

Serve Hifi One over HTTPS (browsers block camera, microphone and screen capture otherwise). For reliable calls across company firewalls and mobile networks, run a TURN relay (for example coturn) and set `ICE_SERVERS`, a JSON array such as `[{"urls":"stun:stun.l.google.com:19302"},{"urls":"turn:turn.example.com:3478","username":"u","credential":"p"}]`. Run a single application process (live meeting messages are held in memory), or use sticky routing. Details and limits are in docs/MEETINGS.md.

## Business assistant

Off until `ANTHROPIC_API_KEY` is set. When on, a person's question and the figures needed to answer it are sent to Anthropic's API; tell staff this (the page says so). The assistant only reads, only through tools that re-check the person's permissions, and every question is logged (who, what, which data sources, outcome; answers are not stored). Each person is limited to 20 questions an hour. Set a spending limit on the API key in the provider console.

## Scheduled jobs, scanning and backups (added 2026-10-17)

- **Jobs.** Pick one: (a) set `JOBS_AUTORUN=1` on an always-on server; (b) a daily OS task or container cron running `npm run jobs:run`; (c) a hosted scheduler calling `POST /api/jobs/run` with `Authorization: Bearer $JOBS_TOKEN` (token at least 24 characters). Running them twice in a day is safe. Check the Scheduled Jobs page after the first night.
- **Virus scanning.** Run ClamAV (`clamd`) reachable from the app and set `CLAMAV_HOST` (and `CLAMAV_PORT` if not 3310). If it goes down, uploads are refused until it is back. Without it, files are saved and labelled not scanned.
- **What to back up.** The database (agreements, signatures, lead sources, job history, saved views, support threads) and the upload folder (vendor documents, deliverable files and attachments). Both are needed for a restore; see below.
- Run `node scripts/smoke-prod.mjs <url>` after every deployment: it now also checks the jobs endpoint, lead capture, signing links and the new pages.

## Email templates, onboarding approval and follow-ups (added 2026-11-01)

- **`APP_URL=https://hifimarketing.co`** must be set: emails load the logo from it and every button links to it.
- **Follow-up sender.** With `JOBS_AUTORUN=1` (recommended on the pm2 server) due follow-ups go out every 15 minutes, nothing else to do. Otherwise add a cron line such as `*/10 * * * * cd /var/www/hifi-one && npm run followups:run >> /var/log/hifi-followups.log 2>&1`, or call `POST /api/jobs/run?only=followups` with the jobs token. Running it often or from two places is safe.
- **Optional:** `FOLLOW_UP_HOURLY_LIMIT` (default 150) caps follow-up emails per hour, separately from the 60-per-hour cap for other system mail. Keep it within your Resend plan.
- **Roles:** the migration gives `email_templates.manage`, `followups.manage` and `onboarding.approve` to Super Admin. Run `npm run roles:sync` to give HR Manager and CEO `onboarding.approve`, Sales Manager `followups.manage`, and Marketing Director both follow-ups and templates.
- New staff accounts now wait for email verification and approval before they can sign in (decision 47). Existing accounts are not affected.

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
