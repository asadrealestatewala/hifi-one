import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { ContentAiError, generateImage, generatePlan, monthNeeds, saveProfile, undoPlan } from "./content-ai";
import { MemoryStorage } from "./storage";

const url = process.env.TEST_DATABASE_URL ?? "postgresql://hifi:hifi_local_dev@localhost:54329/hifi_one_test";
const db = new PrismaClient({ datasourceUrl: url });
let org: string, ann: string, pm: string, client: string;
const NOW = "2026-11-16";

const claude = (n: number) => async () => ({ ok: true, status: 200, json: async () => ({ stop_reason: "end_turn", usage: { input_tokens: 3000, output_tokens: 6000 }, content: [{ type: "text", text: JSON.stringify({ posts: Array.from({ length: n }, (_, i) => ({ slot: i, title: `Post ${i}`, caption: `Caption ${i}`, hashtags: "#a #b", brief: "Make it" })) }) }] }) });
const actor = () => ({ id: ann, organizationId: org, userType: "EMPLOYEE", clientId: null, vendorId: null, permissions: new Set(["content.manage", "content.view"]) as ReadonlySet<string> });

beforeAll(async () => {
  await db.$executeRawUnsafe('TRUNCATE "ContentAiRun","ClientContentProfile","EngagementQuota","Engagement","StoredFile","ContentEvent","ContentVersion","ContentItem","Notification","Client","User","Organization" CASCADE');
  org = (await db.organization.create({ data: { name: "AI Org" } })).id;
  const mk = (e: string) => db.user.create({ data: { organizationId: org, email: e, name: e, passwordHash: "x" } }).then((u) => u.id);
  ann = await mk("ann@ai.test"); pm = await mk("pm@ai.test");
  client = (await db.client.create({ data: { organizationId: org, name: "Acme", projectManagerId: pm } })).id;
  const e = await db.engagement.create({ data: { organizationId: org, clientId: client, name: "Retainer", currency: "PKR", amount: "1000", startDate: "2026-11-01" } });
  await db.engagementQuota.createMany({ data: [{ engagementId: e.id, key: "REEL", quantity: 3 }, { engagementId: e.id, key: "STATIC_CREATIVE", quantity: 2 }] });
});
afterAll(async () => { await db.$disconnect(); });

