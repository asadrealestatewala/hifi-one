import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { CloutError, addPost, campaignScope, checkPost, clientScope, getQuota, platformHealth, postScope, refreshCampaignNow, refreshPostNow, runDueBatch, saveProviderSetting, saveQuota, setCampaignTimer, setPostStatus, setPostTimer, type CloutActor } from "./clout";
import { conversionCounts, postDetail, postsCsv, sharedReport, setShareToken, snapshotsCsv } from "./clout-views";
import type { ProviderResult, Registry, Stats, StatsProvider } from "./clout-providers";
import { FutureProvider } from "./clout-providers";

const url = process.env.TEST_DATABASE_URL ?? "postgresql://hifi:hifi_local_dev@localhost:54329/hifi_one_test";
const db = new PrismaClient({ datasourceUrl: url });
let org: string, otherOrg: string, mgr: CloutActor, member: CloutActor, outsider: CloutActor, stranger: CloutActor;
let clientA: string, clientB: string, campMain: string, campA: string, campB: string, ccMain: string, ccA: string, ccB: string, influencer: string;

const actor = (id: string, organizationId: string, perms: string[]): CloutActor => ({ id, organizationId, permissions: new Set(perms) });
const stats = (views: number, over: Partial<Stats> = {}): Stats => ({ views, likes: Math.floor(views / 10), comments: Math.floor(views / 100), shares: null, saves: null, caption: "cap", author: "sara", postedAt: new Date(), thumbnail: null, externalId: null, ...over });
// A scripted provider: each call takes the next answer; the last one repeats
function script(...answers: ProviderResult[]): StatsProvider & { calls: number } {
  const o = { id: "YTDLP" as const, calls: 0, async fetch() { const r = answers[Math.min(o.calls, answers.length - 1)]; o.calls++; return r; } };
  return o;
}
const ok = (views: number, over: Partial<Stats> = {}): ProviderResult => ({ ok: true, stats: stats(views, over) });
const gone: ProviderResult = { ok: false, kind: "gone", message: "Video not available" };
const blocked: ProviderResult = { ok: false, kind: "blocked", message: "login required" };
const reg = (y: StatsProvider, a?: StatsProvider): Registry => ({ YTDLP: y, APIFY: a ?? new FutureProvider(), FUTURE: new FutureProvider() });
let seq = 0;
const link = () => `https://www.tiktok.com/@sara/video/${70000000000 + ++seq}`;
let clock = new Date("2026-11-04T10:00:00Z");
const now = () => clock;
const tick = (sec: number) => { clock = new Date(clock.getTime() + sec * 1000); };

beforeAll(async () => {
  await db.$executeRawUnsafe('TRUNCATE "CloutSnapshot","CloutPost","CloutCampaign","CloutInfluencer","CloutProviderSetting","CloutQuota","Notification","CampaignMember","CampaignClient","Campaign","Lead","PipelineStage","Project","Client","UserRole","RolePermission","Permission","Role","User","Organization" CASCADE');
  org = (await db.organization.create({ data: { name: "Clout Org" } })).id;
  otherOrg = (await db.organization.create({ data: { name: "Other Org" } })).id;
  const mk = async (organizationId: string, email: string, name: string) => (await db.user.create({ data: { organizationId, email, name, passwordHash: "x" } })).id;
  const [m, mb, out, str] = await Promise.all([mk(org, "m@c.test", "Mona Manager"), mk(org, "mb@c.test", "Ali Member"), mk(org, "o@c.test", "Nina Outsider"), mk(otherOrg, "s@c.test", "Stan Stranger")]);
  mgr = actor(m, org, ["clout.view", "clout.manage", "clout.settings"]);
  member = actor(mb, org, ["clout.view"]);
  outsider = actor(out, org, ["clout.view"]);
  stranger = actor(str, otherOrg, ["clout.view", "clout.manage"]);
  clientA = (await db.client.create({ data: { organizationId: org, name: "Client A" } })).id;
  clientB = (await db.client.create({ data: { organizationId: org, name: "Client B" } })).id;
  const camp = async (name: string) => (await db.campaign.create({ data: { organizationId: org, name } })).id;
  [campMain, campA, campB] = [await camp("Own push"), await camp("A launch"), await camp("B launch")];
  await db.campaignMember.create({ data: { campaignId: campMain, userId: member.id } });
  await db.campaignMember.create({ data: { campaignId: campA, userId: member.id } });
  const cc = (campaignId: string, clientId: string | null) => db.cloutCampaign.create({ data: { organizationId: org, campaignId, clientId } }).then((x) => x.id);
  ccMain = await cc(campMain, null); ccA = await cc(campA, clientA); ccB = await cc(campB, clientB);
  influencer = (await db.cloutInfluencer.create({ data: { organizationId: org, name: "Sara" } })).id;
});
afterAll(async () => { await db.$disconnect(); });

