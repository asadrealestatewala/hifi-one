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

## Open questions

- Pagination style for server lists: page numbers in the URL (shareable, fits current `?status=` chips) or cursor-based for very large tables (audit log, monitoring)? Proposed: page numbers first.
- Success feedback: `?ok=` query flag (current, visible in the address) or a short-lived flash cookie read by the layout?
- Scheduled work (subscription billing, commission accrual, reminders, monitoring purge): an in-process scheduler, an OS task, or a hosted cron calling a guarded route? Affects deployment (`docs/DEPLOYMENT.md`).
- Should commission accrue at payment time (inside `recordPayment`) instead of by batch, and should payroll pay approved commissions as the reference does?
- Inline `"use server"` actions in pages vs `actions.ts` per module: standardise on `actions.ts` for new work?

