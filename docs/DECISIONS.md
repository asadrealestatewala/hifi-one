# Decisions

Newest last. Each entry: what was decided, why, and what it costs.

1. **Next.js App Router with server actions, no separate API.** One codebase and one auth path; every action re-checks permission on the server. Cost: no public API for integrations yet.
2. **PostgreSQL via Prisma; local database from the `embedded-postgres` package.** No Docker on the dev machine. Production should use managed PostgreSQL. Dev DB `hifi_one`, test DB `hifi_one_test`.
3. **Permissions in the database, enforced by `requirePermission` on every page and action, with a test that fails when a guard is missing.** Roles are editable; `docs/ROLES.md` is generated.
4. **Accounting is double entry with exact decimals; posted lines are immutable (database trigger); corrections are reversals or credit notes.** Revenue is recognised on issue. Totals are per currency; only the consolidated reports convert.
5. **Brand colour follows the red H logo; primary actions are violet.** The original spec suggested blue/purple, which is available as a theme if wanted.
6. **Idempotency keys and row locks on payments and posting** so retries and concurrent users cannot double-post.
7. **Honest integrations.** Mail, ads, WhatsApp Business and AI show "not configured" until credentials exist; click-to-chat links are labelled as such.
8. **Employee monitoring is consent-gated and agent-based.** Policy version and acknowledgement per employee, visible status, screenshots with logged access, retention purge, a Windows console agent (`agent/`). No keylogging or covert capture. A signed installer and macOS/Linux agents are future work. See `docs/MONITORING.md`.
9. **Video meetings are peer-to-peer WebRTC (up to 8 people) with server-sent-event signalling in memory.** Zero extra infrastructure. Cost: no recording, strict networks need a TURN server, a restart ends live rooms. A media server is the upgrade path. See `docs/MEETINGS.md`.
10. **Contacts are the master record; leads and clients link to them and stay in sync.** Avoids duplicate entry across CRM, billing and meetings. Merge archives, never deletes.
11. **Interactive, gamified interface (owner request, after the first version).** Approved deviations from the plain reference: module-coloured icon chips, slide-over forms, a goals card on the dashboard, a navigation progress bar. (The pill tab strip and the sidebar level card were added and later removed, see 18.) Recorded in `docs/DESIGN_SYSTEM.md`.
12. **List screens share one pattern** (KPI strip, URL-based status chips, search, table, slide-over "New"). Filters in the address make views shareable.
13. **Per-user dashboard layout stored in `UserPreference` (JSON), validated against the widgets the person may see.** A widget a person lost access to is never shown or kept.
14. **Menu counts are cached 20 seconds per person** (`unstable_cache`) so the menu adds no per-page cost. Cost: they can lag slightly.
15. **The sidebar level card was removed** (see 18).
16. **Migrations are additive; folder names must sort after the latest.** Two were renamed after creation to fix ordering (databases updated to match).
17. **Production serving uses `npm run serve`; `npm run dev` is for editing only** (first visit to each page compiles it).
19. **Account block at the bottom of the sidebar; profile pictures.** At the owner's request the account menu and sign-out moved from the top bar to the bottom-left of the sidebar. Staff can add a picture (PNG, JPG, WebP, up to 2 MB) on My profile, and HR can set one for a colleague; it is a stored file of type USER_PHOTO, served by `/api/avatar/<id>` only to signed-in staff of the same organization, and shown wherever staff appear (initials when there is none). Clients and vendors see initials.
20. **Content calendar posts can go to several platforms and may have no client.** Own posts are approved by internal review; client posts still need client approval. Dragging a post to another day changes its date only (no new version). Nothing is posted to the platforms: a person marks it published.
21. **Home dashboard follows the owner's sample:** hero with period picker, quick actions, role-based tabs, needs-attention list and arrangeable cards. Every number comes from the same loaders as the reports (ledger balances, receivables aging, leads scope) so dashboard and reports cannot disagree; sections a role cannot see are not computed. The menu group "My Workspace" became "My Space" with items every employee has (profile, help, security, tasks).
22. **Arrange menu is per person and cosmetic:** stored in `UserPreference` (key menu), validated against the menu the person is allowed to see, never produces an empty menu. It is not an access control.
18. **Navigation lives only in the sidebar.** The owner asked to remove the top tab strip (it repeated the menu) and the Prospector level card at the bottom of the sidebar. Level, XP and daily goals stay on the dashboard. Menu count badges stay. Interactivity moved to motion and behaviour instead: fade-in on navigation, hover lift on link cards, whole-row click on tables.
23. **Agentify ERP is a benchmark, not a source.** Its interaction quality (complete UI kit, one list engine, confirmations, one feedback channel, event helper, flow tests, CI) is the bar; its code, schema, palette, font and domain are not copied. Hifi One keeps Next.js, Prisma, PostgreSQL, exact decimals with currency, and its brand. See `docs/REFERENCE_ERP_AUDIT.md`.
24. **Project knowledge lives in the repository.** `CLAUDE.md` holds the rules and the operating contract; `docs/SYSTEM_MAP.md`, `DESIGN_SYSTEM.md`, `DATA_MODEL.md`, `DATA_FLOWS.md`, `MODULE_STATUS.md`, this file and `REFERENCE_ERP_AUDIT.md` hold the detail; `.claude/rules/*.md` hold path-scoped rules. A change that alters architecture, a business rule or a module's status updates the matching file in the same change.