const add = (a: CloutActor, cc: string, y: StatsProvider, extra: Record<string, unknown> = {}) => addPost(db, a, { url: link(), cloutCampaignId: cc, ...extra }, { registry: reg(y), now });

describe("adding a post", () => {
  it("fetches at once, saves the first snapshot and the author data", async () => {
    const r = await add(mgr, ccMain, script(ok(1200, { externalId: "e1", author: "sara.k" })), { influencerId: influencer });
    expect(r.message).toMatch(/live/);
    const p = await db.cloutPost.findUniqueOrThrow({ where: { id: r.postId }, include: { snapshots: true } });
    expect(p).toMatchObject({ status: "LIVE", platform: "TIKTOK", authorHandle: "sara.k", influencerId: influencer, viewsDelta: BigInt(0) });
    expect(Number(p.views)).toBe(1200);
    expect(p.snapshots).toHaveLength(1);
    expect(p.lastSuccessAt).not.toBeNull();
  });
  it("refuses a link that is not a supported post and does not create anything", async () => {
    const before = await db.cloutPost.count();
    await expect(addPost(db, mgr, { url: "https://youtube.com/watch?v=abcdefghijk", cloutCampaignId: ccMain }, { registry: reg(script(ok(1))), now })).rejects.toThrow(/TikTok, Instagram or Facebook/);
    expect(await db.cloutPost.count()).toBe(before);
  });
  it("refuses the same post twice, however the link is written", async () => {
    const u = link();
    await addPost(db, mgr, { url: u, cloutCampaignId: ccMain }, { registry: reg(script(ok(5))), now });
    await expect(addPost(db, mgr, { url: u.replace("www.", "") + "?utm_source=x", cloutCampaignId: ccMain }, { registry: reg(script(ok(5))), now })).rejects.toThrow(/already being tracked/);
  });
  it("refuses a short link that turns out to be a post already tracked, and leaves nothing behind", async () => {
    const full = `https://www.tiktok.com/@sara/video/${80000000000 + ++seq}`;
    const id = full.split("/").pop()!;
    await addPost(db, mgr, { url: full, cloutCampaignId: ccMain }, { registry: reg(script(ok(5, { externalId: id }))), now });
    const before = await db.cloutPost.count();
    await expect(addPost(db, mgr, { url: `https://vm.tiktok.com/ZM${seq}abcd/`, cloutCampaignId: ccMain }, { registry: reg(script(ok(5, { externalId: id }))), now })).rejects.toThrow(/already being tracked/);
    expect(await db.cloutPost.count()).toBe(before);
  });
  it("does not add a post the platform says does not exist", async () => {
    const before = await db.cloutPost.count();
    await expect(add(mgr, ccMain, script(gone))).rejects.toThrow(/could not be found/);
    expect(await db.cloutPost.count()).toBe(before);
  });
  it("keeps a post whose first check was blocked, flagged as failed, and says so", async () => {
    const r = await add(mgr, ccMain, script(blocked));
    expect(r.message).toMatch(/did not work/);
    expect(await db.cloutPost.findUniqueOrThrow({ where: { id: r.postId } })).toMatchObject({ status: "FAILED", consecutiveGone: 0 });
  });
  it("refuses an unknown influencer or project, and a tracking link that is not a web address", async () => {
    await expect(add(mgr, ccMain, script(ok(1)), { influencerId: "nope" })).rejects.toThrow(/influencer/);
    await expect(add(mgr, ccMain, script(ok(1)), { projectId: "nope" })).rejects.toThrow(/project/);
    await expect(add(mgr, ccMain, script(ok(1)), { trackingLink: "javascript:alert(1)" })).rejects.toThrow(/tracking link/);
  });
});

