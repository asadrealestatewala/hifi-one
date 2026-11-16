import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { bulkTransition, createContent, editContent, transition } from "./content";
import { ContentAiError, planMemory, redoPost } from "./content-ai";
import { deleteHashtagGroup, groupsFor, saveHashtagGroup } from "./content-hashtags";

const url = process.env.TEST_DATABASE_URL ?? "postgresql://hifi:hifi_local_dev@localhost:54329/hifi_one_test";
const db = new PrismaClient({ datasourceUrl: url });
let org: string, other: string, ann: string, pm: string, cu: string, client: string, client2: string;
const NOW = "2026-11-16";

beforeAll(async () => {
  await db.$executeRawUnsafe('TRUNCATE "HashtagGroup","ContentAiRun","ClientContentProfile","ContentEvent","ContentVersion","ContentItem","Notification","Client","User","Organization" CASCADE');
  org = (await db.organization.create({ data: { name: "P1 Org" } })).id;
  other = (await db.organization.create({ data: { name: "Other Org" } })).id;
  const mk = (e: string, extra = {}) => db.user.create({ data: { organizationId: org, email: e, name: e, passwordHash: "x", ...extra } }).then((u) => u.id);
  ann = await mk("ann@p1.test"); pm = await mk("pm@p1.test");
  client = (await db.client.create({ data: { organizationId: org, name: "Acme", projectManagerId: pm } })).id;
  client2 = (await db.client.create({ data: { organizationId: org, name: "Beta" } })).id;
  cu = await mk("client@p1.test", { userType: "CLIENT", clientId: client });
});
afterAll(async () => { await db.$disconnect(); });

const post = (over: Partial<Parameters<typeof createContent>[1]> = {}) =>
  createContent(db, { organizationId: org, createdById: ann, clientId: client, title: "Boots", copy: "Warm boots for winter", hashtags: "#boots", platforms: ["INSTAGRAM", "X"], postType: "STATIC", plannedDate: "2026-12-07", ...over });

describe("captions per platform and first comment", () => {
  it("saves own captions as a new version, drops ones equal to the main caption or for platforms not chosen", async () => {
    const p = await post();
    const e = await editContent(db, { organizationId: org, id: p.id, copy: p.copy, hashtags: "#boots", platformCopy: { X: "Boots. Now.", INSTAGRAM: p.copy, TIKTOK: "not chosen" }, firstComment: "Shop at the link in bio" });
    expect(e.platformCopy).toEqual({ X: "Boots. Now." });
    expect(e.firstComment).toBe("Shop at the link in bio");
    expect(e.version).toBe(2);
    expect((await db.contentVersion.findFirstOrThrow({ where: { itemId: p.id, version: 2 } })).platformCopy).toEqual({ X: "Boots. Now." });
    const same = await editContent(db, { organizationId: org, id: p.id, copy: p.copy, hashtags: "#boots" });
    expect(same.version).toBe(2); // platform copy kept when not sent, nothing changed
    expect(same.platformCopy).toEqual({ X: "Boots. Now." });
  });

  it("will not send a caption a platform would reject to the client", async () => {
    const p = await post({ copy: "y".repeat(400) });
    await transition(db, { organizationId: org, id: p.id, actor: { id: ann, type: "STAFF" }, to: "INTERNAL_REVIEW" });
    await expect(transition(db, { organizationId: org, id: p.id, actor: { id: pm, type: "STAFF" }, to: "CLIENT_REVIEW" })).rejects.toThrow(/X \(Twitter\).*limit is 280/);
  });
});

describe("moving several posts at once", () => {
  it("moves what it can, reports the rest, and sends one notification per client user", async () => {
    const a = await post({ title: "Post A" }), b = await post({ title: "Post B" }), c = await post({ title: "Post C", copy: "z".repeat(400) });
    const r1 = await bulkTransition(db, { organizationId: org, ids: [a.id, b.id, c.id], actor: { id: ann, type: "STAFF" }, to: "INTERNAL_REVIEW" });
    expect(r1).toMatchObject({ moved: 3, failed: [] });
    // Only the client's PM may send to the client; the long one is stopped by the X limit
    const denied = await bulkTransition(db, { organizationId: org, ids: [a.id], actor: { id: ann, type: "STAFF" }, to: "CLIENT_REVIEW" });
    expect(denied.moved).toBe(0); expect(denied.failed[0].reason).toMatch(/project manager/);
    const before = await db.notification.count({ where: { userId: cu } });
    const r2 = await bulkTransition(db, { organizationId: org, ids: [a.id, b.id, c.id], actor: { id: pm, type: "STAFF" }, to: "CLIENT_REVIEW" });
    expect(r2.moved).toBe(2); expect(r2.failed.map((f) => f.title)).toEqual(["Post C"]);
    expect(await db.notification.count({ where: { userId: cu } })).toBe(before + 1);
    await expect(bulkTransition(db, { organizationId: org, ids: [], actor: { id: pm, type: "STAFF" }, to: "CLIENT_REVIEW" })).rejects.toThrow(/at least one/);
  });

  it("lets a client approve all of its own posts but never another client's", async () => {
    const theirs = await post({ title: "Theirs", clientId: client2 });
    const mine = await db.contentItem.findMany({ where: { clientId: client, status: "CLIENT_REVIEW" }, select: { id: true } });
    const r = await bulkTransition(db, { organizationId: org, ids: [...mine.map((m) => m.id), theirs.id], actor: { id: cu, type: "CLIENT", clientId: client }, to: "APPROVED" });
    expect(r.moved).toBe(mine.length);
    expect(r.failed).toEqual([{ id: theirs.id, title: "Unknown post", reason: "Content not found." }]);
    expect(await db.notification.count({ where: { userId: ann, kind: "content.decision" } })).toBe(1);
  });
});

