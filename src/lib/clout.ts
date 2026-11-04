// Clout Leader: tracks the public numbers of influencer posts. This file is the single writer of CloutPost, CloutSnapshot,
// CloutProviderSetting and CloutQuota. Free of Next.js imports so it can be tested against the database and run by the worker.
import type { Prisma, PrismaClient } from "@prisma/client";
import { PLATFORMS, type Platform, GONE_LIMIT, HARD_MIN_SECONDS, CAMPAIGN_COOLDOWN_SECONDS, FALLBACK_SECONDS, POST_COOLDOWN_SECONDS, PLAN_DEFAULTS, allocateFastLane, detectPost, healthOf, intervalFor, minSecondsFor, nextState, platformBackoffSeconds, validateTimer } from "./clout-rules";
import { PROVIDER_IDS, defaultRegistry, fetchWithFallback, type ProviderId, type Registry } from "./clout-providers";
import { notifyMany, usersWithPermission } from "./notifications";

type Db = PrismaClient;
export class CloutError extends Error {}

const clean = (v: string | null | undefined, max: number) => { const t = (v ?? "").trim(); return t ? t.slice(0, max) : null; };
export const num = (v: bigint | number | null | undefined) => (v == null ? 0 : Number(v));
const big = (v: number | null | undefined) => (v == null ? null : BigInt(Math.max(0, Math.round(v))));

// ---- Who sees what ----
export type CloutActor = { id: string; organizationId: string; permissions: ReadonlySet<string> };
export const canManage = (u: CloutActor) => u.permissions.has("clout.manage");

// Staff with clout.manage see every tracked campaign; other staff only campaigns they own or are a member of.
export function campaignScope(u: CloutActor): Prisma.CloutCampaignWhereInput {
  if (canManage(u)) return { organizationId: u.organizationId };
  return { organizationId: u.organizationId, campaign: { OR: [{ ownerId: u.id }, { members: { some: { userId: u.id } } }] } };
}
export const postScope = (u: CloutActor): Prisma.CloutPostWhereInput => ({ organizationId: u.organizationId, cloutCampaign: campaignScope(u) });
// A client sees only the campaigns assigned to its own client record; the id always comes from the signed-in portal user.
export const clientScope = (clientId: string): Prisma.CloutPostWhereInput => ({ cloutCampaign: { clientId } });

// ---- Quotas and provider settings ----
export async function getQuota(db: Db, organizationId: string, clientId: string | null) {
  const row = (clientId ? await db.cloutQuota.findFirst({ where: { organizationId, clientId } }) : null) ?? (await db.cloutQuota.findFirst({ where: { organizationId, clientId: null } }));
  return { plan: row?.plan ?? "FREE", fastPosts: row?.fastPosts ?? PLAN_DEFAULTS.FREE, minSeconds: minSecondsFor(row?.minSeconds), custom: Boolean(row && (clientId ? row.clientId === clientId : true)) };
}

export async function saveQuota(db: Db, p: { organizationId: string; clientId: string | null; plan: string; fastPosts?: number; minSeconds?: number }) {
  const plan = ["FREE", "STANDARD", "PRO", "CUSTOM"].includes(p.plan) ? p.plan : null;
  if (!plan) throw new CloutError("Choose a plan.");
  const fast = plan === "CUSTOM" ? p.fastPosts : PLAN_DEFAULTS[plan as keyof typeof PLAN_DEFAULTS];
  if (fast == null || !Number.isInteger(fast) || fast < 0 || fast > 100_000) throw new CloutError("Enter how many posts may use the fast lane (0 to 100000).");
  const min = p.minSeconds ?? HARD_MIN_SECONDS;
  if (!Number.isInteger(min) || min < HARD_MIN_SECONDS || min > 3600) throw new CloutError(`The fastest allowed update cannot be below ${HARD_MIN_SECONDS} seconds.`);
  if (p.clientId && !(await db.client.findFirst({ where: { id: p.clientId, organizationId: p.organizationId }, select: { id: true } }))) throw new CloutError("Unknown client.");
  const existing = await db.cloutQuota.findFirst({ where: { organizationId: p.organizationId, clientId: p.clientId } });
  if (existing) await db.cloutQuota.update({ where: { id: existing.id }, data: { plan, fastPosts: fast, minSeconds: min } });
  else await db.cloutQuota.create({ data: { organizationId: p.organizationId, clientId: p.clientId, plan, fastPosts: fast, minSeconds: min } });
  await reallocateBucket(db, p.organizationId, p.clientId);
  // clients without their own row follow the default, so re-balance them too
  if (!p.clientId) {
    const own = new Set((await db.cloutQuota.findMany({ where: { organizationId: p.organizationId, clientId: { not: null } }, select: { clientId: true } })).map((q) => q.clientId));
    const buckets = await db.cloutCampaign.findMany({ where: { organizationId: p.organizationId, clientId: { not: null } }, select: { clientId: true }, distinct: ["clientId"] });
    for (const b of buckets) if (b.clientId && !own.has(b.clientId)) await reallocateBucket(db, p.organizationId, b.clientId);
  }
}