describe("who can add and see", () => {
  it("a member adds to their own campaign, not to one they are not on", async () => {
    await expect(add(member, ccMain, script(ok(10)))).resolves.toBeTruthy();
    await expect(add(member, ccB, script(ok(10)))).rejects.toThrow(/your campaigns/);
    await expect(add(outsider, ccMain, script(ok(10)))).rejects.toThrow(/your campaigns/);
  });
  it("scopes lists: managers see all, a member only their campaigns, an outsider nothing", async () => {
    await add(mgr, ccB, script(ok(7)));
    const count = (a: CloutActor) => db.cloutPost.count({ where: postScope(a) });
    const all = await db.cloutPost.count({ where: { organizationId: org } });
    expect(await count(mgr)).toBe(all);
    const memberSees = await db.cloutPost.findMany({ where: postScope(member), select: { cloutCampaignId: true } });
    expect(memberSees.length).toBeGreaterThan(0);
    expect(memberSees.every((p) => [ccMain, ccA].includes(p.cloutCampaignId))).toBe(true);
    expect(await count(outsider)).toBe(0);
    expect(await count(stranger)).toBe(0);
    expect(await db.cloutCampaign.count({ where: campaignScope(outsider) })).toBe(0);
  });
  it("a member cannot open another campaign's post through the detail query", async () => {
    const p = await db.cloutPost.findFirstOrThrow({ where: { cloutCampaignId: ccB } });
    expect(await postDetail(db, postScope(member), p.id)).toBeNull();
    expect(await postDetail(db, postScope(mgr), p.id)).not.toBeNull();
    expect(await postDetail(db, postScope(stranger), p.id)).toBeNull();
  });
});

describe("client isolation", () => {
  it("a client sees only its own campaigns' posts and nothing of another client or the company", async () => {
    await add(mgr, ccA, script(ok(300)));
    const a = await db.cloutPost.findMany({ where: clientScope(clientA), select: { cloutCampaignId: true } });
    const b = await db.cloutPost.findMany({ where: clientScope(clientB), select: { cloutCampaignId: true } });
    expect(a.length).toBeGreaterThan(0); expect(b.length).toBeGreaterThan(0);
    expect(a.every((p) => p.cloutCampaignId === ccA)).toBe(true);
    expect(b.every((p) => p.cloutCampaignId === ccB)).toBe(true);
    const bPost = await db.cloutPost.findFirstOrThrow({ where: { cloutCampaignId: ccB } });
    expect(await postDetail(db, clientScope(clientA), bPost.id)).toBeNull();
    const own = await db.cloutPost.findFirstOrThrow({ where: { cloutCampaignId: ccMain } });
    expect(await postDetail(db, clientScope(clientA), own.id)).toBeNull();
  });
  it("a client cannot refresh or time another client's campaign or post", async () => {
    const bPost = await db.cloutPost.findFirstOrThrow({ where: { cloutCampaignId: ccB } });
    await expect(refreshPostNow(db, { organizationId: org, postId: bPost.id, where: clientScope(clientA) }, { registry: reg(script(ok(1))), now })).rejects.toThrow(/not found/);
    await expect(refreshCampaignNow(db, { organizationId: org, cloutCampaignId: ccB, where: { clientId: clientA } }, now())).rejects.toThrow(/not found/);
  });
  it("organizations are separate", async () => {
    await expect(setCampaignTimer(db, { organizationId: otherOrg, cloutCampaignId: ccA, seconds: 900 })).rejects.toThrow(/not found/);
    await expect(addPost(db, stranger, { url: link(), cloutCampaignId: ccA }, { registry: reg(script(ok(1))), now })).rejects.toThrow(/your campaigns/);
  });
});

