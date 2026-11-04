// Read side of Clout Leader: dashboard figures, lists, post detail, exports, conversions and the client/shared report.
// Every function takes the already-built scope (staff scope, or the client scope from the signed-in portal user), never ids from a request.
import crypto from "node:crypto";
import type { Prisma, PrismaClient } from "@prisma/client";
import { growthOver, type Growth, type Point } from "./clout-rules";
import { num } from "./clout";
import { tableCsv } from "./crm-contacts";

type Db = PrismaClient;

export const POST_SORTS = ["views", "likes", "comments", "growth", "checked", "added", "platform", "status"] as const;
export const SORT_COLUMNS: Record<string, { field: string; nullable?: boolean }> = {
  views: { field: "views" }, likes: { field: "likes" }, comments: { field: "comments" }, growth: { field: "viewsDelta" },
  checked: { field: "lastSuccessAt", nullable: true }, added: { field: "createdAt" }, platform: { field: "platform" }, status: { field: "status" },
};

export type PostRow = {
  id: string; platform: string; url: string; status: string; pinned: boolean; fastLane: boolean; quotaFallback: boolean; effectiveSeconds: number; refreshSeconds: number | null;
  views: number; likes: number; comments: number; shares: number | null; saves: number | null; viewsDelta: number; likesDelta: number; commentsDelta: number;
  caption: string | null; authorHandle: string | null; thumbnailUrl: string | null; postedAt: Date | null; trackingCode: string | null; trackingLink: string | null;
  lastSuccessAt: Date | null; lastCheckedAt: Date | null; lastError: string | null; lastProvider: string | null; createdAt: Date; unavailableAt: Date | null;
  campaignId: string; campaignName: string; influencerId: string | null; influencerName: string | null; projectId: string | null; projectName: string | null;
};

const include = { cloutCampaign: { select: { id: true, campaign: { select: { name: true } } } }, influencer: { select: { name: true } }, project: { select: { name: true } } } satisfies Prisma.CloutPostInclude;
type Raw = Prisma.CloutPostGetPayload<{ include: typeof include }>;

export const toRow = (p: Raw): PostRow => ({
  id: p.id, platform: p.platform, url: p.url, status: p.status, pinned: p.pinned, fastLane: p.fastLane, quotaFallback: p.quotaFallback, effectiveSeconds: p.effectiveSeconds, refreshSeconds: p.refreshSeconds,
  views: num(p.views), likes: num(p.likes), comments: num(p.comments), shares: p.shares == null ? null : num(p.shares), saves: p.saves == null ? null : num(p.saves),
  viewsDelta: num(p.viewsDelta), likesDelta: num(p.likesDelta), commentsDelta: num(p.commentsDelta),
  caption: p.caption, authorHandle: p.authorHandle, thumbnailUrl: p.thumbnailUrl, postedAt: p.postedAt, trackingCode: p.trackingCode, trackingLink: p.trackingLink,
  lastSuccessAt: p.lastSuccessAt, lastCheckedAt: p.lastCheckedAt, lastError: p.lastError, lastProvider: p.lastProvider, createdAt: p.createdAt, unavailableAt: p.unavailableAt,
  campaignId: p.cloutCampaignId, campaignName: p.cloutCampaign.campaign.name, influencerId: p.influencerId, influencerName: p.influencer?.name ?? null, projectId: p.projectId, projectName: p.project?.name ?? null,
});

export async function listPosts(db: Db, where: Prisma.CloutPostWhereInput, orderBy: Prisma.CloutPostOrderByWithRelationInput[], skip: number, take: number) {
  const [rows, total] = await Promise.all([db.cloutPost.findMany({ where, orderBy, skip, take, include }), db.cloutPost.count({ where })]);
  return { rows: rows.map(toRow), total };
}

export type Totals = { views: number; likes: number; comments: number; live: number; posts: number; unavailable: number };
export async function totals(db: Db, where: Prisma.CloutPostWhereInput): Promise<Totals> {
  const [sum, live, posts, unavailable] = await Promise.all([
    db.cloutPost.aggregate({ where, _sum: { views: true, likes: true, comments: true } }),
    db.cloutPost.count({ where: { ...where, status: { in: ["LIVE", "FAILED"] } } }), db.cloutPost.count({ where }), db.cloutPost.count({ where: { ...where, status: "UNAVAILABLE" } }),
  ]);
  return { views: num(sum._sum.views), likes: num(sum._sum.likes), comments: num(sum._sum.comments), live, posts, unavailable };
}