export type ProviderChoice = { primary: ProviderId; fallback: ProviderId | null; failStreak: number; backoffUntil: Date | null; lastOkAt: Date | null; lastErrorAt: Date | null; lastError: string | null };
export async function providerSettings(db: Db, organizationId: string): Promise<Record<Platform, ProviderChoice>> {
  const rows = await db.cloutProviderSetting.findMany({ where: { organizationId } });
  const out = {} as Record<Platform, ProviderChoice>;
  for (const pl of PLATFORMS) {
    const r = rows.find((x) => x.platform === pl);
    out[pl] = { primary: (r?.primary as ProviderId) ?? "YTDLP", fallback: (r?.fallback as ProviderId | null) ?? null, failStreak: r?.failStreak ?? 0, backoffUntil: r?.backoffUntil ?? null, lastOkAt: r?.lastOkAt ?? null, lastErrorAt: r?.lastErrorAt ?? null, lastError: r?.lastError ?? null };
  }
  return out;
}

export async function saveProviderSetting(db: Db, p: { organizationId: string; platform: string; primary: string; fallback: string | null }) {
  if (!(PLATFORMS as readonly string[]).includes(p.platform)) throw new CloutError("Unknown platform.");
  if (!(PROVIDER_IDS as string[]).includes(p.primary)) throw new CloutError("Choose a primary source.");
  const fallback = p.fallback && p.fallback !== "NONE" ? p.fallback : null;
  if (fallback && !(PROVIDER_IDS as string[]).includes(fallback)) throw new CloutError("Choose a backup source.");
  if (fallback === p.primary) throw new CloutError("The backup must be different from the primary source.");
  await db.cloutProviderSetting.upsert({
    where: { organizationId_platform: { organizationId: p.organizationId, platform: p.platform } },
    create: { organizationId: p.organizationId, platform: p.platform, primary: p.primary, fallback },
    update: { primary: p.primary, fallback },
  });
}

// ---- Tracked campaigns and timers ----
export async function enableCampaign(db: Db, p: { organizationId: string; campaignId: string; clientId?: string | null }) {
  const campaign = await db.campaign.findFirst({ where: { id: p.campaignId, organizationId: p.organizationId }, select: { id: true } });
  if (!campaign) throw new CloutError("Campaign not found.");
  if (p.clientId && !(await db.client.findFirst({ where: { id: p.clientId, organizationId: p.organizationId }, select: { id: true } }))) throw new CloutError("Unknown client.");
  const existing = await db.cloutCampaign.findUnique({ where: { campaignId: p.campaignId } });
  if (existing) return existing;
  return db.cloutCampaign.create({ data: { organizationId: p.organizationId, campaignId: p.campaignId, clientId: p.clientId || null } });
}

export async function setCampaignClient(db: Db, p: { organizationId: string; cloutCampaignId: string; clientId: string | null }) {
  const cc = await db.cloutCampaign.findFirst({ where: { id: p.cloutCampaignId, organizationId: p.organizationId } });
  if (!cc) throw new CloutError("Campaign not found.");
  if (p.clientId && !(await db.client.findFirst({ where: { id: p.clientId, organizationId: p.organizationId }, select: { id: true } }))) throw new CloutError("Unknown client.");
  await db.cloutCampaign.update({ where: { id: cc.id }, data: { clientId: p.clientId } });
  await reallocateBucket(db, p.organizationId, cc.clientId);
  await reallocateBucket(db, p.organizationId, p.clientId);
}