25. **Lists page by number in the address, 50 rows a page** (`src/lib/paging.ts`, `Pager`): shareable, works without client JavaScript, fits the `?status=` chips. Counts and KPIs are separate aggregate queries. Cost: one extra `count` per list; very large tables (audit log, monitoring) may later need cursor paging.
26. **Cross-module notifications live in `src/lib/events.ts`**, one function per business event, called by the action after the service commits, each with a dedupe key. Kept out of ledger transactions so a notification failure can never undo money. Cost: a crash between commit and notify loses that notification.
27. **Destructive and financial buttons use `ConfirmButton`** (native `<dialog>`). Cancelling an invoice and voiding a commission now require a reason, stored in the audit log (`src/lib/reasons.ts`). This adds a required input to two existing actions.

28. **Staff email is optional; the contact number is a second sign-in identifier.** `User.email` became nullable (never invented), `User.phone` holds the E.164 number, unique. A phone number only identifies the account; the password (and two-step code) is always required. Staff get setup links, never passwords chosen by someone else.
29. **One category list.** Campaign categories reuse `ServiceCategory` (the service catalog's list) instead of a second list; "SaaS" is the existing "SaaS Products and Subscriptions". Cost: campaign and catalog categories cannot diverge without splitting later.
30. **New permissions reach existing roles once**, when first registered, following the code defaults; afterwards the Roles screen owns each role. This let `campaigns.view` replace `crm.view` on the Campaigns page without locking anyone out.
31. **Initial records live in code (names, designations, roles, campaigns) and in a git-ignored file (numbers, CNIC)**, reconciled by an idempotent script that only fills gaps.

32. **Workfolio is browser-first and consent-based.** Snapshots come from a screen share the person starts and can stop; there is no covert capture and no live video feed for managers. A live view would need a media relay and explicit written consent.
33. **Client comments live in `TaskComment` with `internal = false`.** One table, one thread per task; the portal reads only non-internal comments on client-visible tasks of the signed-in client.
34. **Menu labels follow the business words:** "Customers" (was Client Accounts) and "Vendors" (was Vendor Directory); the record type is still `Client` in the database.

35. **Scheduled work uses the database as the lock.** One `JobRun` row per organization, job and day, plus a partial unique index allowing one RUNNING row, so any number of schedulers (button, command line, hosted cron, the optional in-process timer) are safe. A session advisory lock was rejected because connection pooling can release it from another connection. Closes the earlier open question about scheduling.
36. **Public endpoints are keyed or tokened, rate limited and answer uniformly.** `/api/jobs/run` needs `JOBS_TOKEN`; `/api/leads/capture` needs a per-source key whose hash is stored and shown once; `/sign/<token>` stores only the token hash. Lead capture answers alike for new and repeated leads.
37. **E-signature is a simple electronic signature.** It records typed name, optional drawing, time, address, browser and the fingerprint of the text. It does not verify identity. The text is frozen when sent and signing refuses if it no longer matches.
38. **Uploads fail closed when a scanner is configured.** With `CLAMAV_HOST` set, an unreachable scanner refuses the upload; with none set, files are stored and labelled not scanned. No simulated "clean".
39. **Time approval is informational.** Profitability counts all logged time; a rejection starts a conversation instead of silently changing costs. Nobody decides on their own hours.
40. **Client reports never carry spend.** The `campaign_client` report is built from a separate section list, tested to contain no spend, budget or cost words.

## Open questions

- Success feedback: `?ok=` query flag (current, visible in the address) or a short-lived flash cookie read by the layout?
- Scheduled work: decided (35), all three ways exist. Which one to use in production is a deployment choice (`docs/DEPLOYMENT.md`).
- Should commission accrue at payment time (inside `recordPayment`) instead of by batch, and should payroll pay approved commissions as the reference does?
- Inline `"use server"` actions in pages vs `actions.ts` per module: standardise on `actions.ts` for new work?

