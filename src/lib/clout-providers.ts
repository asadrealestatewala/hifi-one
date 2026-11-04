// Where Clout Leader gets public post numbers from. Every source implements StatsProvider, so a platform can use one source as
// primary and another as backup (settings per platform) and new sources can be added without touching the rest.
// Only public data of a link we were given: no logins, no cookies, no private-account tricks.
import { execFile } from "node:child_process";
import type { Platform } from "./clout-rules";

export type Stats = {
  views: number | null; likes: number | null; comments: number | null; shares: number | null; saves: number | null;
  caption: string | null; author: string | null; postedAt: Date | null; thumbnail: string | null; externalId: string | null;
};
// gone = the post does not exist or is private (counts towards "deleted"); blocked = the platform refused us; error = anything else temporary;
// not_configured / unsupported = this source cannot answer (no tool or token, or platform not covered), never counts against the post.
export type FailKind = "gone" | "blocked" | "error" | "not_configured" | "unsupported";
export type ProviderResult = { ok: true; stats: Stats } | { ok: false; kind: FailKind; message: string };
export type ProviderId = "YTDLP" | "APIFY" | "FUTURE";
export const PROVIDER_IDS: ProviderId[] = ["YTDLP", "APIFY", "FUTURE"];
export const PROVIDER_LABEL: Record<ProviderId, string> = { YTDLP: "yt-dlp (free)", APIFY: "Apify (paid backup)", FUTURE: "Future provider (not built)" };

export interface StatsProvider {
  id: ProviderId;
  fetch(url: string, platform: Platform): Promise<ProviderResult>;
}