// The one place that decides how fast each post of one quota bucket refreshes. Called after anything that changes a timer, a quota,
// a post's pause state or which client a campaign belongs to.
export async function reallocateBucket(db: Db, organizationId: string, clientId: string | null) {
  const quota = await getQuota(db, organizationId, clientId);
  const posts = await db.cloutPost.findMany({
    where: { organizationId, status: { in: ["LIVE", "FAILED", "PAUSED"] }, cloutCampaign: { clientId } },
    select: { id: true, pinned: true, createdAt: true, status: true, refreshSeconds: true, effectiveSeconds: true, fastLane: true, quotaFallback: true, nextCheckAt: true, cloutCampaign: { select: { refreshSeconds: true } } },
  });
  const lanes = allocateFastLane(posts.map((p) => ({ id: p.id, wantedSeconds: p.refreshSeconds ?? p.cloutCampaign.refreshSeconds, pinned: p.pinned, createdAt: p.createdAt, paused: p.status === "PAUSED" })), quota.fastPosts);
  const byId = new Map(posts.map((p) => [p.id, p]));
  for (const l of lanes) {
    const p = byId.get(l.id)!;
    if (p.effectiveSeconds === l.effectiveSeconds && p.fastLane === l.fastLane && p.quotaFallback === l.quotaFallback) continue;
    // a post that just became faster is due sooner, never later than its new interval
    const soonest = new Date(Date.now() + l.effectiveSeconds * 1000);
    await db.cloutPost.update({ where: { id: l.id }, data: { effectiveSeconds: l.effectiveSeconds, fastLane: l.fastLane, quotaFallback: l.quotaFallback, ...(p.nextCheckAt && p.nextCheckAt > soonest ? { nextCheckAt: soonest } : {}) } });
  }
  return lanes;
}

export async function setCampaignTimer(db: Db, p: { organizationId: string; cloutCampaignId: string; seconds: unknown }) {
  const cc = await db.cloutCampaign.findFirst({ where: { id: p.cloutCampaignId, organizationId: p.organizationId } });
  if (!cc) throw new CloutError("Campaign not found.");
  const quota = await getQuota(db, p.organizationId, cc.clientId);
  let seconds: number;
  try { seconds = validateTimer(p.seconds, quota.minSeconds); } catch (e) { throw new CloutError((e as Error).message); }
  await db.cloutCampaign.update({ where: { id: cc.id }, data: { refreshSeconds: seconds } });
  const lanes = await reallocateBucket(db, p.organizationId, cc.clientId);
  const ids = new Set((await db.cloutPost.findMany({ where: { cloutCampaignId: cc.id }, select: { id: true } })).map((x) => x.id));
  return { seconds, fellBack: lanes.filter((l) => ids.has(l.id) && l.quotaFallback).length, fastPosts: quota.fastPosts };
}

export async function setPostTimer(db: Db, p: { organizationId: string; postId: string; seconds: unknown | null }) {
  const post = await db.cloutPost.findFirst({ where: { id: p.postId, organizationId: p.organizationId }, include: { cloutCampaign: { select: { clientId: true } } } });
  if (!post) throw new CloutError("Post not found.");
  const quota = await getQuota(db, p.organizationId, post.cloutCampaign.clientId);
  let seconds: number | null = null;
  if (p.seconds !== null && p.seconds !== "") { try { seconds = validateTimer(p.seconds, quota.minSeconds); } catch (e) { throw new CloutError((e as Error).message); } }
  await db.cloutPost.update({ where: { id: post.id }, data: { refreshSeconds: seconds } });
  const lanes = await reallocateBucket(db, p.organizationId, post.cloutCampaign.clientId);
  return { seconds, fellBack: Boolean(lanes.find((l) => l.id === post.id)?.quotaFallback) };
}

// ---- Adding posts ----
export type AddPostInput = { url: string; cloutCampaignId: string; influencerId?: string | null; projectId?: string | null; trackingCode?: string | null; trackingLink?: string | null };
export type AddResult = { postId: string; status: string; message: string };
export type Deps = { registry?: Registry; now?: () => Date };

