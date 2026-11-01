import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { DeliveryError, rebateTeam, recordReview, setRebateTier, setRecordingUrl, tierPercent, weekStartOf } from "./delivery";
import { ContentError, createContent, transition } from "./content";
import { createEngagement, quotaSummary } from "./engagements";
import { createMeeting } from "./meetings";

const url = process.env.TEST_DATABASE_URL ?? "postgresql://hifi:hifi_local_dev@localhost:54329/hifi_one_test";
const db = new PrismaClient({ datasourceUrl: url });
let org: string, other: string, client: string, pm: string, editor: string, designer: string, smm: string, csm: string, project: string, eng: string;
const today = new Date().toISOString().slice(0, 10);

beforeAll(async () => {
  await db.$executeRawUnsafe('TRUNCATE "ClientReview","ReviewRebateTier","CommissionEntry","QuotaUsage","EngagementQuota","Engagement","ContentEvent","ContentVersion","ContentItem","Task","ProjectMember","Project","Meeting","Client","User","Organization" CASCADE');
  org = (await db.organization.create({ data: { name: "Del Org" } })).id;
  other = (await db.organization.create({ data: { name: "Other" } })).id;
  const u = async (n: string) => (await db.user.create({ data: { organizationId: org, email: `${n}@d.test`, name: n, passwordHash: "x" } })).id;
  [pm, editor, designer, smm, csm] = await Promise.all([u("pm"), u("editor"), u("designer"), u("smm"), u("csm")]);
  client = (await db.client.create({ data: { organizationId: org, name: "Acme", currency: "USD", projectManagerId: pm } })).id;
  project = (await db.project.create({ data: { organizationId: org, number: "P-1", name: "Acme retainer", clientId: client, managerId: pm } })).id;
  await db.projectMember.createMany({ data: [{ projectId: project, userId: editor }, { projectId: project, userId: designer }, { projectId: project, userId: pm }] });
  eng = (await createEngagement(db, { organizationId: org, clientId: client, actorId: pm, kind: "RETAINER", name: "Growth", amount: "5200", interval: "MONTHLY", startDate: today, quotas: [{ key: "REEL", quantity: 4 }, { key: "STATIC_CREATIVE", quantity: 8 }] })).id;
});
afterAll(async () => { await db.$disconnect(); });

describe("weeks and tiers", () => {
  it("finds the Monday and picks the highest tier reached", () => {
    expect(weekStartOf("2026-11-01")).toBe("2026-10-26"); // a Sunday belongs to the week that started the Monday before
    expect(weekStartOf("2026-11-02")).toBe("2026-11-02");
    const tiers = [{ minRating: 4, percent: "3" }, { minRating: 5, percent: "5" }];
    expect([tierPercent(tiers, 5), tierPercent(tiers, 4), tierPercent(tiers, 3)]).toEqual(["5", "3", "0"]);
  });
  it("validates tiers, removes one at zero, and keeps organizations apart", async () => {
    await expect(setRebateTier(db, { organizationId: org, minRating: 6, percent: "1", actorId: pm })).rejects.toThrow(DeliveryError);
    await expect(setRebateTier(db, { organizationId: org, minRating: 5, percent: "70", actorId: pm })).rejects.toThrow(DeliveryError);
    await setRebateTier(db, { organizationId: org, minRating: 5, percent: "5", actorId: pm });
    await setRebateTier(db, { organizationId: org, minRating: 4, percent: "3", actorId: pm });
    await setRebateTier(db, { organizationId: other, minRating: 5, percent: "9", actorId: pm });
    expect(await db.reviewRebateTier.count({ where: { organizationId: org } })).toBe(2);
    await setRebateTier(db, { organizationId: org, minRating: 4, percent: "0", actorId: pm });
    expect(await db.reviewRebateTier.count({ where: { organizationId: org } })).toBe(1);
    await setRebateTier(db, { organizationId: org, minRating: 4, percent: "3", actorId: pm });
  });
});