const int = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.round(v) : typeof v === "string" && /^\d+$/.test(v) ? Number(v) : null);
const str = (v: unknown, max: number): string | null => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);
const date = (v: unknown): Date | null => {
  if (typeof v === "number" && v > 0) return new Date((v > 1e12 ? v : v * 1000));
  if (typeof v === "string" && v) { const d = new Date(v); if (!Number.isNaN(d.getTime())) return d; }
  return null;
};
const safeUrl = (v: unknown): string | null => { const s = str(v, 1000); return s && /^https:\/\//i.test(s) ? s : null; };

// ---- yt-dlp ----
// What yt-dlp prints on stderr, sorted into "the post is gone" and "the platform is blocking us". When in doubt the answer is
// temporary (error), because a wrong "gone" could stop tracking a live post.
export function classifyYtDlpError(stderr: string): { kind: FailKind; message: string } {
  const text = stderr.trim();
  const line = (text.split("\n").filter((l) => /error/i.test(l)).pop() ?? text.split("\n").pop() ?? "").replace(/^ERROR:\s*/i, "").slice(0, 300);
  const t = text.toLowerCase();
  if (/(login|log in|sign in|cookies|authentication) (is )?(required|needed)|rate[- ]limit|too many requests|\b429\b|\b403\b|forbidden|captcha|blocked|bot|unable to connect to proxy|ip address|try again later|temporarily/.test(t)) return { kind: "blocked", message: line || "The platform refused the request." };
  if (/video (is )?(unavailable|not available)|this video (is )?(private|unavailable)|is private|has been removed|was removed|no longer available|does not exist|doesn't exist|not found|\b404\b|content (isn't|is not) available|deleted|has been deleted|page isn't available/.test(t)) return { kind: "gone", message: line || "The post was not found." };
  return { kind: "error", message: line || "The check failed." };
}

export function parseYtDlpJson(raw: string): Stats | null {
  let j: Record<string, unknown>;
  try { const v = JSON.parse(raw) as unknown; if (!v || typeof v !== "object" || Array.isArray(v)) return null; j = v as Record<string, unknown>; } catch { return null; }
  if (Array.isArray(j.entries) && j.entries.length > 0 && typeof j.entries[0] === "object") j = j.entries[0] as Record<string, unknown>;
  const views = int(j.view_count), likes = int(j.like_count), comments = int(j.comment_count);
  if (views === null && likes === null && comments === null) return null;
  return {
    views, likes, comments, shares: int(j.repost_count ?? j.share_count), saves: int(j.save_count ?? j.favorite_count),
    caption: str(j.description, 2000) ?? str(j.title, 2000), author: str(j.uploader_id, 120) ?? str(j.uploader, 120) ?? str(j.channel, 120),
    postedAt: date(j.timestamp ?? j.upload_date), thumbnail: safeUrl(j.thumbnail), externalId: str(j.id, 60),
  };
}

type Runner = (cmd: string, args: string[], timeoutMs: number) => Promise<{ code: number | null; stdout: string; stderr: string; missing?: boolean }>;
export const run: Runner = (cmd, args, timeoutMs) => new Promise((resolve) => {
  // No shell: the link is a plain argument after "--", so it can never be read as an option or a command
  execFile(cmd, args, { timeout: timeoutMs, maxBuffer: 16 * 1024 * 1024, windowsHide: true }, (err, stdout, stderr) => {
    if (!err) return resolve({ code: 0, stdout, stderr });
    const e = err as NodeJS.ErrnoException & { killed?: boolean; code?: number | string };
    if (e.code === "ENOENT") return resolve({ code: null, stdout, stderr, missing: true });
    resolve({ code: typeof e.code === "number" ? e.code : 1, stdout, stderr: e.killed ? `${stderr}\nTimed out` : stderr });
  });
});

// pm2 and cron often start with a short PATH that lacks the per-user pip folder, so the usual places are tried too
const BIN_CANDIDATES = () => [process.env.YTDLP_PATH, "yt-dlp", process.env.HOME ? `${process.env.HOME}/.local/bin/yt-dlp` : undefined, "/usr/local/bin/yt-dlp", "/usr/bin/yt-dlp"].filter(Boolean) as string[];

export class YtDlpProvider implements StatsProvider {
  id = "YTDLP" as const;
  private found: string | null = null;
  constructor(private runner: Runner = run, private bin?: string) {}
  private async exec(args: string[], timeout: number) {
    const tryBins = this.bin ? [this.bin] : this.found ? [this.found] : BIN_CANDIDATES();
    let last: Awaited<ReturnType<Runner>> = { code: null, stdout: "", stderr: "", missing: true };
    for (const b of tryBins) {
      last = await this.runner(b, args, timeout);
      if (!last.missing) { if (!this.bin) this.found = b; return last; }
    }
    return last;
  }
  async fetch(url: string): Promise<ProviderResult> {
    const r = await this.exec( ["--dump-json", "--skip-download", "--no-warnings", "--no-playlist", "--no-cache-dir", "--socket-timeout", "20", "--retries", "1", "--", url], 60_000);
    if (r.missing) return { ok: false, kind: "not_configured", message: "yt-dlp is not installed on this server." };
    if (r.code === 0) {
      const stats = parseYtDlpJson(r.stdout.trim().split("\n")[0] ?? "");
      return stats ? { ok: true, stats } : { ok: false, kind: "error", message: "yt-dlp answered but gave no view, like or comment numbers." };
    }
    const c = classifyYtDlpError(r.stderr);
    return { ok: false, kind: c.kind, message: c.message };
  }
}

// ---- Apify ----
// Backup source. Needs APIFY_TOKEN in the server environment. Actor ids can be changed with the APIFY_ACTOR_* variables.
// Field names differ per actor, so the mapping below is defensive; it has not been tested against a live token.
const ACTORS: Record<Platform, { env: string; fallback: string; input: (url: string) => Record<string, unknown> }> = {
  TIKTOK: { env: "APIFY_ACTOR_TIKTOK", fallback: "clockworks~tiktok-scraper", input: (u) => ({ postURLs: [u], resultsPerPage: 1, shouldDownloadVideos: false, shouldDownloadCovers: false }) },
  INSTAGRAM: { env: "APIFY_ACTOR_INSTAGRAM", fallback: "apify~instagram-scraper", input: (u) => ({ directUrls: [u], resultsType: "posts", resultsLimit: 1, addParentData: false }) },
  FACEBOOK: { env: "APIFY_ACTOR_FACEBOOK", fallback: "apify~facebook-reels-scraper", input: (u) => ({ startUrls: [{ url: u }], resultsLimit: 1 }) },
};

export function mapApifyItem(item: Record<string, unknown>): Stats | null {
  const author = (item.authorMeta ?? item.author) as Record<string, unknown> | undefined;
  const views = int(item.playCount ?? item.videoPlayCount ?? item.videoViewCount ?? item.viewsCount ?? item.viewCount ?? item.views);
  const likes = int(item.diggCount ?? item.likesCount ?? item.likes);
  const comments = int(item.commentCount ?? item.commentsCount ?? item.comments);
  if (views === null && likes === null && comments === null) return null;
  return {
    views, likes, comments, shares: int(item.shareCount ?? item.sharesCount ?? item.shares), saves: int(item.collectCount ?? item.savesCount),
    caption: str(item.text ?? item.caption ?? item.title ?? item.description, 2000),
    author: str(author?.name, 120) ?? str(item.ownerUsername, 120) ?? str(item.pageName, 120) ?? str(item.user, 120),
    postedAt: date(item.createTimeISO ?? item.timestamp ?? item.createTime ?? item.time), thumbnail: safeUrl((item.videoMeta as Record<string, unknown> | undefined)?.coverUrl ?? item.displayUrl ?? item.thumbnail),
    externalId: str(item.id ?? item.shortCode, 60),
  };
}

export class ApifyProvider implements StatsProvider {
  id = "APIFY" as const;
  constructor(private fetcher: typeof fetch = fetch, private token = () => process.env.APIFY_TOKEN) {}
  async fetch(url: string, platform: Platform): Promise<ProviderResult> {
    const token = this.token();
    if (!token) return { ok: false, kind: "not_configured", message: "Apify is not configured (APIFY_TOKEN is not set on the server)." };
    const actor = ACTORS[platform];
    const id = process.env[actor.env] || actor.fallback;
    try {
      const res = await this.fetcher(`https://api.apify.com/v2/acts/${encodeURIComponent(id)}/run-sync-get-dataset-items?timeout=90`, {
        method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}` }, body: JSON.stringify(actor.input(url)), signal: AbortSignal.timeout(100_000),
      });
      if (res.status === 401 || res.status === 403) return { ok: false, kind: "not_configured", message: "Apify rejected the token." };
      if (res.status === 402) return { ok: false, kind: "blocked", message: "The Apify account is out of credit." };
      if (res.status === 429) return { ok: false, kind: "blocked", message: "Apify is rate limiting us." };
      if (!res.ok) return { ok: false, kind: "error", message: `Apify answered ${res.status}.` };
      const items = (await res.json()) as unknown;
      const first = Array.isArray(items) ? (items[0] as Record<string, unknown> | undefined) : undefined;
      if (!first) return { ok: false, kind: "gone", message: "Apify found no post at that link." };
      if (first.error || first.errorDescription) return { ok: false, kind: "error", message: String(first.errorDescription ?? first.error).slice(0, 200) };
      const stats = mapApifyItem(first);
      return stats ? { ok: true, stats } : { ok: false, kind: "error", message: "Apify answered without view, like or comment numbers." };
    } catch (e) {
      return { ok: false, kind: "error", message: `Apify request failed: ${(e as Error).message}`.slice(0, 200) };
    }
  }
}

// Placeholder so settings can already name a future source. It never answers.
export class FutureProvider implements StatsProvider {
  id = "FUTURE" as const;
  async fetch(): Promise<ProviderResult> { return { ok: false, kind: "not_configured", message: "This provider is not built yet." }; }
}

export type Registry = Record<ProviderId, StatsProvider>;
export const defaultRegistry = (): Registry => ({ YTDLP: new YtDlpProvider(), APIFY: new ApifyProvider(), FUTURE: new FutureProvider() });

export type Answer =
  | { ok: true; stats: Stats; provider: ProviderId; tried: ProviderId[] }
  | { ok: false; kind: "gone" | "blocked" | "error" | "not_configured"; message: string; tried: ProviderId[]; provider: ProviderId | null };

// Asks the primary source; if it cannot answer, asks the backup. The first good answer wins and says who gave it. When both fail,
// the post counts as gone only if every source that could answer said so; a block or error from either keeps it temporary.
export async function fetchWithFallback(registry: Registry, url: string, platform: Platform, primary: ProviderId, fallback: ProviderId | null): Promise<Answer> {
  const order = [primary, ...(fallback && fallback !== primary ? [fallback] : [])];
  const results: { id: ProviderId; r: Extract<ProviderResult, { ok: false }> }[] = [];
  for (const id of order) {
    let r: ProviderResult;
    try { r = await registry[id].fetch(url, platform); } catch (e) { r = { ok: false, kind: "error", message: (e as Error).message.slice(0, 200) }; }
    if (r.ok) return { ok: true, stats: r.stats, provider: id, tried: order.slice(0, order.indexOf(id) + 1) };
    results.push({ id, r });
  }
  const answering = results.filter((x) => x.r.kind !== "not_configured" && x.r.kind !== "unsupported");
  const last = results[results.length - 1];
  if (answering.length === 0) return { ok: false, kind: "not_configured", message: last.r.message, tried: order, provider: null };
  const kind = answering.every((x) => x.r.kind === "gone") ? "gone" : answering.some((x) => x.r.kind === "blocked") ? "blocked" : "error";
  const worst = answering.find((x) => x.r.kind === (kind === "gone" ? "gone" : kind)) ?? answering[0];
  return { ok: false, kind, message: worst.r.message, tried: order, provider: worst.id };
}

// Keeps yt-dlp current: platforms change often and an old yt-dlp is the usual reason a platform stops answering.
export async function updateYtDlp(runner: Runner = run, bins: string[] = BIN_CANDIDATES()): Promise<string> {
  let a: Awaited<ReturnType<Runner>> = { code: null, stdout: "", stderr: "", missing: true };
  for (const b of bins) { a = await runner(b, ["-U"], 120_000); if (!a.missing) break; }
  if (a.missing) return "yt-dlp is not installed";
  const out = `${a.stdout}\n${a.stderr}`;
  if (a.code === 0 && !/pip|package manager|use .* to update/i.test(out)) return out.trim().split("\n").pop() ?? "updated";
  for (const py of ["python3", "python"]) {
    const b = await runner(py, ["-m", "pip", "install", "-U", "--user", "--break-system-packages", "yt-dlp"], 180_000);
    if (!b.missing && b.code === 0) return "updated with pip";
    if (!b.missing) { const c = await runner(py, ["-m", "pip", "install", "-U", "--user", "yt-dlp"], 180_000); if (c.code === 0) return "updated with pip"; }
  }
  return "update failed";
}

export async function ytDlpVersion(runner: Runner = run, bins: string[] = BIN_CANDIDATES()): Promise<string | null> {
  for (const b of bins) { const r = await runner(b, ["--version"], 15_000); if (!r.missing) return r.code === 0 ? r.stdout.trim() : null; }
  return null;
}