export async function addPost(db: Db, actor: CloutActor, input: AddPostInput, deps: Deps = {}): Promise<AddResult> {
  const found = detectPost(input.url);
  if (!found) throw new CloutError("That is not a TikTok, Instagram or Facebook video link. Paste the full link of one post, for example a TikTok video, an Instagram Reel or post, or a Facebook video or Reel.");
  const cc = await db.cloutCampaign.findFirst({ where: { id: input.cloutCampaignId, ...campaignScope(actor) } });
  if (!cc) throw new CloutError("Choose one of your campaigns.");
  if (input.influencerId && !(await db.cloutInfluencer.findFirst({ where: { id: input.influencerId, organizationId: actor.organizationId }, select: { id: true } }))) throw new CloutError("Unknown influencer.");
  if (input.projectId && !(await db.project.findFirst({ where: { id: input.projectId, organizationId: actor.organizationId }, select: { id: true } }))) throw new CloutError("Unknown project.");
  const trackingCode = clean(input.trackingCode, 60);
  const trackingLink = clean(input.trackingLink, 500);
  if (trackingLink && !/^https?:\/\/\S+$/i.test(trackingLink)) throw new CloutError("The tracking link must start with http:// or https://.");
  const dup = await db.cloutPost.findFirst({ where: { organizationId: actor.organizationId, canonicalUrl: found.canonicalUrl }, select: { id: true } });
  if (dup) throw new CloutError("This post is already being tracked.");
  const now = (deps.now ?? (() => new Date()))();
  let post;
  try {
    post = await db.cloutPost.create({ data: {
      organizationId: actor.organizationId, cloutCampaignId: cc.id, influencerId: input.influencerId || null, projectId: input.projectId || null,
      platform: found.platform, url: input.url.trim().slice(0, 600), canonicalUrl: found.canonicalUrl, externalId: found.externalId, trackingCode, trackingLink,
      addedById: actor.id, nextCheckAt: now, effectiveSeconds: cc.refreshSeconds,
    } });
  } catch (e) {
    if ((e as { code?: string }).code === "P2002") throw new CloutError("This post is already being tracked.");
    throw e;
  }
  await reallocateBucket(db, actor.organizationId, cc.clientId);
  const r = await checkPost(db, post.id, { ...deps, firstCheck: true });
  if (r.outcome === "gone") {
    await db.cloutPost.delete({ where: { id: post.id } });
    throw new CloutError("That post could not be found. It may be private, deleted, or the link may be wrong, so it was not added.");
  }
  if (r.outcome === "duplicate") {
    await db.cloutPost.delete({ where: { id: post.id } });
    await reallocateBucket(db, actor.organizationId, cc.clientId);
    throw new CloutError("This post is already being tracked.");
  }
  return { postId: post.id, status: r.status, message: r.outcome === "ok" ? "Post added. The numbers below are live." : `Post added, but the first check did not work: ${r.message} It will be tried again automatically.` };
}

// ---- Checking a post ----
export type CheckOutcome = { outcome: "ok" | "gone" | "temporary" | "duplicate" | "skipped"; status: string; message: string };