describe("snapshots and growth", () => {
  it("saves a snapshot per good check and computes the change since the last check", async () => {
    const r = await add(mgr, ccMain, script(ok(1000), ok(1600), ok(2500)));
    const y = script(ok(1600), ok(2500));
    tick(120); await checkPost(db, r.postId, { registry: reg(y), now });
    let p = await db.cloutPost.findUniqueOrThrow({ where: { id: r.postId } });
    expect([Number(p.views), Number(p.viewsDelta)]).toEqual([1600, 600]);
    tick(120); await checkPost(db, r.postId, { registry: reg(y), now });
    p = await db.cloutPost.findUniqueOrThrow({ where: { id: r.postId } });
    expect([Number(p.views), Number(p.viewsDelta)]).toEqual([2500, 900]);
    const d = (await postDetail(db, postScope(mgr), r.postId, now()))!;
    expect(d.snapshotCount).toBe(3);
    expect(d.growth.sinceLast!.views).toBe(900);
    expect(d.growth.hour).toMatchObject({ views: 1500 });
  });
  it("a failed check saves no snapshot and keeps the last numbers", async () => {
    const r = await add(mgr, ccMain, script(ok(50)));
    tick(60); await checkPost(db, r.postId, { registry: reg(script(blocked)), now });
    const p = await db.cloutPost.findUniqueOrThrow({ where: { id: r.postId }, include: { _count: { select: { snapshots: true } } } });
    expect(p._count.snapshots).toBe(1);
    expect(Number(p.views)).toBe(50);
    expect(p.status).toBe("FAILED");
  });
});

describe("deleted or unavailable posts", () => {
  it("marks a post unavailable after three not-found checks in a row, stops tracking, keeps history and notifies the owner", async () => {
    await db.campaign.update({ where: { id: campMain }, data: { ownerId: mgr.id } });
    const r = await add(mgr, ccMain, script(ok(400)));
    const y = script(gone);
    for (let i = 1; i <= 2; i++) { tick(700); const c = await checkPost(db, r.postId, { registry: reg(y), now }); expect(c.status).toBe("FAILED"); }
    expect(await db.notification.count({ where: { kind: "clout.unavailable" } })).toBe(0);
    tick(700); const third = await checkPost(db, r.postId, { registry: reg(y), now });
    expect(third.status).toBe("UNAVAILABLE");
    const p = await db.cloutPost.findUniqueOrThrow({ where: { id: r.postId }, include: { _count: { select: { snapshots: true } } } });
    expect(p).toMatchObject({ status: "UNAVAILABLE", nextCheckAt: null, consecutiveGone: 3 });
    expect(p.unavailableAt).not.toBeNull();
    expect(p._count.snapshots).toBe(1);
    expect(Number(p.views)).toBe(400);
    const n = await db.notification.findMany({ where: { kind: "clout.unavailable" } });
    expect(n.map((x) => x.userId)).toEqual([mgr.id]);
    // it is no longer picked by the worker and cannot be refreshed
    tick(86_400);
    expect((await runDueBatch(db, { now, registry: reg(y), sleep: async () => {}, jitterMs: [0, 0], platformGapMs: { TIKTOK: 0 }, organizationId: org })).picked).toBeGreaterThanOrEqual(0);
    expect((await db.cloutPost.findUniqueOrThrow({ where: { id: r.postId } })).status).toBe("UNAVAILABLE");
    await expect(refreshPostNow(db, { organizationId: org, postId: r.postId }, { registry: reg(y), now })).rejects.toThrow(/no longer available/);
    // a manager can resume it
    await setPostStatus(db, { organizationId: org, postId: r.postId, action: "resume" });
    expect(await db.cloutPost.findUniqueOrThrow({ where: { id: r.postId } })).toMatchObject({ status: "LIVE", consecutiveGone: 0 });
  });
  it("temporary blocks never mark a post deleted, even after many", async () => {
    const r = await add(mgr, ccMain, script(ok(10)));
    const y = script(blocked);
    for (let i = 0; i < 8; i++) { tick(60 * 60 * 7); await checkPost(db, r.postId, { registry: reg(y), now }); }
    const p = await db.cloutPost.findUniqueOrThrow({ where: { id: r.postId } });
    expect(p.status).toBe("FAILED");
    expect(p.consecutiveGone).toBe(0);
    expect(p.nextCheckAt).not.toBeNull();
  });
  it("two not-found checks and then a good one keep the post live", async () => {
    const r = await add(mgr, ccMain, script(ok(10)));
    const y = script(gone, gone, ok(30));
    for (let i = 0; i < 3; i++) { tick(700); await checkPost(db, r.postId, { registry: reg(y), now }); }
    expect(await db.cloutPost.findUniqueOrThrow({ where: { id: r.postId } })).toMatchObject({ status: "LIVE", consecutiveGone: 0, consecutiveFailures: 0 });
  });
});