export type Group = { key: string; label: string; posts: number; views: number; likes: number; comments: number };
// Breakdown for the detailed report behind each dashboard card
export async function breakdown(db: Db, where: Prisma.CloutPostWhereInput, by: "platform" | "campaign" | "influencer"): Promise<Group[]> {
  const field = by === "platform" ? "platform" : by === "campaign" ? "cloutCampaignId" : "influencerId";
  const g = await db.cloutPost.groupBy({ by: [field], where, _count: true, _sum: { views: true, likes: true, comments: true } });
  const keys = g.map((x) => x[field] as string | null).filter(Boolean) as string[];
  const names = new Map<string, string>();
  if (by === "campaign") for (const c of await db.cloutCampaign.findMany({ where: { id: { in: keys } }, select: { id: true, campaign: { select: { name: true } } } })) names.set(c.id, c.campaign.name);
  if (by === "influencer") for (const i of await db.cloutInfluencer.findMany({ where: { id: { in: keys } }, select: { id: true, name: true } })) names.set(i.id, i.name);
  return g.map((x) => { const k = (x[field] as string | null) ?? ""; return { key: k, label: by === "platform" ? k : names.get(k) ?? (by === "influencer" ? "No influencer" : "Unknown"), posts: x._count, views: num(x._sum.views), likes: num(x._sum.likes), comments: num(x._sum.comments) }; })
    .sort((a, b) => b.views - a.views);
}

export type Detail = { post: PostRow; points: Point[]; chart: Point[]; growth: { sinceLast: Growth | null; hour: Growth | null; day: Growth | null }; conversions: number | null; snapshotCount: number };

export async function postDetail(db: Db, where: Prisma.CloutPostWhereInput, id: string, now = new Date()): Promise<Detail | null> {
  const p = await db.cloutPost.findFirst({ where: { ...where, id }, include });
  if (!p) return null;
  const snaps = await db.cloutSnapshot.findMany({ where: { postId: p.id }, orderBy: { takenAt: "desc" }, take: 5000, select: { takenAt: true, views: true, likes: true, comments: true } });
  const points: Point[] = snaps.reverse().map((s) => ({ takenAt: s.takenAt, views: num(s.views), likes: num(s.likes), comments: num(s.comments) }));
  const row = toRow(p);
  const since = points.length >= 2 ? { views: row.viewsDelta, likes: row.likesDelta, comments: row.commentsDelta, partial: false } : null;
  const conv = row.trackingCode ? (await conversionCounts(db, p.organizationId, [row.trackingCode])).get(row.trackingCode.toLowerCase()) ?? 0 : null;
  return { post: row, points, chart: downsample(points, 240), growth: { sinceLast: since, hour: growthOver(points, now, 3_600_000), day: growthOver(points, now, 86_400_000) }, conversions: conv, snapshotCount: points.length };
}

// Keeps the first and last point and spreads the rest evenly, so a post with thousands of snapshots still draws a light chart
export function downsample<T>(items: T[], max: number): T[] {
  if (items.length <= max) return items;
  const out: T[] = [];
  for (let i = 0; i < max; i++) out.push(items[Math.round((i * (items.length - 1)) / (max - 1))]);
  return out;
}

// Leads in the CRM that came in through a post's promo code: the code is matched, ignoring capitals, against the lead's
// utm_campaign (set by a tracking link) or one of its tags (set by hand or by a form).
export async function conversionCounts(db: Db, organizationId: string, codes: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  for (const code of [...new Set(codes.map((c) => c.trim()).filter(Boolean))]) {
    const n = await db.lead.count({ where: { organizationId, OR: [{ utmCampaign: { equals: code, mode: "insensitive" } }, { tags: { hasSome: [code, code.toLowerCase(), code.toUpperCase()] } }] } });
    out.set(code.toLowerCase(), n);
  }
  return out;
}

