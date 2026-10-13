# Audit: verified findings

Method: read the repository, run the checks, open screens in a browser. Only things actually observed are listed as verified.

## Baseline (latest run)

| Check | Result |
|---|---|
| `npx tsc --noEmit` | clean |
| `npx eslint src` | clean |
| `npx vitest run` | 47 files, 704 tests passed (includes a test that every page and action calls an authorization guard, and real-database tests for concurrency, idempotency, immutability, isolation, merge, dashboard layout, contact profile) |
| `npm run build` | succeeds |
| Server speed (production mode, warm) | pages render in about 30 to 200 ms; first request after start about 3.5 s |

## Findings

1. **"Prospector" widget at the bottom-left.** There is no floating or fixed widget in this repository (searched for fixed bottom/left positioning). "Prospector" is a level name (Rookie, Prospector, Closer, Rainmaker, Legend) on the level and goals card at the bottom of the sidebar. That card was in the sidebar's flow and took about 120 px, so on a short window (600 px high) the menu was squeezed and groups below Project Operations were cut off. **Fixed:** the card is now compact (level, name, progress, streak), folds open with an arrow, starts compact below 820 px of window height, and remembers the choice; the menu list scrolls on its own. Verified by type check, lint and build. **Not yet verified visually signed in at several heights.**
2. **Perceived slowness.** The server renders quickly; most slowness came from `npm run dev` compiling pages on first visit and from navigation giving no feedback. Fixed: progress bar on navigation, dashboard queries in parallel (about 190 to 100 ms), menu numbers cached. Use `npm run serve`.
3. **Nothing restarts the app after a reboot**, and a stale process can hold port 3000 (observed). Open.
4. **Content security policy allows inline scripts.** Open.
5. **No browser end-to-end tests**; screens are verified by hand. Open.
6. **Drag-and-drop on the dashboard** was not exercised by script (arrows, hide, save, reload, reset were). Open.
7. **Mail, cross-network video, contact file upload** untested against real services. Open.
8. **Uploaded files are not virus-scanned.** Open.
9. **Migration ordering:** two new migrations initially sorted before an existing one; renamed and both databases updated; `prisma migrate status` reports up to date on dev and test. Closed.
10. **Duplicate-handling defects found and fixed during the build** (all with regression tests): swapped arguments created duplicate contacts; contact sort failed on non-nullable columns; search wildcards matched everything; remote audio was not attached in meetings; browser blocked camera and microphone by header policy; a script-driven save once hung on "Saving…" (believed a test artifact, unresolved).

## Security review notes

Server-side guards on every page and action (test-enforced); org filter on queries; file access follows the owning record; contact merge limited to managers; contact email can only go to addresses on the record; CSV export defuses spreadsheet formulas; social and website links render as links only for http(s). Headers sent: HSTS, nosniff, frame denial, referrer policy, permissions policy, content policy.