describe("timers and the 60 second minimum (server side)", () => {
  it("refuses anything under 60 seconds for a campaign and for a post, whoever asks", async () => {
    await expect(setCampaignTimer(db, { organizationId: org, cloutCampaignId: ccMain, seconds: 59 })).rejects.toThrow(/60 seconds/);
    await expect(setCampaignTimer(db, { organizationId: org, cloutCampaignId: ccMain, seconds: "10" })).rejects.toThrow(/60 seconds/);
    const p = await db.cloutPost.findFirstOrThrow({ where: { cloutCampaignId: ccMain, status: "LIVE" } });
    await expect(setPostTimer(db, { organizationId: org, postId: p.id, seconds: 30 })).rejects.toThrow(/60 seconds/);
    expect((await db.cloutCampaign.findUniqueOrThrow({ where: { id: ccMain } })).refreshSeconds).toBeGreaterThanOrEqual(60);
  });
  it("a quota row can raise the minimum, but it can never be saved below 60", async () => {
    await expect(saveQuota(db, { organizationId: org, clientId: clientA, plan: "CUSTOM", fastPosts: 3, minSeconds: 30 })).rejects.toThrow(/60 seconds/);
    await saveQuota(db, { organizationId: org, clientId: clientA, plan: "CUSTOM", fastPosts: 3, minSeconds: 120 });
    await expect(setCampaignTimer(db, { organizationId: org, cloutCampaignId: ccA, seconds: 60 })).rejects.toThrow(/120 seconds/);
    await saveQuota(db, { organizationId: org, clientId: clientA, plan: "FREE" });
  });
  it("accepts the presets", async () => {
    for (const s of [60, 300, 900, 1800, 3600, 21600]) await expect(setCampaignTimer(db, { organizationId: org, cloutCampaignId: ccB, seconds: s })).resolves.toMatchObject({ seconds: s });
  });
});

describe("fast-lane quota", () => {
  it("falls back to 15 minutes beyond the quota and says how many were affected, then recovers when the quota grows", async () => {
    await db.cloutPost.deleteMany({ where: { cloutCampaignId: ccA } });
    await saveQuota(db, { organizationId: org, clientId: clientA, plan: "CUSTOM", fastPosts: 2, minSeconds: 60 });
    for (let i = 0; i < 4; i++) await add(mgr, ccA, script(ok(10 + i)));
    const r = await setCampaignTimer(db, { organizationId: org, cloutCampaignId: ccA, seconds: 60 });
    expect(r).toMatchObject({ fellBack: 2, fastPosts: 2 });
    const posts = await db.cloutPost.findMany({ where: { cloutCampaignId: ccA }, orderBy: { createdAt: "asc" } });
    expect(posts.map((p) => [p.fastLane, p.quotaFallback, p.effectiveSeconds])).toEqual([[true, false, 60], [true, false, 60], [false, true, 900], [false, true, 900]]);
    await saveQuota(db, { organizationId: org, clientId: clientA, plan: "PRO" });
    expect(await getQuota(db, org, clientA)).toMatchObject({ plan: "PRO", fastPosts: 100 });
    const after = await db.cloutPost.findMany({ where: { cloutCampaignId: ccA } });
    expect(after.every((p) => p.fastLane && !p.quotaFallback && p.effectiveSeconds === 60)).toBe(true);
  });
  it("quotas are per client: filling one client's lane does not affect another's", async () => {
    await saveQuota(db, { organizationId: org, clientId: clientA, plan: "CUSTOM", fastPosts: 0 });
    await setCampaignTimer(db, { organizationId: org, cloutCampaignId: ccB, seconds: 60 });
    const b = await db.cloutPost.findMany({ where: { cloutCampaignId: ccB } });
    expect(b.length).toBeGreaterThan(0);
    expect(b.every((p) => p.fastLane)).toBe(true); // client B falls under the default of 5 fast posts
    expect((await db.cloutPost.findMany({ where: { cloutCampaignId: ccA } })).every((p) => p.quotaFallback)).toBe(true);
    await saveQuota(db, { organizationId: org, clientId: clientA, plan: "FREE" });
  });
  it("a paused post gives its fast place back", async () => {
    await db.cloutPost.deleteMany({ where: { cloutCampaignId: ccA } });
    await saveQuota(db, { organizationId: org, clientId: clientA, plan: "CUSTOM", fastPosts: 1 });
    const a = await add(mgr, ccA, script(ok(1))); const b = await add(mgr, ccA, script(ok(2)));
    await setCampaignTimer(db, { organizationId: org, cloutCampaignId: ccA, seconds: 300 });
    expect((await db.cloutPost.findUniqueOrThrow({ where: { id: b.postId } })).quotaFallback).toBe(true);
    await setPostStatus(db, { organizationId: org, postId: a.postId, action: "pause" });
    expect(await db.cloutPost.findUniqueOrThrow({ where: { id: b.postId } })).toMatchObject({ fastLane: true, quotaFallback: false });
  });
});

