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
18. **Navigation lives only in the sidebar.** The owner asked to remove the top tab strip (it repeated the menu) and the Prospector level card at the bottom of the sidebar. Level, XP and daily goals stay on the dashboard. Menu count badges stay. Interactivity moved to motion and behaviour instead: fade-in on navigation, hover lift on link cards, whole-row click on tables.
