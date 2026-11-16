// Content approval workflow rules. Pure, so the UI, the actions and the tests share one definition.
export const CONTENT_STATUSES = ["DRAFT", "INTERNAL_REVIEW", "CLIENT_REVIEW", "CHANGES_REQUESTED", "APPROVED", "SCHEDULED", "PUBLISHED"] as const;
export type ContentStatus = (typeof CONTENT_STATUSES)[number];
export type Actor = "STAFF" | "CLIENT";

// What each kind of person may do from each status.
const STAFF: Record<string, ContentStatus[]> = {
  DRAFT: ["INTERNAL_REVIEW"],
  INTERNAL_REVIEW: ["CLIENT_REVIEW", "DRAFT"],
  CLIENT_REVIEW: ["INTERNAL_REVIEW"], // withdraw from the client
  CHANGES_REQUESTED: ["INTERNAL_REVIEW", "DRAFT"],
  APPROVED: ["SCHEDULED"],
  SCHEDULED: ["PUBLISHED", "APPROVED"],
  PUBLISHED: [],
};
const CLIENT: Record<string, ContentStatus[]> = { CLIENT_REVIEW: ["APPROVED", "CHANGES_REQUESTED"] };

// A post with no client is the company's own: it has nobody to send it to, so internal review approves it directly.
export function canTransition(actor: Actor, from: string, to: string, hasClient = true): boolean {
  if (actor === "STAFF" && !hasClient) {
    if (to === "CLIENT_REVIEW") return false;
    if (from === "INTERNAL_REVIEW" && to === "APPROVED") return true;
  }
  return ((actor === "CLIENT" ? CLIENT : STAFF)[from] ?? []).includes(to as ContentStatus);
}

// A reason is needed whenever someone sends work back or rejects it.
export function needsComment(from: string, to: string): boolean {
  return to === "CHANGES_REQUESTED" || (to === "DRAFT" && from !== "DRAFT");
}

// Copy can only change while it is not in front of the client or already approved.
export const EDITABLE = ["DRAFT", "INTERNAL_REVIEW", "CHANGES_REQUESTED"];
export const isEditable = (status: string) => EDITABLE.includes(status);

export const PLATFORMS = ["YOUTUBE", "FACEBOOK", "INSTAGRAM", "TIKTOK", "SNAPCHAT", "LINKEDIN", "X", "PINTEREST", "WHATSAPP", "OTHER"] as const;
export const POST_TYPES = ["STORY", "REEL", "STATIC", "CAROUSEL", "VIDEO", "LIVE"] as const;

// How each platform and post type is shown (label, short code, brand colour) so the calendar, the sheet and the form agree.
export const PLATFORM_META: Record<string, { label: string; code: string; color: string }> = {
  YOUTUBE: { label: "YouTube", code: "YT", color: "#ff0000" }, FACEBOOK: { label: "Facebook", code: "f", color: "#1877f2" }, INSTAGRAM: { label: "Instagram", code: "IG", color: "#e1306c" },
  TIKTOK: { label: "TikTok", code: "TT", color: "#111827" }, SNAPCHAT: { label: "Snapchat", code: "SC", color: "#d4a900" }, LINKEDIN: { label: "LinkedIn", code: "in", color: "#0a66c2" },
  X: { label: "X (Twitter)", code: "X", color: "#000000" }, PINTEREST: { label: "Pinterest", code: "P", color: "#e60023" }, WHATSAPP: { label: "WhatsApp status", code: "WA", color: "#22c55e" }, OTHER: { label: "Other", code: "?", color: "#6b7280" },
};
export const POST_TYPE_LABEL: Record<string, string> = { STORY: "Story", REEL: "Reel", STATIC: "Static post", CAROUSEL: "Carousel", VIDEO: "Video", LIVE: "Live" };

export const isTime = (v: string) => /^([01]\d|2[0-3]):[0-5]\d$/.test(v);
export const isDate = (v: string) => { if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return false; const d = new Date(v + "T00:00:00Z"); return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v; };

// ---------- Captions per platform ----------
// Longest caption each platform accepts (characters, hashtags included). Checked before a post goes to the client.
export const CAPTION_LIMITS: Record<string, number> = {
  INSTAGRAM: 2200, FACEBOOK: 63206, TIKTOK: 2200, LINKEDIN: 3000, YOUTUBE: 5000, X: 280, PINTEREST: 500, SNAPCHAT: 250, WHATSAPP: 700, OTHER: 63206,
};
export const MAX_HASHTAGS: Record<string, number> = { INSTAGRAM: 30, TIKTOK: 30, LINKEDIN: 30, X: 30, YOUTUBE: 15, PINTEREST: 20, FACEBOOK: 30 };

export type PlatformCopy = Record<string, string>;
// Only known platforms with some text are kept
export function cleanPlatformCopy(v: unknown): PlatformCopy {
  const out: PlatformCopy = {};
  if (!v || typeof v !== "object" || Array.isArray(v)) return out;
  for (const [k, t] of Object.entries(v as Record<string, unknown>)) {
    if ((PLATFORMS as readonly string[]).includes(k) && typeof t === "string" && t.trim()) out[k] = t;
  }
  return out;
}

// The words that go to one platform: its own caption if it has one, else the main caption; hashtags added after a blank line
export function captionFor(item: { copy: string; hashtags: string | null; platformCopy?: unknown }, platform: string): string {
  const own = cleanPlatformCopy(item.platformCopy)[platform];
  const body = (own ?? item.copy).trim();
  const tags = (item.hashtags ?? "").trim();
  return tags ? `${body}\n\n${tags}` : body;
}

export const countHashtags = (text: string) => (text.match(/(^|\s)#[^\s#]+/g) ?? []).length;

// Problems that would make a platform reject the post or cut it off. Empty means ready.
export function captionIssues(item: { copy: string; hashtags: string | null; platformCopy?: unknown; platforms: string[] }): { platform: string; message: string }[] {
  const issues: { platform: string; message: string }[] = [];
  for (const p of item.platforms) {
    const text = captionFor(item, p), limit = CAPTION_LIMITS[p] ?? 63206, name = PLATFORM_META[p]?.label ?? p;
    if (text.length > limit) issues.push({ platform: p, message: `${name}: ${text.length} characters, the limit is ${limit}. Shorten it or give ${name} its own caption.` });
    const tags = countHashtags(text), max = MAX_HASHTAGS[p];
    if (max && tags > max) issues.push({ platform: p, message: `${name}: ${tags} hashtags, at most ${max} are allowed.` });
  }
  return issues;
}