describe("weekly review and team rebate", () => {
  it("shares the tier's percent of the weekly retainer between the PM and the project team, as bonuses waiting for approval", async () => {
    expect((await rebateTeam(db, org, client))[0]).toBe(pm);
    const r = await recordReview(db, { organizationId: org, clientId: client, weekOf: "2026-11-03", rating: 5, review: "Very happy with the reels", reviewerId: csm });
    // 5200 a month = 62400 a year = 1200 a week; 5% = 60 shared by 3 people
    expect(r.pool).toBe("60");
    expect(r.shared).toBe(3);
    const rows = await db.commissionEntry.findMany({ where: { reviewId: r.review.id }, orderBy: { amount: "desc" } });
    expect(rows.map((x) => x.amount.toString())).toEqual(["20", "20", "20"]);
    expect(rows.every((x) => x.kind === "BONUS" && x.status === "EARNED" && x.clientId === client)).toBe(true);
  });
  it("one review per client per week, and a low rating earns nothing", async () => {
    await expect(recordReview(db, { organizationId: org, clientId: client, weekOf: "2026-11-05", rating: 4, review: "Again", reviewerId: csm })).rejects.toThrow(/already has a review/);
    const r = await recordReview(db, { organizationId: org, clientId: client, weekOf: "2026-11-10", rating: 2, review: "Slow replies", reviewerId: csm });
    expect(r.pool).toBe("0");
    expect(await db.commissionEntry.count({ where: { reviewId: r.review.id } })).toBe(0);
  });
  it("splits odd cents to the project manager and refuses bad input and foreign clients", async () => {
    await setRebateTier(db, { organizationId: org, minRating: 3, percent: "0.5", actorId: pm });
    const r = await recordReview(db, { organizationId: org, clientId: client, weekOf: "2026-11-17", rating: 3, review: "Fine overall", reviewerId: csm });
    const rows = await db.commissionEntry.findMany({ where: { reviewId: r.review.id } });
    expect(rows.reduce((n, x) => n + Number(x.amount), 0)).toBeCloseTo(6, 2);
    expect(rows.find((x) => x.userId === pm)!.amount.toString()).toBe("2");
    await expect(recordReview(db, { organizationId: org, clientId: client, weekOf: "x", rating: 3, review: "ok then", reviewerId: csm })).rejects.toThrow(DeliveryError);
    await expect(recordReview(db, { organizationId: org, clientId: client, weekOf: "2026-11-24", rating: 9, review: "ok then", reviewerId: csm })).rejects.toThrow(/1 to 5/);
    await expect(recordReview(db, { organizationId: org, clientId: client, weekOf: "2026-11-24", rating: 3, review: "", reviewerId: csm })).rejects.toThrow(DeliveryError);
    await expect(recordReview(db, { organizationId: other, clientId: client, weekOf: "2026-11-24", rating: 3, review: "ok then", reviewerId: csm })).rejects.toThrow(/not found/);
  });
});

describe("no team to share with", () => {
  it("sets nothing aside when the client has no project manager or project staff", async () => {
    const lone = (await db.client.create({ data: { organizationId: org, name: "Lone", currency: "USD" } })).id;
    await createEngagement(db, { organizationId: org, clientId: lone, actorId: csm, kind: "RETAINER", name: "R", amount: "5200", interval: "MONTHLY", startDate: today });
    const r = await recordReview(db, { organizationId: org, clientId: lone, weekOf: "2026-11-03", rating: 5, review: "Great work", reviewerId: csm });
    expect(r).toMatchObject({ pool: "0", shared: 0 });
    expect(r.review.rebatePool.toString()).toBe("0");
  });
});

describe("discovery call and recording", () => {
  it("schedules a discovery call for the client and attaches an https recording link", async () => {
    const m = await createMeeting(db, { organizationId: org, hostId: pm, title: "Discovery: Acme", clientId: client, purpose: "DISCOVERY" });
    expect(m.purpose).toBe("DISCOVERY");
    await expect(createMeeting(db, { organizationId: org, hostId: pm, title: "x", purpose: "PARTY" })).rejects.toThrow(/what the meeting is for/);
    await setRecordingUrl(db, { organizationId: org, meetingId: m.id, url: "https://drive.example.com/rec/1" });
    expect((await db.meeting.findUniqueOrThrow({ where: { id: m.id } })).recordingUrl).toBe("https://drive.example.com/rec/1");
    await expect(setRecordingUrl(db, { organizationId: org, meetingId: m.id, url: "javascript:alert(1)" })).rejects.toThrow(DeliveryError);
    await expect(setRecordingUrl(db, { organizationId: other, meetingId: m.id, url: "https://x.example.com" })).rejects.toThrow(/not found/);
  });
});