describe("manual refresh cooldowns", () => {
  it("allows one refresh per post every 30 seconds", async () => {
    const r = await add(mgr, ccMain, script(ok(100)));
    const y = script(ok(110), ok(120), ok(130));
    await expect(refreshPostNow(db, { organizationId: org, postId: r.postId }, { registry: reg(y), now })).resolves.toMatchObject({ outcome: "ok" });
    tick(10);
    await expect(refreshPostNow(db, { organizationId: org, postId: r.postId }, { registry: reg(y), now })).rejects.toThrow(/Wait/);
    tick(25);
    await expect(refreshPostNow(db, { organizationId: org, postId: r.postId }, { registry: reg(y), now })).resolves.toMatchObject({ outcome: "ok" });
    expect(y.calls).toBe(2);
  });
  it("two simultaneous refreshes of one post run only once", async () => {
    const r = await add(mgr, ccMain, script(ok(100)));
    const y = script(ok(110));
    tick(100);
    const res = await Promise.allSettled([refreshPostNow(db, { organizationId: org, postId: r.postId }, { registry: reg(y), now }), refreshPostNow(db, { organizationId: org, postId: r.postId }, { registry: reg(y), now })]);
    expect(res.filter((x) => x.status === "fulfilled")).toHaveLength(1);
    expect(y.calls).toBe(1);
  });
  it("allows one refresh-all per campaign every 60 seconds and queues the posts for the worker", async () => {
    tick(1000);
    const n = await refreshCampaignNow(db, { organizationId: org, cloutCampaignId: ccMain }, now());
    expect(n).toBeGreaterThan(0);
    tick(30);
    await expect(refreshCampaignNow(db, { organizationId: org, cloutCampaignId: ccMain }, now())).rejects.toThrow(/Wait/);
    tick(40);
    await expect(refreshCampaignNow(db, { organizationId: org, cloutCampaignId: ccMain }, now())).resolves.toBeGreaterThan(0);
  });
  it("does not refresh a paused post", async () => {
    const r = await add(mgr, ccMain, script(ok(5)));
    await setPostStatus(db, { organizationId: org, postId: r.postId, action: "pause" });
    await expect(refreshPostNow(db, { organizationId: org, postId: r.postId }, { registry: reg(script(ok(6))), now })).rejects.toThrow(/paused/);
  });
});

