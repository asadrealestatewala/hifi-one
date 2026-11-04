# Clout Leader (influencer post tracker)

Added 2026-11-04. Staff paste the public link of a video an influencer posted (TikTok, Instagram Reel or post, Facebook video or Reel) and Hifi One keeps its public views, likes and comments up to date for as long as the post exists. Influencers never connect accounts. Only public data of the links we are given is read: no logins, no cookies, no private accounts. Reach, impressions and follows gained are private to the creator and are not shown (the screens say so). Conversions cannot be read from a post: an optional promo code per post is matched against CRM leads instead.

## Screens

| Route | Who | What |
|---|---|---|
| `/clout` | `clout.view` (staff) | KPI cards (views, likes, comments, live posts; each opens `/clout/report?metric=…`), add-post box, filterable and sortable posts table, platform health strip (managers), auto-refreshing |
| `/clout/[id]` | `clout.view`, in scope | one post: numbers, change since last check / hour / 24 h, growth charts from snapshots, timer, Refresh now, links and promo code, pause/pin/remove (managers) |
| `/clout/campaigns`, `/clout/campaigns/[id]` | `clout.view`, in scope; switching tracking on, client, share link: `clout.manage` | campaign timer, Refresh all, exports, leads by promo code |
| `/clout/influencers` | `clout.manage` | influencer records (name, handles per platform, phone, notes, optional rate) |
| `/clout/settings` | `clout.settings` (Super Admin) | primary and backup source per platform, platform health, fast-lane quota per client or plan, per-client minimum interval |
| `/clout/report` | `clout.view` | breakdown behind each card by platform, campaign, influencer |
| `/clout/export?kind=posts\|snapshots` | `clout.view`, same scope | CSV (formula-safe) |
| `/portal/clout`, `/portal/clout/[id]` | client portal user | the client's own campaigns only, read-only plus timer and Refresh now within quota |
| `/clout-report/[token]` | anyone with the secret link | read-only public numbers of one campaign; switched off by the manager; `noindex` |

## Data (migration `20261104140000_clout_leader`, permissions in `…140100_clout_permissions`)

`CloutInfluencer`, `CloutCampaign` (tracking settings of an existing `Campaign`: timer, owning `clientId`, share token), `CloutPost` (current numbers, status, lane, next check; unique per organization and canonical link; index on `status, nextCheckAt`), `CloutSnapshot` (one per successful check), `CloutProviderSetting` (per platform: primary, backup, failure streak, back-off), `CloutQuota` (per client, or the company default when `clientId` is empty: plan, fast posts, minimum seconds). Numbers are `BigInt`.

## Rules (all in `src/lib/clout-rules.ts`, tested)

- **Links:** only the three platforms' post links are accepted; one canonical form per post (tracking parameters, `www`, trailing slash dropped); links with credentials or ports are refused. Short links (`vm.tiktok.com`, `fb.watch`, `/share/…`) are accepted and de-duplicated again by the platform's post id after the first fetch.
- **Timer:** presets 1, 5, 15, 30 min, 1 h, 6 h. Never below 60 seconds, enforced in `validateTimer` for campaign and post timers and in `saveQuota` (a client's minimum can be raised, never lowered). Maximum one week.
- **Fast lane:** timers of 60 s to 5 min are "fast". Each quota bucket (one client, or the company) has N fast places (defaults Free 5, Standard 25, Pro 100, or custom). `allocateFastLane`: pinned first, then oldest; the rest fall back to 15 minutes and are flagged `quotaFallback`, which every screen explains. `reallocateBucket` re-runs after any timer, quota, pause or client change.
- **Ageing:** posts older than 7 days are checked at most hourly, older than 30 days daily, unless pinned. A post open on someone's screen (seen in the last 2 minutes) keeps its chosen interval.
- **Deleted posts:** a "gone" answer (not found, private, removed) counts; the third in a row marks the post **Deleted/Unavailable**, stops tracking, keeps history and notifies the campaign owner (or users with `clout.manage`). Blocks, rate limits, network and our own errors only mark the post **Failed** and back off (doubling, at most 6 h); they never count towards deletion. A good check resets everything. When two sources are configured, "gone" needs every answering source to say so.
- **Cooldowns:** Refresh now 30 s per post, Refresh all 60 s per campaign, claimed atomically in the database so double clicks and two staff run once.
- **Platform health:** OK, Degraded (1–2 refusals in a row), Blocked (3+; requests to that platform pause for 2, 4, 8 … minutes up to an hour). A missing post does not count against the platform.

## Providers (`src/lib/clout-providers.ts`)

`StatsProvider` interface with `YtDlpProvider` (default), `ApifyProvider` (backup, `APIFY_TOKEN` in the server environment; actor ids overridable with `APIFY_ACTOR_TIKTOK|INSTAGRAM|FACEBOOK`), and `FutureProvider` (stub). Super Admin picks the primary and backup per platform; `fetchWithFallback` retries with the backup and records which source answered (`CloutPost.lastProvider`). yt-dlp runs without a shell: `yt-dlp --dump-json --skip-download --no-warnings --no-playlist … -- <url>`; stderr is classified into gone / blocked / error, and unknown errors count as temporary so a live post is never stopped by mistake.

## Worker

`scripts/clout-worker.mts` (`npm run clout:worker`), run by pm2 as `hifi-clout-worker` (started by the deploy workflow). Every few seconds `runDueBatch` takes posts due now (viewed posts first), claims them in the database, and reads a small batch: at most 2 at once, a random 0.3–2 s pause before each request, a minimum gap per platform (TikTok 2.5 s, Instagram and Facebook 7 s), platforms in back-off skipped. Weekly it updates yt-dlp (`yt-dlp -U`, else pip; stamp file in `STORAGE_DIR` or `.data`). The deploy workflow installs or upgrades yt-dlp with pip for the deploy user on every deploy.

## Permissions

`clout.view` (staff on campaigns they own or belong to; see and add posts, set timers, Refresh now, edit links), `clout.manage` (everything: all campaigns, influencers, tracking on/off, client, pause/pin/remove, share links; Sales Manager, Marketing Director, CMO, Super Admin), `clout.settings` (providers and quotas; Super Admin only). `clout.view` also goes to COO, CEO, Sales Agent, Project Manager and the Ads roles. Clients use `requireClientUser`; the client id always comes from the session and every query filters on `CloutCampaign.clientId`.

## Honest limits

- Which platforms really answer depends on the server's IP and on the platform that day. Facebook and Instagram often require a login for public posts and may refuse a data-centre server; that shows as "Blocked" in platform health, never as a deleted post. The Apify backup is the answer for those.
- Apify field mapping is written defensively but was not run against a live token.
- Snapshots are kept forever (one per successful check). A 60-second post adds about 1,440 rows a day; a retention policy is a follow-up.
- Shares and saves are stored when the platform exposes them, otherwise empty.