export async function conversionsByInfluencer(db: Db, organizationId: string, where: Prisma.CloutPostWhereInput) {
  const posts = await db.cloutPost.findMany({ where: { ...where, trackingCode: { not: null } }, select: { trackingCode: true, influencerId: true } });
  const counts = await conversionCounts(db, organizationId, posts.map((p) => p.trackingCode!));
  const byInf = new Map<string, Set<string>>();
  for (const p of posts) { const k = p.influencerId ?? ""; (byInf.get(k) ?? byInf.set(k, new Set()).get(k)!).add(p.trackingCode!.toLowerCase()); }
  const names = new Map((await db.cloutInfluencer.findMany({ where: { organizationId }, select: { id: true, name: true } })).map((i) => [i.id, i.name]));
  return [...byInf.entries()].map(([k, codes]) => ({ influencerId: k || null, name: k ? names.get(k) ?? "Unknown" : "No influencer", codes: [...codes], leads: [...codes].reduce((a, c) => a + (counts.get(c) ?? 0), 0) })).sort((a, b) => b.leads - a.leads);
}

// ---- Exports ----
const iso = (d: Date | null) => (d ? d.toISOString() : "");
export async function postsCsv(db: Db, where: Prisma.CloutPostWhereInput): Promise<string> {
  const head = ["Platform", "Link", "Campaign", "Influencer", "Project", "Author", "Status", "Views", "Likes", "Comments", "Shares", "Saves", "Views change since last check", "Posted", "Last updated", "Tracking code", "Tracking link", "Caption"];
  const rows: unknown[][] = [];
  let cursor: string | undefined;
  for (;;) {
    const batch = await db.cloutPost.findMany({ where, orderBy: { id: "asc" }, take: 1000, ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}), include });
    if (batch.length === 0) break;
    for (const r of batch.map(toRow)) rows.push([r.platform, r.url, r.campaignName, r.influencerName ?? "", r.projectName ?? "", r.authorHandle ?? "", r.status, r.views, r.likes, r.comments, r.shares ?? "", r.saves ?? "", r.viewsDelta, iso(r.postedAt), iso(r.lastSuccessAt), r.trackingCode ?? "", r.trackingLink ?? "", r.caption ?? ""]);
    cursor = batch[batch.length - 1].id;
  }
  return tableCsv(head, rows);
}

export async function snapshotsCsv(db: Db, where: Prisma.CloutPostWhereInput): Promise<string> {
  const head = ["Taken at", "Platform", "Link", "Campaign", "Influencer", "Views", "Likes", "Comments", "Shares", "Saves", "Source"];
  const rows: unknown[][] = [];
  let cursor: string | undefined;
  for (;;) {
    const batch = await db.cloutSnapshot.findMany({ where: { post: where }, orderBy: [{ takenAt: "asc" }, { id: "asc" }], take: 2000, ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}), include: { post: { select: { platform: true, url: true, influencer: { select: { name: true } }, cloutCampaign: { select: { campaign: { select: { name: true } } } } } } } });
    if (batch.length === 0) break;
    for (const s of batch) rows.push([iso(s.takenAt), s.post.platform, s.post.url, s.post.cloutCampaign.campaign.name, s.post.influencer?.name ?? "", num(s.views), num(s.likes), num(s.comments), s.shares == null ? "" : num(s.shares), s.saves == null ? "" : num(s.saves), s.provider ?? ""]);
    cursor = batch[batch.length - 1].id;
  }
  return tableCsv(head, rows);
}

// ---- Shareable client report ----
export async function setShareToken(db: Db, p: { organizationId: string; cloutCampaignId: string; on: boolean }) {
  const cc = await db.cloutCampaign.findFirst({ where: { id: p.cloutCampaignId, organizationId: p.organizationId } });
  if (!cc) return null;
  const token = p.on ? crypto.randomBytes(24).toString("base64url") : null;
  await db.cloutCampaign.update({ where: { id: cc.id }, data: { shareToken: token } });
  return token;
}

// What the shared page may show: public numbers of the posts, no internal notes, phone numbers, rates or error text
export async function sharedReport(db: Db, token: string) {
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(token)) return null;
  const cc = await db.cloutCampaign.findUnique({ where: { shareToken: token }, include: { campaign: { select: { name: true } } } });
  if (!cc) return null;
  const where: Prisma.CloutPostWhereInput = { cloutCampaignId: cc.id };
  const [t, posts] = await Promise.all([totals(db, where), listPosts(db, where, [{ views: "desc" }, { id: "asc" }], 0, 200)]);
  return { name: cc.campaign.name, totals: t, posts: posts.rows.map((r) => ({ id: r.id, platform: r.platform, url: r.url, author: r.authorHandle, influencer: r.influencerName, status: r.status, views: r.views, likes: r.likes, comments: r.comments, updated: r.lastSuccessAt })), total: posts.total };
}
