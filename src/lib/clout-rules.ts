// Clout Leader business rules that need no database: link detection, timers, the fast-lane quota, the deleted-post rule,
// slow-down for old posts, backoff and growth. Kept pure so every rule has a plain unit test.
export const PLATFORMS = ["TIKTOK", "INSTAGRAM", "FACEBOOK"] as const;
export type Platform = (typeof PLATFORMS)[number];
export const PLATFORM_LABEL: Record<Platform, string> = { TIKTOK: "TikTok", INSTAGRAM: "Instagram", FACEBOOK: "Facebook" };
export const POST_STATUSES = ["LIVE", "FAILED", "UNAVAILABLE", "PAUSED"] as const;
export type PostStatus = (typeof POST_STATUSES)[number];

// Never refresh a post more often than this, whatever the screen, a quota row or a request says
export const HARD_MIN_SECONDS = 60;
export const FAST_LANE_MAX_SECONDS = 300;
// Where posts that do not fit the fast-lane quota land
export const FALLBACK_SECONDS = 900;
export const TIMER_PRESETS = [
  { seconds: 60, label: "1 minute" }, { seconds: 300, label: "5 minutes" }, { seconds: 900, label: "15 minutes" },
  { seconds: 1800, label: "30 minutes" }, { seconds: 3600, label: "1 hour" }, { seconds: 21600, label: "6 hours" },
] as const;
export const POST_COOLDOWN_SECONDS = 30;
export const CAMPAIGN_COOLDOWN_SECONDS = 60;
export const GONE_LIMIT = 3; // consecutive not-found / private results before a post is marked Deleted/Unavailable
export const PLAN_DEFAULTS = { FREE: 5, STANDARD: 25, PRO: 100 } as const;
export const PUBLIC_DATA_NOTE = "Public data only. Reach, impressions and follows are private to the creator and are not available.";

// ---- Links ----
export type Detected = { platform: Platform; canonicalUrl: string; externalId: string | null };

const trim = (s: string) => s.replace(/\/+$/, "");