describe("the worker", () => {
  it("reads due posts in a small batch with a pause before each request, and never the same post twice", async () => {
    await db.cloutPost.updateMany({ where: { organizationId: org }, data: { nextCheckAt: new Date("2030-01-01") } });
    const posts: string[] = [];
    for (let i = 0; i < 5; i++) posts.push((await add(mgr, ccMain, script(ok(1)))).postId);
    await db.cloutPost.updateMany({ where: { id: { in: posts } }, data: { nextCheckAt: new Date(clock.getTime() - 1000) } });
    const waits: number[] = [];
    const y = script(ok(77));
    const r = await runDueBatch(db, { now, registry: reg(y), batchSize: 3, concurrency: 2, jitterMs: [100, 100], platformGapMs: { TIKTOK: 0 }, sleep: async (ms) => { waits.push(ms); }, organizationId: org });
    expect(r).toMatchObject({ picked: 3, ok: 3 });
    expect(y.calls).toBe(3);
    expect(waits).toHaveLength(3);
    expect(waits.every((w) => w >= 100)).toBe(true);
    const r2 = await runDueBatch(db, { now, registry: reg(y), batchSize: 10, jitterMs: [0, 0], platformGapMs: { TIKTOK: 0 }, sleep: async () => {}, organizationId: org });
    expect(r2.picked).toBe(2);
    expect(y.calls).toBe(5);
  });
  it("posts someone has open are read first", async () => {
    await db.cloutPost.updateMany({ where: { organizationId: org }, data: { nextCheckAt: new Date("2030-01-01") } });
    const [a, b] = [(await add(mgr, ccMain, script(ok(1)))).postId, (await add(mgr, ccMain, script(ok(1)))).postId];
    await db.cloutPost.update({ where: { id: a }, data: { nextCheckAt: new Date(clock.getTime() - 5000) } });
    await db.cloutPost.update({ where: { id: b }, data: { nextCheckAt: new Date(clock.getTime() - 1000), lastViewedAt: clock } });
    const seen: string[] = [];
    const y: StatsProvider = { id: "YTDLP", async fetch(u) { seen.push(u); return ok(9); } };
    await runDueBatch(db, { now, registry: reg(y), batchSize: 1, jitterMs: [0, 0], platformGapMs: { TIKTOK: 0 }, sleep: async () => {}, organizationId: org });
    expect(seen).toEqual([(await db.cloutPost.findUniqueOrThrow({ where: { id: b } })).url]);
  });
  it("leaves a platform alone after repeated refusals, shows it as blocked, and resumes after a good answer", async () => {
    await db.cloutProviderSetting.deleteMany({ where: { organizationId: org } });
    await db.cloutPost.updateMany({ where: { organizationId: org }, data: { nextCheckAt: new Date("2030-01-01") } });
    const ids: string[] = [];
    for (let i = 0; i < 4; i++) ids.push((await add(mgr, ccMain, script(ok(1)))).postId);
    const due = () => db.cloutPost.updateMany({ where: { id: { in: ids } }, data: { nextCheckAt: new Date(clock.getTime() - 1000) } });
    await due();
    const y = script(blocked);
    await runDueBatch(db, { now, registry: reg(y), batchSize: 3, concurrency: 1, jitterMs: [0, 0], platformGapMs: { TIKTOK: 0 }, sleep: async () => {}, organizationId: org });
    expect((await platformHealth(db, org, now())).find((h) => h.platform === "TIKTOK")!.health).toBe("BLOCKED");
    await due();
    const callsBefore = y.calls;
    const r = await runDueBatch(db, { now, registry: reg(y), batchSize: 3, jitterMs: [0, 0], platformGapMs: { TIKTOK: 0 }, sleep: async () => {}, organizationId: org });
    expect(r.picked).toBe(0);
    expect(r.skippedPlatforms).toContain("TIKTOK");
    expect(y.calls).toBe(callsBefore);
    await expect(refreshPostNow(db, { organizationId: org, postId: ids[0] }, { registry: reg(y), now })).rejects.toThrow(/not answering/);
    tick(3 * 3600);
    await due();
    const good = script(ok(5));
    const r3 = await runDueBatch(db, { now, registry: reg(good), batchSize: 1, jitterMs: [0, 0], platformGapMs: { TIKTOK: 0 }, sleep: async () => {}, organizationId: org });
    expect(r3.ok).toBe(1);
    expect((await platformHealth(db, org, now())).find((h) => h.platform === "TIKTOK")!.health).toBe("OK");
  });
  it("a provider that crashes is contained and the post is retried later", async () => {
    const r = await add(mgr, ccMain, script(ok(1)));
    await db.cloutPost.update({ where: { id: r.postId }, data: { nextCheckAt: new Date(clock.getTime() - 1000) } });
    const crash: StatsProvider = { id: "YTDLP", async fetch() { throw new Error("kaboom"); } };
    await expect(runDueBatch(db, { now, registry: reg(crash), batchSize: 50, jitterMs: [0, 0], platformGapMs: { TIKTOK: 0 }, sleep: async () => {}, organizationId: org })).resolves.toBeTruthy();
    const p = await db.cloutPost.findUniqueOrThrow({ where: { id: r.postId } });
    expect(p.status).not.toBe("UNAVAILABLE");
  });
});