describe("monthly plan", () => {
  it("refuses until the profile has what the business does", async () => {
    const need = await monthNeeds(db, { organizationId: org, clientId: client, month: "2026-12" });
    expect(need.remaining).toEqual({ REEL: 3, LONG_VIDEO: 0, STATIC_CREATIVE: 2 });
    await expect(generatePlan(db, { organizationId: org, clientId: client, month: "2026-12", counts: need.remaining, actorId: ann, today: NOW, apiKey: "k", fetchImpl: claude(5) })).rejects.toThrow(/content profile/);
  });

  it("writes exactly the quota as AI drafts, tells the PM, and leaves only what is still missing next time", async () => {
    await saveProfile(db, { organizationId: org, clientId: client, actorId: ann, input: { about: "Acme sells running shoes in Lahore.", platforms: ["INSTAGRAM", "FACEBOOK"] } });
    const r = await generatePlan(db, { organizationId: org, clientId: client, month: "2026-12", counts: { REEL: 3, LONG_VIDEO: 0, STATIC_CREATIVE: 2 }, actorId: ann, today: NOW, apiKey: "k", fetchImpl: claude(5) });
    expect(r.created).toBe(5);
    const posts = await db.contentItem.findMany({ where: { aiRunId: r.runId } });
    expect(posts).toHaveLength(5);
    expect(posts.every((p) => p.status === "DRAFT" && p.clientId === client && p.plannedDate?.startsWith("2026-12") && p.assignedToId === null)).toBe(true);
    expect(posts.filter((p) => p.postType === "REEL")).toHaveLength(3);
    expect(await db.notification.count({ where: { userId: pm, kind: "content.ai_plan" } })).toBe(1);
    expect((await monthNeeds(db, { organizationId: org, clientId: client, month: "2026-12" })).remaining).toEqual({ REEL: 0, LONG_VIDEO: 0, STATIC_CREATIVE: 0 });
    await expect(generatePlan(db, { organizationId: org, clientId: client, month: "2026-12", counts: { REEL: 0, LONG_VIDEO: 0, STATIC_CREATIVE: 0 }, actorId: ann, today: NOW, apiKey: "k", fetchImpl: claude(0) })).rejects.toThrow(/nothing left/);
  });

  it("saves nothing when Claude returns too few posts, rejects past months, and discards only untouched drafts", async () => {
    await expect(generatePlan(db, { organizationId: org, clientId: client, month: "2027-01", counts: { REEL: 2, LONG_VIDEO: 0, STATIC_CREATIVE: 0 }, actorId: ann, today: NOW, apiKey: "k", fetchImpl: claude(1) })).rejects.toThrow(/1 of 2/);
    expect(await db.contentItem.count({ where: { plannedDate: { startsWith: "2027-01" } } })).toBe(0);
    await expect(generatePlan(db, { organizationId: org, clientId: client, month: "2026-10", counts: { REEL: 1, LONG_VIDEO: 0, STATIC_CREATIVE: 0 }, actorId: ann, today: NOW, apiKey: "k", fetchImpl: claude(1) })).rejects.toThrow(/passed/);
    const run = await db.contentAiRun.findFirstOrThrow({ where: { kind: "PLAN", postCount: 5 } });
    const first = await db.contentItem.findFirstOrThrow({ where: { aiRunId: run.id } });
    await db.contentItem.update({ where: { id: first.id }, data: { status: "INTERNAL_REVIEW" } });
    expect(await undoPlan(db, { organizationId: org, runId: run.id })).toEqual({ removed: 4, kept: 1 });
    await expect(undoPlan(db, { organizationId: org, runId: "ghost" })).rejects.toThrow(ContentAiError);
  });

  it("stops at the client's monthly AI limit", async () => {
    await saveProfile(db, { organizationId: org, clientId: client, actorId: ann, input: { about: "Acme sells running shoes in Lahore.", monthlyCapUsd: "0.01" } });
    await expect(generatePlan(db, { organizationId: org, clientId: client, month: "2027-02", counts: { REEL: 1, LONG_VIDEO: 0, STATIC_CREATIVE: 0 }, actorId: ann, today: NOW, apiKey: "k", fetchImpl: claude(1) })).rejects.toThrow(/AI limit/);
    await expect(saveProfile(db, { organizationId: org, clientId: client, actorId: ann, input: { platforms: ["MYSPACE"] } })).rejects.toThrow(/platforms/);
  });
});

describe("AI image", () => {
  it("attaches the image to a draft post and counts its cost; refuses without a key or after review", async () => {
    await saveProfile(db, { organizationId: org, clientId: client, actorId: ann, input: { about: "Acme sells running shoes in Lahore.", monthlyCapUsd: "10" } });
    const item = await db.contentItem.create({ data: { organizationId: org, clientId: client, platform: "INSTAGRAM", platforms: ["INSTAGRAM"], title: "Shoes", copy: "Run", postType: "STATIC", createdById: ann } });
    const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64").toString("base64");
    const fetchImpl = async () => ({ ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [{ inlineData: { mimeType: "image/png", data: png } }] } }] }) });
    const storage = new MemoryStorage();
    const f = await generateImage(db, storage, { organizationId: org, itemId: item.id, actor: actor(), today: NOW, apiKey: "g", fetchImpl });
    expect(f).toMatchObject({ ownerType: "CONTENT", ownerId: item.id, category: "AI generated", contentType: "image/png" });
    expect(await db.contentAiRun.count({ where: { kind: "IMAGE", itemId: item.id } })).toBe(1);
    await expect(generateImage(db, storage, { organizationId: org, itemId: item.id, actor: actor(), today: NOW, fetchImpl })).rejects.toThrow(/not configured/);
    await db.contentItem.update({ where: { id: item.id }, data: { status: "CLIENT_REVIEW" } });
    await expect(generateImage(db, storage, { organizationId: org, itemId: item.id, actor: actor(), today: NOW, apiKey: "g", fetchImpl })).rejects.toThrow(/still being worked on/);
  });
});