// Recognises a public post link of the three supported platforms and returns one canonical form of it, so the same post pasted
// with tracking parameters, "www" or a trailing slash is one post. Anything else (other sites, other kinds of page, links with
// a username or port) is refused, which also keeps the link safe to hand to a command line tool.
export function detectPost(raw: string): Detected | null {
  const text = (raw ?? "").trim();
  if (!text || text.length > 600 || /\s/.test(text)) return null;
  let u: URL;
  try { u = new URL(/^https?:\/\//i.test(text) ? text : `https://${text}`); } catch { return null; }
  if (u.protocol !== "https:" && u.protocol !== "http:") return null;
  if (u.username || u.password || (u.port && u.port !== "443" && u.port !== "80")) return null;
  const host = u.hostname.toLowerCase().replace(/^(www|m|mobile|web|mbasic)\./, "");
  const path = trim(u.pathname);

  if (host === "tiktok.com") {
    const m = /^\/@([\w.\-]{1,64})\/video\/(\d{6,25})$/i.exec(path);
    if (m) return { platform: "TIKTOK", canonicalUrl: `https://www.tiktok.com/@${m[1].toLowerCase()}/video/${m[2]}`, externalId: m[2] };
    const t = /^\/t\/([\w\-]{4,40})$/i.exec(path);
    if (t) return { platform: "TIKTOK", canonicalUrl: `https://www.tiktok.com/t/${t[1]}`, externalId: null };
    return null;
  }
  if (host === "vm.tiktok.com" || host === "vt.tiktok.com") {
    const m = /^\/([\w\-]{4,40})$/.exec(path);
    return m ? { platform: "TIKTOK", canonicalUrl: `https://${host}/${m[1]}`, externalId: null } : null;
  }
  if (host === "instagram.com" || host === "instagr.am") {
    const m = /^(?:\/[\w.]{1,40})?\/(reel|reels|p|tv)\/([\w\-]{5,20})$/.exec(path);
    if (!m) return null;
    const kind = m[1] === "reels" ? "reel" : m[1];
    return { platform: "INSTAGRAM", canonicalUrl: `https://www.instagram.com/${kind}/${m[2]}`, externalId: m[2] };
  }
  if (host === "fb.watch") {
    const m = /^\/([\w\-]{4,40})$/.exec(path);
    return m ? { platform: "FACEBOOK", canonicalUrl: `https://fb.watch/${m[1]}`, externalId: null } : null;
  }
  if (host === "facebook.com" || host === "fb.com") {
    if (path === "/watch") {
      const v = u.searchParams.get("v");
      return v && /^\d{6,25}$/.test(v) ? { platform: "FACEBOOK", canonicalUrl: `https://www.facebook.com/watch/?v=${v}`, externalId: v } : null;
    }
    let m = /^\/reel\/(\d{6,25})$/.exec(path);
    if (m) return { platform: "FACEBOOK", canonicalUrl: `https://www.facebook.com/reel/${m[1]}`, externalId: m[1] };
    m = /^\/[\w.\-]{1,80}\/videos\/(?:[\w\-%]+\/)?(\d{6,25})$/.exec(path);
    if (m) return { platform: "FACEBOOK", canonicalUrl: `https://www.facebook.com/watch/?v=${m[1]}`, externalId: m[1] };
    m = /^\/share\/(v|r)\/([\w\-]{4,40})$/.exec(path);
    if (m) return { platform: "FACEBOOK", canonicalUrl: `https://www.facebook.com/share/${m[1]}/${m[2]}`, externalId: null };
    return null;
  }
  return null;
}

// ---- Timers and quota ----
export function minSecondsFor(quotaMin: number | null | undefined) {
  return Math.max(HARD_MIN_SECONDS, Math.floor(quotaMin ?? HARD_MIN_SECONDS));
}

// The server-side check behind every timer change: a whole number of seconds, never below the minimum
export function validateTimer(seconds: unknown, minSeconds = HARD_MIN_SECONDS): number {
  const n = typeof seconds === "string" ? Number(seconds) : seconds;
  if (typeof n !== "number" || !Number.isFinite(n) || !Number.isInteger(n)) throw new Error("Choose how often the numbers should update.");
  if (n < Math.max(HARD_MIN_SECONDS, minSeconds)) throw new Error(`The fastest update is every ${Math.max(HARD_MIN_SECONDS, minSeconds)} seconds.`);
  if (n > 7 * 86_400) throw new Error("The slowest update is once a week.");
  return n;
}

export const isFastSeconds = (s: number) => s <= FAST_LANE_MAX_SECONDS;

export type LaneInput = { id: string; wantedSeconds: number; pinned: boolean; createdAt: Date; paused?: boolean };
export type LaneResult = { id: string; effectiveSeconds: number; fastLane: boolean; quotaFallback: boolean };

// Decides which posts of one quota bucket (one client, or the company's own) get the fast lane. Posts that asked for 60 s to
// 5 min compete for `quota` places (pinned first, then oldest first); the rest drop to the fallback timer and are flagged so the
// screen can say so. Paused posts take no place. Everything else keeps the timer it asked for.
export function allocateFastLane(posts: LaneInput[], quota: number): LaneResult[] {
  const wantFast = posts.filter((p) => !p.paused && isFastSeconds(p.wantedSeconds))
    .sort((a, b) => Number(b.pinned) - Number(a.pinned) || a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id));
  const granted = new Set(wantFast.slice(0, Math.max(0, quota)).map((p) => p.id));
  return posts.map((p) => {
    if (!p.paused && isFastSeconds(p.wantedSeconds)) {
      return granted.has(p.id)
        ? { id: p.id, effectiveSeconds: p.wantedSeconds, fastLane: true, quotaFallback: false }
        : { id: p.id, effectiveSeconds: FALLBACK_SECONDS, fastLane: false, quotaFallback: true };
    }
    return { id: p.id, effectiveSeconds: p.wantedSeconds, fastLane: false, quotaFallback: false };
  });
}

// How often a post is really checked right now: its lane interval, slower as the post ages (more than 7 days: at most hourly;
// more than 30 days: daily unless pinned). A post someone has open on screen keeps its chosen interval.
export function intervalFor(p: { effectiveSeconds: number; pinned: boolean; postedAt: Date | null; createdAt: Date; lastViewedAt: Date | null }, now: Date): number {
  const viewing = p.lastViewedAt && now.getTime() - p.lastViewedAt.getTime() < 2 * 60_000;
  if (viewing || p.pinned) return Math.max(HARD_MIN_SECONDS, p.effectiveSeconds);
  const ageDays = (now.getTime() - (p.postedAt ?? p.createdAt).getTime()) / 86_400_000;
  if (ageDays > 30) return Math.max(86_400, p.effectiveSeconds);
  if (ageDays > 7) return Math.max(3600, p.effectiveSeconds);
  return Math.max(HARD_MIN_SECONDS, p.effectiveSeconds);
}

// ---- Results ----
export type CheckKind = "ok" | "gone" | "temporary";
export type PostState = { status: PostStatus; consecutiveFailures: number; consecutiveGone: number };
export type Transition = PostState & { becameUnavailable: boolean; retrySeconds: number | null };

// The deleted-post rule. A successful check makes the post Live and clears the counters. A "gone" result (not found, private,
// removed) counts; the third one in a row marks the post Deleted/Unavailable and stops tracking (history is kept). A temporary
// result (blocked, rate limited, network, our own error) only marks the post Failed and backs off: it never counts towards
// deletion and never resets the gone count either, so a block cannot hide or fake a deletion.
export function nextState(prev: PostState, kind: CheckKind, wantedSeconds: number, minSeconds = HARD_MIN_SECONDS): Transition {
  if (prev.status === "UNAVAILABLE" || prev.status === "PAUSED") return { ...prev, becameUnavailable: false, retrySeconds: null };
  if (kind === "ok") return { status: "LIVE", consecutiveFailures: 0, consecutiveGone: 0, becameUnavailable: false, retrySeconds: null };
  if (kind === "gone") {
    const gone = prev.consecutiveGone + 1;
    if (gone >= GONE_LIMIT) return { status: "UNAVAILABLE", consecutiveFailures: prev.consecutiveFailures + 1, consecutiveGone: gone, becameUnavailable: true, retrySeconds: null };
    return { status: "FAILED", consecutiveFailures: prev.consecutiveFailures + 1, consecutiveGone: gone, becameUnavailable: false, retrySeconds: Math.max(minSeconds, Math.min(wantedSeconds, 600)) };
  }
  const fails = prev.consecutiveFailures + 1;
  return { status: "FAILED", consecutiveFailures: fails, consecutiveGone: prev.consecutiveGone, becameUnavailable: false, retrySeconds: backoffSeconds(fails, wantedSeconds) };
}

// Exponential backoff after temporary failures: the post's own interval doubled per failure, at most 6 hours
export function backoffSeconds(failures: number, baseSeconds: number) {
  return Math.min(6 * 3600, Math.max(HARD_MIN_SECONDS, baseSeconds) * 2 ** Math.min(Math.max(failures, 1), 8));
}

// ---- Platform health ----
export type Health = "OK" | "DEGRADED" | "BLOCKED";
export function healthOf(s: { failStreak: number; backoffUntil: Date | null }, now: Date): Health {
  if (s.backoffUntil && s.backoffUntil > now) return "BLOCKED";
  if (s.failStreak >= 3) return "BLOCKED";
  return s.failStreak > 0 ? "DEGRADED" : "OK";
}
// How long to leave a platform alone after a streak of blocked answers: nothing for the first two, then 2, 4, 8 … minutes up to an hour
export function platformBackoffSeconds(failStreak: number) {
  return failStreak < 3 ? 0 : Math.min(3600, 60 * 2 ** (failStreak - 2));
}

// ---- Growth ----
export type Point = { takenAt: Date; views: number; likes: number; comments: number };
export type Growth = { views: number; likes: number; comments: number; partial: boolean };
// Change over the last `windowMs`, measured against the last snapshot taken at or before the start of the window (or the first
// snapshot we have, marked partial, when the post is younger than the window).
export function growthOver(points: Point[], now: Date, windowMs: number): Growth | null {
  if (points.length < 2) return null;
  const sorted = [...points].sort((a, b) => a.takenAt.getTime() - b.takenAt.getTime());
  const last = sorted[sorted.length - 1];
  const start = now.getTime() - windowMs;
  let base = sorted[0];
  let partial = true;
  for (const p of sorted) { if (p.takenAt.getTime() <= start) { base = p; partial = false; } else break; }
  if (base === last) return null;
  return { views: last.views - base.views, likes: last.likes - base.likes, comments: last.comments - base.comments, partial };
}