describe("hashtag groups", () => {
  it("saves cleaned groups per client, scoped to the organization", async () => {
    const g = await saveHashtagGroup(db, { organizationId: org, clientId: client, name: "Brand", tags: "acme, #Acme #boots", actorId: ann });
    expect(g.tags).toBe("#acme #boots");
    await expect(saveHashtagGroup(db, { organizationId: org, clientId: client, name: "X", tags: "#a", actorId: ann })).rejects.toThrow(/name/);
    await expect(saveHashtagGroup(db, { organizationId: org, clientId: client, name: "Empty", tags: " , ", actorId: ann })).rejects.toThrow(/at least one/);
    await expect(saveHashtagGroup(db, { organizationId: other, clientId: client, name: "Steal", tags: "#a", actorId: ann })).rejects.toThrow(/Client not found/);
    await expect(deleteHashtagGroup(db, { organizationId: other, id: g.id })).rejects.toThrow(/not found/);
    expect((await groupsFor(db, org, client)).map((x) => x.name)).toEqual(["Brand"]);
    expect(await groupsFor(db, org, null)).toEqual([]);
  });

  it("gives the planner recent titles and the client's groups", async () => {
    const m = await planMemory(db, org, client, "2027-01");
    expect(m.recentTitles).toEqual(expect.arrayContaining(["Boots", "Post A", "Post B"]));
    expect(m.hashtagGroups[0]).toMatchObject({ name: "Brand" });
    expect((await planMemory(db, org, client, "2026-12")).recentTitles).toEqual([]);
  });
});

describe("redo with AI", () => {
  const reply = (data: object) => async () => ({ ok: true, status: 200, json: async () => ({ stop_reason: "end_turn", usage: { input_tokens: 1000, output_tokens: 500 }, content: [{ type: "text", text: JSON.stringify(data) }] }) });
  const out = { title: "New idea", caption: "Fresh words", hashtags: "#new", brief: "New brief", platformCaptions: [{ platform: "X", caption: "Short X" }, { platform: "TIKTOK", caption: "not on this post" }] };

  it("new caption keeps the idea; different idea replaces title and brief; platforms fills own captions", async () => {
    const p = await post({ title: "Original", brief: "Old brief" });
    const c = await redoPost(db, { organizationId: org, itemId: p.id, mode: "CAPTION", actorId: ann, today: NOW, apiKey: "k", fetchImpl: reply(out) });
    expect(c).toMatchObject({ title: "Original", copy: "Fresh words", hashtags: "#new", brief: "Old brief", version: 2 });
    const pl = await redoPost(db, { organizationId: org, itemId: p.id, mode: "PLATFORMS", actorId: ann, today: NOW, apiKey: "k", fetchImpl: reply(out) });
    expect(pl.platformCopy).toEqual({ X: "Short X" }); expect(pl.copy).toBe("Fresh words");
    const i = await redoPost(db, { organizationId: org, itemId: p.id, mode: "IDEA", note: "about delivery", actorId: ann, today: NOW, apiKey: "k", fetchImpl: reply(out) });
    expect(i).toMatchObject({ title: "New idea", brief: "New brief", platformCopy: {} });
    expect(await db.contentAiRun.count({ where: { itemId: p.id, kind: { startsWith: "REDO_" } } })).toBe(3);
    expect(await db.contentVersion.count({ where: { itemId: p.id } })).toBe(4);
  });

  it("refuses wrong modes, missing keys, posts with the client, and one-platform splits", async () => {
    const p = await post({ platforms: ["INSTAGRAM"] });
    await expect(redoPost(db, { organizationId: org, itemId: p.id, mode: "NOPE", actorId: ann, apiKey: "k", fetchImpl: reply(out) })).rejects.toThrow(/what to redo/);
    await expect(redoPost(db, { organizationId: org, itemId: p.id, mode: "PLATFORMS", actorId: ann, apiKey: "k", fetchImpl: reply(out) })).rejects.toThrow(/one platform/);
    await expect(redoPost(db, { organizationId: org, itemId: p.id, mode: "CAPTION", actorId: ann, fetchImpl: reply(out) })).rejects.toThrow(/not configured/);
    await expect(redoPost(db, { organizationId: other, itemId: p.id, mode: "CAPTION", actorId: ann, apiKey: "k", fetchImpl: reply(out) })).rejects.toThrow(ContentAiError);
    await db.contentItem.update({ where: { id: p.id }, data: { status: "CLIENT_REVIEW" } });
    await expect(redoPost(db, { organizationId: org, itemId: p.id, mode: "CAPTION", actorId: ann, apiKey: "k", fetchImpl: reply(out) })).rejects.toThrow(/Withdraw/);
  });
});