// Reads one post through the platform's providers and saves the result: a snapshot on success, the status rules on failure,
// the platform's health either way. Never throws for a platform problem.
export async function checkPost(db: Db, postId: string, deps: Deps & { firstCheck?: boolean } = {}): Promise<CheckOutcome> {
  const now = (deps.now ?? (() => new Date()))();
  const registry = deps.registry ?? defaultRegistry();
  const post = await db.cloutPost.findUnique({ where: { id: postId }, include: { cloutCampaign: { select: { clientId: true, campaign: { select: { ownerId: true, name: true } } } } } });
  if (!post) return { outcome: "skipped", status: "MISSING", message: "Post not found." };
  if (post.status === "UNAVAILABLE" || post.status === "PAUSED") return { outcome: "skipped", status: post.status, message: "This post is not being tracked." };
  const platform = post.platform as Platform;
  const settings = (await providerSettings(db, post.organizationId))[platform];
  const answer = await fetchWithFallback(registry, post.url, platform, settings.primary, settings.fallback);
  const quota = await getQuota(db, post.organizationId, post.cloutCampaign.clientId);
  const wanted = post.refreshSeconds ?? post.effectiveSeconds;

  if (answer.ok) {
    const s = answer.stats;
    if (s.externalId) {
      const other = await db.cloutPost.findFirst({ where: { organizationId: post.organizationId, platform, externalId: s.externalId, id: { not: post.id } }, select: { id: true } });
      if (other && deps.firstCheck) return { outcome: "duplicate", status: post.status, message: "This post is already being tracked." };
    }
    const first = post.lastSuccessAt === null;
    const views = s.views ?? num(post.views), likes = s.likes ?? num(post.likes), comments = s.comments ?? num(post.comments);
    const next = nextState({ status: post.status as never, consecutiveFailures: post.consecutiveFailures, consecutiveGone: post.consecutiveGone }, "ok", wanted, quota.minSeconds);
    const interval = intervalFor({ effectiveSeconds: post.effectiveSeconds, pinned: post.pinned, postedAt: s.postedAt ?? post.postedAt, createdAt: post.createdAt, lastViewedAt: post.lastViewedAt }, now);
    await db.$transaction([
      db.cloutSnapshot.create({ data: { postId: post.id, takenAt: now, views: BigInt(views), likes: BigInt(likes), comments: BigInt(comments), shares: big(s.shares), saves: big(s.saves), provider: answer.provider } }),
      db.cloutPost.update({ where: { id: post.id }, data: {
        status: next.status, consecutiveFailures: 0, consecutiveGone: 0, lastError: null, lastProvider: answer.provider, lastCheckedAt: now, lastSuccessAt: now, nextCheckAt: new Date(now.getTime() + interval * 1000),
        views: BigInt(views), likes: BigInt(likes), comments: BigInt(comments), shares: s.shares == null ? post.shares : BigInt(s.shares), saves: s.saves == null ? post.saves : BigInt(s.saves),
        viewsDelta: first ? BigInt(0) : BigInt(views - num(post.views)), likesDelta: first ? BigInt(0) : BigInt(likes - num(post.likes)), commentsDelta: first ? BigInt(0) : BigInt(comments - num(post.comments)),
        caption: s.caption ?? post.caption, authorHandle: s.author ?? post.authorHandle, thumbnailUrl: s.thumbnail ?? post.thumbnailUrl, postedAt: s.postedAt ?? post.postedAt, externalId: post.externalId ?? s.externalId,
      } }),
    ]);
    await recordPlatform(db, post.organizationId, platform, now, null);
    return { outcome: "ok", status: next.status, message: `Updated by ${answer.provider === "YTDLP" ? "yt-dlp" : answer.provider === "APIFY" ? "Apify" : answer.provider}.` };
  }

  const kind = answer.kind === "gone" ? "gone" : "temporary";
  const t = nextState({ status: post.status as never, consecutiveFailures: post.consecutiveFailures, consecutiveGone: post.consecutiveGone }, kind, wanted, quota.minSeconds);
  const message = answer.message.slice(0, 300);
  await db.cloutPost.update({ where: { id: post.id }, data: {
    status: t.status, consecutiveFailures: t.consecutiveFailures, consecutiveGone: t.consecutiveGone, lastError: message, lastProvider: answer.provider, lastCheckedAt: now,
    nextCheckAt: t.retrySeconds == null ? null : new Date(now.getTime() + t.retrySeconds * 1000), unavailableAt: t.becameUnavailable ? now : post.unavailableAt,
  } });
  if (answer.kind !== "gone") await recordPlatform(db, post.organizationId, platform, now, message);
  else await recordPlatform(db, post.organizationId, platform, now, null); // a missing post says nothing about the platform: it answered
  if (t.becameUnavailable) {
    const c = post.cloutCampaign.campaign;
    const targets = c.ownerId ? [c.ownerId] : await usersWithPermission(db, post.organizationId, "clout.manage");
    await notifyMany(db, targets, { kind: "clout.unavailable", title: `A post in ${c.name} is no longer available`, body: `${post.authorHandle ? `${post.authorHandle}'s ` : ""}${post.platform.toLowerCase()} post was not found ${GONE_LIMIT} times in a row (deleted or made private). Tracking stopped; its history is kept.`, link: `/clout/${post.id}`, dedupeKey: `clout-gone:${post.id}` });
  }
  return { outcome: kind === "gone" ? "gone" : "temporary", status: t.status, message };
}

// A good answer resets the platform's failure streak; a refusal or error extends it and, from the third in a row, pauses requests to
// that platform for longer each time (2, 4, 8 … minutes, up to an hour).
async function recordPlatform(db: Db, organizationId: string, platform: Platform, now: Date, error: string | null) {
  const cur = await db.cloutProviderSetting.findUnique({ where: { organizationId_platform: { organizationId, platform } } });
  if (!error) {
    if (!cur || (cur.failStreak === 0 && !cur.backoffUntil)) {
      await db.cloutProviderSetting.upsert({ where: { organizationId_platform: { organizationId, platform } }, create: { organizationId, platform, lastOkAt: now }, update: { lastOkAt: now } });
      return;
    }
    await db.cloutProviderSetting.update({ where: { id: cur.id }, data: { failStreak: 0, backoffUntil: null, lastOkAt: now } });
    return;
  }
  const streak = (cur?.failStreak ?? 0) + 1;
  const wait = platformBackoffSeconds(streak);
  await db.cloutProviderSetting.upsert({
    where: { organizationId_platform: { organizationId, platform } },
    create: { organizationId, platform, failStreak: streak, lastErrorAt: now, lastError: error, backoffUntil: wait ? new Date(now.getTime() + wait * 1000) : null },
    update: { failStreak: streak, lastErrorAt: now, lastError: error, backoffUntil: wait ? new Date(now.getTime() + wait * 1000) : null },
  });
}

export async function platformHealth(db: Db, organizationId: string, now = new Date()) {
  const s = await providerSettings(db, organizationId);
  return PLATFORMS.map((p) => ({ platform: p, health: healthOf(s[p], now), ...s[p] }));
}

// ---- Manual refresh ----
const waitText = (ms: number) => `Wait ${Math.max(1, Math.ceil(ms / 1000))} seconds before refreshing again.`;

export async function refreshPostNow(db: Db, p: { organizationId: string; postId: string; where?: Prisma.CloutPostWhereInput }, deps: Deps = {}): Promise<CheckOutcome> {
  const now = (deps.now ?? (() => new Date()))();
  const post = await db.cloutPost.findFirst({ where: { id: p.postId, organizationId: p.organizationId, ...(p.where ?? {}) }, select: { id: true, status: true, platform: true, lastManualAt: true } });
  if (!post) throw new CloutError("Post not found.");
  if (post.status === "UNAVAILABLE") throw new CloutError("This post is no longer available, so it is not tracked any more.");
  if (post.status === "PAUSED") throw new CloutError("This post is paused. Resume it first.");
  const settings = (await providerSettings(db, p.organizationId))[post.platform as Platform];
  if (settings.backoffUntil && settings.backoffUntil > now) throw new CloutError(`${post.platform.toLowerCase()} is not answering right now. The next try is allowed in ${Math.ceil((settings.backoffUntil.getTime() - now.getTime()) / 60000)} minute(s).`);
  // Claim the cooldown slot atomically so two quick clicks cannot both run
  const claimed = await db.cloutPost.updateMany({ where: { id: post.id, OR: [{ lastManualAt: null }, { lastManualAt: { lte: new Date(now.getTime() - POST_COOLDOWN_SECONDS * 1000) } }] }, data: { lastManualAt: now } });
  if (claimed.count === 0) throw new CloutError(waitText(post.lastManualAt ? post.lastManualAt.getTime() + POST_COOLDOWN_SECONDS * 1000 - now.getTime() : 1000));
  return checkPost(db, post.id, deps);
}

// Marks every tracked post of the campaign as due now; the background worker then reads them in small, spaced batches.
export async function refreshCampaignNow(db: Db, p: { organizationId: string; cloutCampaignId: string; where?: Prisma.CloutCampaignWhereInput }, now = new Date()) {
  const cc = await db.cloutCampaign.findFirst({ where: { id: p.cloutCampaignId, organizationId: p.organizationId, ...(p.where ?? {}) } });
  if (!cc) throw new CloutError("Campaign not found.");
  const claimed = await db.cloutCampaign.updateMany({ where: { id: cc.id, OR: [{ lastRefreshAllAt: null }, { lastRefreshAllAt: { lte: new Date(now.getTime() - CAMPAIGN_COOLDOWN_SECONDS * 1000) } }] }, data: { lastRefreshAllAt: now } });
  if (claimed.count === 0) throw new CloutError(waitText(cc.lastRefreshAllAt ? cc.lastRefreshAllAt.getTime() + CAMPAIGN_COOLDOWN_SECONDS * 1000 - now.getTime() : 1000));
  const r = await db.cloutPost.updateMany({ where: { cloutCampaignId: cc.id, status: { in: ["LIVE", "FAILED"] } }, data: { nextCheckAt: now } });
  return r.count;
}

// ---- Post actions ----
export async function setPostStatus(db: Db, p: { organizationId: string; postId: string; action: "pause" | "resume" | "pin" | "unpin" }) {
  const post = await db.cloutPost.findFirst({ where: { id: p.postId, organizationId: p.organizationId }, include: { cloutCampaign: { select: { clientId: true } } } });
  if (!post) throw new CloutError("Post not found.");
  if (p.action === "pause") { if (post.status === "UNAVAILABLE") throw new CloutError("This post is no longer available."); await db.cloutPost.update({ where: { id: post.id }, data: { status: "PAUSED", nextCheckAt: null } }); }
  else if (p.action === "resume") { if (post.status !== "PAUSED" && post.status !== "UNAVAILABLE") return; await db.cloutPost.update({ where: { id: post.id }, data: { status: "LIVE", consecutiveFailures: 0, consecutiveGone: 0, unavailableAt: null, nextCheckAt: new Date() } }); }
  else await db.cloutPost.update({ where: { id: post.id }, data: { pinned: p.action === "pin" } });
  await reallocateBucket(db, p.organizationId, post.cloutCampaign.clientId);
}

export async function deletePost(db: Db, p: { organizationId: string; postId: string }) {
  const post = await db.cloutPost.findFirst({ where: { id: p.postId, organizationId: p.organizationId }, include: { cloutCampaign: { select: { clientId: true } } } });
  if (!post) throw new CloutError("Post not found.");
  await db.cloutPost.delete({ where: { id: post.id } });
  await reallocateBucket(db, p.organizationId, post.cloutCampaign.clientId);
}

export async function updatePostLinks(db: Db, p: { organizationId: string; postId: string; influencerId: string | null; projectId: string | null; trackingCode: string | null; trackingLink: string | null; where?: Prisma.CloutPostWhereInput }) {
  const post = await db.cloutPost.findFirst({ where: { id: p.postId, organizationId: p.organizationId, ...(p.where ?? {}) }, select: { id: true } });
  if (!post) throw new CloutError("Post not found.");
  if (p.influencerId && !(await db.cloutInfluencer.findFirst({ where: { id: p.influencerId, organizationId: p.organizationId }, select: { id: true } }))) throw new CloutError("Unknown influencer.");
  if (p.projectId && !(await db.project.findFirst({ where: { id: p.projectId, organizationId: p.organizationId }, select: { id: true } }))) throw new CloutError("Unknown project.");
  const trackingLink = clean(p.trackingLink, 500);
  if (trackingLink && !/^https?:\/\/\S+$/i.test(trackingLink)) throw new CloutError("The tracking link must start with http:// or https://.");
  await db.cloutPost.update({ where: { id: post.id }, data: { influencerId: p.influencerId, projectId: p.projectId, trackingCode: clean(p.trackingCode, 60), trackingLink } });
}

// Called when posts are on someone's screen, so the worker keeps them at their chosen interval
export async function touchViewed(db: Db, ids: string[], now = new Date()) {
  if (ids.length === 0) return;
  await db.cloutPost.updateMany({ where: { id: { in: ids.slice(0, 200) } }, data: { lastViewedAt: now } });
}

// ---- Influencers ----
export type InfluencerInput = { name: string; tiktok?: string | null; instagram?: string | null; facebook?: string | null; phone?: string | null; notes?: string | null; rate?: string | null; rateCurrency?: string | null; active?: boolean };
export async function saveInfluencer(db: Db, p: { organizationId: string; id?: string; input: InfluencerInput }) {
  const i = p.input;
  const name = (i.name ?? "").trim();
  if (name.length < 2 || name.length > 100) throw new CloutError("Give the influencer a name of 2 to 100 characters.");
  const rate = clean(i.rate, 20);
  if (rate && !/^\d{1,12}(\.\d{1,2})?$/.test(rate)) throw new CloutError("Enter the rate as a number, or leave it empty.");
  const handles: Record<string, string> = {};
  for (const [k, v] of [["TIKTOK", i.tiktok], ["INSTAGRAM", i.instagram], ["FACEBOOK", i.facebook]] as const) { const h = clean(v, 120); if (h) handles[k] = h; }
  const data = { name, handles, phone: clean(i.phone, 40), notes: clean(i.notes, 1000), rate, rateCurrency: clean(i.rateCurrency, 3)?.toUpperCase() ?? "USD", active: i.active ?? true };
  try {
    if (p.id) {
      const r = await db.cloutInfluencer.updateMany({ where: { id: p.id, organizationId: p.organizationId }, data });
      if (r.count === 0) throw new CloutError("Influencer not found.");
      return p.id;
    }
    return (await db.cloutInfluencer.create({ data: { ...data, organizationId: p.organizationId } })).id;
  } catch (e) {
    if ((e as { code?: string }).code === "P2002") throw new CloutError("An influencer with that name already exists.");
    throw e;
  }
}

// ---- The background worker's unit of work ----
export type BatchOptions = Deps & {
  batchSize?: number; concurrency?: number; jitterMs?: [number, number]; platformGapMs?: Partial<Record<Platform, number>>;
  sleep?: (ms: number) => Promise<void>; random?: () => number; organizationId?: string;
};
export type BatchResult = { picked: number; ok: number; failed: number; gone: number; skippedPlatforms: Platform[] };

const DEFAULT_GAPS: Record<Platform, number> = { TIKTOK: 2500, INSTAGRAM: 7000, FACEBOOK: 7000 };
const realSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// Picks posts that are due (people's open posts first), skips platforms that are cooling down after blocks, and reads them in a small
// batch: at most `concurrency` at once, a random pause before each request, and a minimum gap between requests to the same platform.
export async function runDueBatch(db: Db, o: BatchOptions = {}): Promise<BatchResult> {
  const now = (o.now ?? (() => new Date()))();
  const batch = o.batchSize ?? 10, conc = Math.max(1, o.concurrency ?? 2);
  const sleep = o.sleep ?? realSleep, rnd = o.random ?? Math.random;
  const [lo, hi] = o.jitterMs ?? [300, 2000];
  const gaps = { ...DEFAULT_GAPS, ...(o.platformGapMs ?? {}) };
  const orgFilter = o.organizationId ? { organizationId: o.organizationId } : {};
  const cooling = new Set<Platform>();
  const rows = await db.cloutProviderSetting.findMany({ where: { ...orgFilter, backoffUntil: { gt: now } }, select: { platform: true } });
  for (const r of rows) cooling.add(r.platform as Platform);
  const platformsOk = PLATFORMS.filter((p) => !cooling.has(p));
  const due: Prisma.CloutPostWhereInput = { ...orgFilter, status: { in: ["LIVE", "FAILED"] }, nextCheckAt: { lte: now }, platform: { in: [...platformsOk] } };
  const viewed = await db.cloutPost.findMany({ where: { ...due, lastViewedAt: { gt: new Date(now.getTime() - 2 * 60_000) } }, orderBy: { nextCheckAt: "asc" }, take: batch, select: { id: true } });
  const rest = viewed.length >= batch ? [] : await db.cloutPost.findMany({ where: { ...due, id: { notIn: viewed.map((v) => v.id) } }, orderBy: { nextCheckAt: "asc" }, take: batch - viewed.length, select: { id: true } });
  const result: BatchResult = { picked: 0, ok: 0, failed: 0, gone: 0, skippedPlatforms: [...cooling] };
  // Claim each post (push its due time out) so a second worker or an overlapping run cannot take the same one
  const claimed: string[] = [];
  for (const { id } of [...viewed, ...rest]) {
    const c = await db.cloutPost.updateMany({ where: { id, nextCheckAt: { lte: now } }, data: { nextCheckAt: new Date(now.getTime() + 10 * 60_000) } });
    if (c.count === 1) claimed.push(id);
  }
  result.picked = claimed.length;
  const last = new Map<Platform, number>();
  let cursor = 0;
  const lane = async () => {
    while (cursor < claimed.length) {
      const id = claimed[cursor++];
      const post = await db.cloutPost.findUnique({ where: { id }, select: { platform: true } });
      if (!post) continue;
      const pl = post.platform as Platform;
      const wait = Math.max(0, (last.get(pl) ?? 0) + gaps[pl] - Date.now());
      last.set(pl, Date.now() + wait); // reserve the slot before sleeping, so parallel lanes queue behind each other
      await sleep(wait + lo + Math.floor(rnd() * Math.max(0, hi - lo)));
      try {
        const r = await checkPost(db, id, { registry: o.registry, now: o.now });
        if (r.outcome === "ok") result.ok++; else if (r.outcome === "gone") result.gone++; else result.failed++;
      } catch (e) {
        result.failed++;
        console.error("Clout Leader check crashed", id, e);
        await db.cloutPost.update({ where: { id }, data: { nextCheckAt: new Date(Date.now() + 5 * 60_000), lastError: "Unexpected error while checking." } }).catch(() => {});
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(conc, claimed.length) }, lane));
  return result;
}

export const FALLBACK_LABEL = `${FALLBACK_SECONDS / 60} minutes`;