describe("providers per platform", () => {
  it("the backup answers when the primary fails and the post records who answered", async () => {
    await saveProviderSetting(db, { organizationId: org, platform: "TIKTOK", primary: "YTDLP", fallback: "APIFY" });
    const r = await add(mgr, ccMain, script(blocked), {});
    // the add above used a registry whose backup cannot answer; now give the backup a result
    const backup: StatsProvider = { id: "APIFY", async fetch() { return ok(4242); } };
    tick(100);
    const c = await checkPost(db, r.postId, { registry: reg(script(blocked), backup), now });
    expect(c.outcome).toBe("ok");
    expect(await db.cloutPost.findUniqueOrThrow({ where: { id: r.postId } })).toMatchObject({ lastProvider: "APIFY", status: "LIVE" });
    expect(Number((await db.cloutPost.findUniqueOrThrow({ where: { id: r.postId } })).views)).toBe(4242);
  });
  it("validates provider settings", async () => {
    await expect(saveProviderSetting(db, { organizationId: org, platform: "TIKTOK", primary: "YTDLP", fallback: "YTDLP" })).rejects.toThrow(/different/);
    await expect(saveProviderSetting(db, { organizationId: org, platform: "MYSPACE", primary: "YTDLP", fallback: null })).rejects.toThrow(/platform/);
    await expect(saveProviderSetting(db, { organizationId: org, platform: "TIKTOK", primary: "BOGUS", fallback: null })).rejects.toThrow(/primary/);
    await saveProviderSetting(db, { organizationId: org, platform: "TIKTOK", primary: "YTDLP", fallback: null });
  });
});

describe("conversions, exports and the shared report", () => {
  it("counts CRM leads that match a promo code by campaign tag or tag, ignoring capitals and other organizations", async () => {
    const stage = await db.pipelineStage.create({ data: { organizationId: org, name: "New", sortOrder: 1, probability: 10 } });
    const otherStage = await db.pipelineStage.create({ data: { organizationId: otherOrg, name: "New", sortOrder: 1, probability: 10 } });
    await db.lead.createMany({ data: [
      { organizationId: org, name: "L1", stageId: stage.id, utmCampaign: "sara10" }, { organizationId: org, name: "L2", stageId: stage.id, tags: ["SARA10"] },
      { organizationId: org, name: "L3", stageId: stage.id, utmCampaign: "other" }, { organizationId: otherOrg, name: "L4", stageId: otherStage.id, utmCampaign: "SARA10" },
    ] });
    const m = await conversionCounts(db, org, ["SARA10", "NOPE"]);
    expect([m.get("sara10"), m.get("nope")]).toEqual([2, 0]);
    const r = await add(mgr, ccMain, script(ok(9)), { trackingCode: "Sara10", influencerId: influencer });
    expect((await postDetail(db, postScope(mgr), r.postId))!.conversions).toBe(2);
  });
  it("exports posts and snapshots, neutralising spreadsheet formulas in captions", async () => {
    const r = await add(mgr, ccMain, script(ok(1, { caption: "=HYPERLINK(\"http://evil\")" })));
    const csv = await postsCsv(db, { cloutCampaignId: ccMain });
    expect(csv.split("\r\n")[0]).toContain("Views");
    expect(csv).toContain("'=HYPERLINK");
    expect(csv).not.toMatch(/(^|,)=HYPERLINK/m);
    const snaps = await snapshotsCsv(db, { id: r.postId });
    expect(snaps.trim().split("\r\n")).toHaveLength(2);
  });
  it("the shared report works only with a live secret and shows no internal data", async () => {
    expect(await sharedReport(db, "x".repeat(32))).toBeNull();
    expect(await sharedReport(db, "short")).toBeNull();
    const token = (await setShareToken(db, { organizationId: org, cloutCampaignId: ccMain, on: true }))!;
    const rep = (await sharedReport(db, token))!;
    expect(rep.name).toBe("Own push");
    expect(JSON.stringify(rep)).not.toMatch(/lastError|trackingCode|phone|notes/);
    expect(await setShareToken(db, { organizationId: otherOrg, cloutCampaignId: ccMain, on: false })).toBeNull();
    await setShareToken(db, { organizationId: org, cloutCampaignId: ccMain, on: false });
    expect(await sharedReport(db, token)).toBeNull();
  });
});

describe("error handling", () => {
  it("throws CloutError (not a crash) for expected problems", async () => {
    await expect(setPostTimer(db, { organizationId: org, postId: "missing", seconds: 60 })).rejects.toBeInstanceOf(CloutError);
  });
});