describe("content calendar: brief, task, PM approval, quota", () => {
  let item: string;
  it("creates the entry with a brief and sample, and a task for the designer on the client's project", async () => {
    const c = await createContent(db, { organizationId: org, clientId: client, title: "Diwali offer reel", copy: "Caption", platforms: ["INSTAGRAM"], postType: "REEL", plannedDate: today, assignedToId: editor, createdById: pm, brief: "15 second reel, upbeat", sampleUrl: "https://example.com/sample" });
    item = c.id;
    const fresh = await db.contentItem.findUniqueOrThrow({ where: { id: item } });
    expect(fresh.brief).toBe("15 second reel, upbeat");
    expect(fresh.taskId).toBeTruthy();
    const t = await db.task.findUniqueOrThrow({ where: { id: fresh.taskId! } });
    expect(t).toMatchObject({ projectId: project, assigneeId: editor });
    expect(t.description).toContain("https://example.com/sample");
    await expect(createContent(db, { organizationId: org, clientId: client, title: "Bad", copy: "c", platforms: ["INSTAGRAM"], createdById: pm, sampleUrl: "javascript:1" })).rejects.toThrow(ContentError);
  });
  it("only the client's project manager approves before the client, even when the PM wrote it", async () => {
    await transition(db, { organizationId: org, id: item, actor: { id: editor, type: "STAFF" }, to: "INTERNAL_REVIEW" });
    await expect(transition(db, { organizationId: org, id: item, actor: { id: designer, type: "STAFF" }, to: "CLIENT_REVIEW" })).rejects.toThrow(/project manager/);
    const moved = await transition(db, { organizationId: org, id: item, actor: { id: pm, type: "STAFF" }, to: "CLIENT_REVIEW" });
    expect(moved.status).toBe("CLIENT_REVIEW");
  });
  it("then the client approves, the social media manager schedules and publishes, and the publish counts once against the retainer", async () => {
    await transition(db, { organizationId: org, id: item, actor: { id: "portal-user", type: "CLIENT", clientId: client }, to: "APPROVED" });
    await transition(db, { organizationId: org, id: item, actor: { id: smm, type: "STAFF" }, to: "SCHEDULED" });
    await transition(db, { organizationId: org, id: item, actor: { id: smm, type: "STAFF" }, to: "PUBLISHED" });
    const q = (await quotaSummary(db, org, eng)).find((x) => x.key === "REEL")!;
    expect(q).toMatchObject({ limit: 4, used: 1 });
    expect(await db.quotaUsage.count({ where: { contentItemId: item } })).toBe(1);
  });
  it("a post without a matching quota counts nothing", async () => {
    const c = await createContent(db, { organizationId: org, clientId: client, title: "Live Q&A", copy: "c", platforms: ["FACEBOOK"], postType: "LIVE", createdById: pm });
    await transition(db, { organizationId: org, id: c.id, actor: { id: editor, type: "STAFF" }, to: "INTERNAL_REVIEW" });
    await transition(db, { organizationId: org, id: c.id, actor: { id: pm, type: "STAFF" }, to: "CLIENT_REVIEW" });
    await transition(db, { organizationId: org, id: c.id, actor: { id: "portal-user", type: "CLIENT", clientId: client }, to: "APPROVED" });
    await transition(db, { organizationId: org, id: c.id, actor: { id: smm, type: "STAFF" }, to: "SCHEDULED" });
    await transition(db, { organizationId: org, id: c.id, actor: { id: smm, type: "STAFF" }, to: "PUBLISHED" });
    expect(await db.quotaUsage.count({ where: { contentItemId: c.id } })).toBe(0);
  });
});
