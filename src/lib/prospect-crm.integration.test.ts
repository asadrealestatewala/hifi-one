import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { MAX_SEND_PER_CLICK, priorityFor, sendToCrm } from "./prospect-crm";
import { rescoreProspects, scoreOne } from "./prospect-scoring";
import { ProspectorError, type Actor } from "./prospector";

const url = process.env.TEST_DATABASE_URL ?? "postgresql://hifi:hifi_local_dev@localhost:54329/hifi_one_test";
const db = new PrismaClient({ datasourceUrl: url });
let org: string, other: string, searchId: string, mgr: Actor, ali: Actor, zara: Actor, nobody: Actor, foreign: Actor;
let n = 0;
const NOW = new Date("2026-11-04T10:00:00Z");
const actor = (id: string, organizationId: string, perms: string[]): Actor => ({ id, organizationId, permissions: new Set(perms) });
const phone = (k: number) => `+92300777${String(k).padStart(4, "0")}`;
// a prospect straight in the table, scored the way the app would have scored it
async function prospect(over: Record<string, unknown> = {}) {
  const k = ++n;
  const p = await db.prospect.create({ data: { organizationId: org, searchId, placeId: `crm-${k}`, name: `Clinic ${k}`, address: `${k} Mall Road`, city: "Lahore", country: "PK", phone: phone(k), website: null, rating: 3.4, ratingCount: 3, ...over } });
  await rescoreProspects(db, org, [p.id], NOW);
  return db.prospect.findUniqueOrThrow({ where: { id: p.id } });
}

beforeAll(async () => {
  await db.$executeRawUnsafe('TRUNCATE "ProspectSocial","ProspectWebsiteCheck","ApiCall","Prospect","ProspectSearch","SuppressedContact","ContactActivity","Contact","LeadActivity","Lead","PipelineStage","Notification","UserRole","RolePermission","Permission","Role","User","Organization" CASCADE');
  org = (await db.organization.create({ data: { name: "Crm Org" } })).id;
  other = (await db.organization.create({ data: { name: "Other" } })).id;
  const mk = async (organizationId: string, email: string, name: string) => (await db.user.create({ data: { organizationId, email, name, passwordHash: "x" } })).id;
  const [m, a, z, nb, o] = await Promise.all([mk(org, "m@crm.test", "Mona Manager"), mk(org, "a@crm.test", "Ali Agent"), mk(org, "z@crm.test", "Zara Agent"), mk(org, "n@crm.test", "Nina None"), mk(other, "o@crm.test", "Olga")]);
  const crmEdit = await db.permission.create({ data: { key: "crm.edit", description: "x" } });
  const role = await db.role.create({ data: { organizationId: org, key: "SALES", name: "Sales" } });
  await db.rolePermission.create({ data: { roleId: role.id, permissionId: crmEdit.id } });
  for (const u of [m, a, z]) await db.userRole.create({ data: { userId: u, roleId: role.id } });
  await db.pipelineStage.create({ data: { organizationId: org, name: "Won", sortOrder: 9, probability: 100, isWon: true } });
  await db.pipelineStage.create({ data: { organizationId: org, name: "New", sortOrder: 1, probability: 10 } });
  searchId = (await db.prospectSearch.create({ data: { organizationId: org, userId: m, businessType: "dentist", city: "Lahore", country: "PK", query: "q" } })).id;
  mgr = actor(m, org, ["crm.view", "crm.view_all", "crm.edit", "prospector.use", "prospector.manage"]);
  ali = actor(a, org, ["crm.view", "crm.edit", "prospector.use"]);
  zara = actor(z, org, ["crm.view", "crm.edit"]);
  nobody = actor(nb, org, ["crm.view"]);
  foreign = actor(o, other, ["crm.view", "crm.view_all", "crm.edit"]);
});
afterAll(async () => { await db.$disconnect(); });

describe("who may send", () => {
  it("only a sales manager can send; an agent, a viewer and another organization's manager create nothing", async () => {
    const p = await prospect();
    await expect(sendToCrm(db, ali, [p.id], { who: "TEAM" })).rejects.toThrow(/sales manager/);
    await expect(sendToCrm(db, nobody, [p.id], { who: "TEAM" })).rejects.toThrow(/sales manager/);
    await expect(sendToCrm(db, foreign, [p.id], { who: "TEAM" })).rejects.toThrow(/nobody on the sales team/);
    expect(await db.lead.count({ where: { source: "Prospector" } })).toBe(0);
    expect((await db.prospect.findUniqueOrThrow({ where: { id: p.id } })).status).toBe("NEW");
  });
  it("refuses an owner who is not on the sales team", async () => {
    const p = await prospect();
    await expect(sendToCrm(db, mgr, [p.id], { who: nobody.id })).rejects.toBeInstanceOf(ProspectorError);
    await expect(sendToCrm(db, mgr, [p.id], { who: "someone-else" })).rejects.toThrow(/sales team member/);
  });
});

describe("the lead that is made", () => {
  it("carries the contact, the service, a priority from the score and the call note, and marks the prospect as sent", async () => {
    // a weak site: low mobile speed and SEO, no title, no analytics: scores high
    const p = await prospect({ website: "https://weak.example", rating: 4.8, ratingCount: 220, mapsUrl: "https://maps.example/x" });
    await db.prospectWebsiteCheck.create({ data: { prospectId: p.id, organizationId: org, status: "DONE", reachable: true, https: false, hasTitle: false, hasMetaDescription: false, hasAnalytics: false, hasGtm: false, hasMetaPixel: false, hasContactForm: false, hasWhatsapp: false, lowConfidence: false, psiStatus: "OK", mobileScore: 38, seoScore: 62, checkedAt: NOW } });
    await rescoreProspects(db, org, [p.id], NOW);
    const scored = await db.prospect.findUniqueOrThrow({ where: { id: p.id } });
    expect(scored.score).toBeGreaterThanOrEqual(60);
    const r = await sendToCrm(db, mgr, [p.id], { who: ali.id, now: NOW });
    expect(r).toMatchObject({ sent: 1, alreadyLead: 0, noPhone: 0, blocked: 0, skipped: 0 });
    const after = await db.prospect.findUniqueOrThrow({ where: { id: p.id } });
    expect(after.status).toBe("SENT_TO_CRM");
    const lead = await db.lead.findUniqueOrThrow({ where: { id: after.leadId! }, include: { stage: true, activities: true } });
    expect(lead).toMatchObject({ name: p.name, company: p.name, phone: p.phone, city: "Lahore", country: "Pakistan", source: "Prospector", priority: "HIGH", assignedToId: ali.id, createdById: mgr.id, organizationId: org });
    expect(lead.stage.name).toBe("New"); // the first open stage, not Won
    expect(lead.serviceInterest).toBe("SEO and web optimisation");
    expect(lead.tags).toEqual(["prospector", "seo"]);
    expect(lead.notes).toContain("https://weak.example");
    const fresh = (await scoreOne(db, org, p.id, NOW))!;
    expect(lead.activities.find((a) => a.kind === "NOTE")?.body).toBe(fresh.pitch);
    expect(lead.activities.find((a) => a.kind === "CREATED")?.body).toContain("Sent from Prospector");
    expect(lead.contactId).not.toBeNull();
    expect(await db.contactActivity.count({ where: { contactId: lead.contactId!, kind: "NOTE" } })).toBe(1);
    const notes = await db.notification.findMany({ where: { userId: ali.id, kind: "lead.assigned" } });
    expect(notes).toHaveLength(1);
  });
  it("sets the priority from the score", () => {
    expect([priorityFor(80), priorityFor(60), priorityFor(59), priorityFor(35), priorityFor(34), priorityFor(0), priorityFor(null)]).toEqual(["HIGH", "HIGH", "MEDIUM", "MEDIUM", "LOW", "LOW", "LOW"]);
  });
  it("cannot be sent twice, even by two people pressing at once", async () => {
    const ps = await Promise.all([prospect(), prospect(), prospect()]);
    const ids = ps.map((p) => p.id);
    const before = await db.lead.count({ where: { source: "Prospector" } });
    const both = await Promise.all([sendToCrm(db, mgr, ids, { who: "TEAM", now: NOW }), sendToCrm(db, mgr, ids, { who: "TEAM", now: NOW })]);
    expect(both[0].sent + both[1].sent).toBe(3);
    expect(await db.lead.count({ where: { source: "Prospector" } })).toBe(before + 3);
    const again = await sendToCrm(db, mgr, ids, { who: "TEAM", now: NOW });
    expect(again).toMatchObject({ sent: 0, skipped: 3 });
  });
});

describe("who owns the leads", () => {
  it("shares a batch fairly across the sales team and tells each person once", async () => {
    await db.notification.deleteMany({});
    const ps = await Promise.all([1, 2, 3, 4, 5, 6].map(() => prospect()));
    const r = await sendToCrm(db, mgr, ps.map((p) => p.id), { who: "TEAM", now: NOW });
    expect(r.sent).toBe(6);
    // fair share counts what each person already has from Prospector, so the totals end up level
    const totals = await Promise.all([mgr.id, ali.id, zara.id].map((id) => db.lead.count({ where: { organizationId: org, source: "Prospector", assignedToId: id } })));
    expect(Math.max(...totals) - Math.min(...totals)).toBeLessThanOrEqual(1);
    for (const a of r.byAgent.filter((x) => x.agentId !== mgr.id)) expect(await db.notification.count({ where: { userId: a.agentId, kind: "lead.assigned" } })).toBe(1);
    expect(await db.notification.count({ where: { userId: mgr.id } })).toBe(0); // the sender is not told about their own click
    expect(await db.notification.count({ where: { userId: nobody.id } })).toBe(0);
  });
  it("keeps the person a manager already assigned the prospect to, and gives everything to one chosen person", async () => {
    const mine = await prospect({ status: "ASSIGNED", assignedToId: zara.id });
    const free = await prospect();
    const r = await sendToCrm(db, mgr, [mine.id, free.id], { who: ali.id, now: NOW });
    expect(r.sent).toBe(2);
    expect((await db.lead.findUniqueOrThrow({ where: { id: (await db.prospect.findUniqueOrThrow({ where: { id: mine.id } })).leadId! } })).assignedToId).toBe(zara.id);
    expect((await db.lead.findUniqueOrThrow({ where: { id: (await db.prospect.findUniqueOrThrow({ where: { id: free.id } })).leadId! } })).assignedToId).toBe(ali.id);
  });
});

describe("what is left out", () => {
  it("leaves out no phone, do-not-contact numbers, dismissed prospects and prospects of other organizations, and links an existing lead instead of copying it", async () => {
    const noPhone = await prospect({ phone: null });
    const dnc = await prospect();
    await db.suppressedContact.create({ data: { organizationId: org, phone: dnc.phone! } });
    const dismissed = await prospect({ status: "DISMISSED" });
    const stage = await db.pipelineStage.findFirstOrThrow({ where: { organizationId: org, name: "New" } });
    const known = await prospect();
    const lead = await db.lead.create({ data: { organizationId: org, name: "Known", phone: known.phone!.replace("+92", "0"), stageId: stage.id } });
    const good = await prospect();
    const before = await db.lead.count({ where: { organizationId: org } });
    const r = await sendToCrm(db, mgr, [noPhone.id, dnc.id, dismissed.id, known.id, good.id, "missing-id"], { who: "TEAM", now: NOW });
    expect(r).toMatchObject({ sent: 1, noPhone: 1, blocked: 1, skipped: 1, alreadyLead: 1, unavailable: 1 });
    expect(await db.lead.count({ where: { organizationId: org } })).toBe(before + 1);
    expect(await db.prospect.findUniqueOrThrow({ where: { id: known.id } })).toMatchObject({ status: "SENT_TO_CRM", leadId: lead.id });
    expect((await db.prospect.findUniqueOrThrow({ where: { id: noPhone.id } })).status).toBe("NEW");
    expect((await db.prospect.findUniqueOrThrow({ where: { id: dnc.id } })).status).toBe("NEW");
    expect((await db.prospect.findUniqueOrThrow({ where: { id: dismissed.id } })).status).toBe("DISMISSED");
  });
  it("sends at most a fixed number per click, best score first, and says how many are left", async () => {
    const strong = await prospect({ rating: 3.0, ratingCount: 2 }); // no website, few reviews, low rating: 51
    await db.prospect.createMany({ data: Array.from({ length: MAX_SEND_PER_CLICK + 2 }, (_, i) => ({ organizationId: org, searchId, placeId: `bulk-${i}`, name: `Bulk ${i}`, phone: phone(5000 + i), country: "PK", city: "Lahore", score: 10 })) });
    const ids = (await db.prospect.findMany({ where: { organizationId: org, OR: [{ id: strong.id }, { placeId: { startsWith: "bulk-" } }] }, select: { id: true } })).map((x) => x.id);
    const r = await sendToCrm(db, mgr, ids, { who: "TEAM", now: NOW });
    expect(r.sent).toBe(MAX_SEND_PER_CLICK);
    expect(r.left).toBe(3);
    expect((await db.prospect.findUniqueOrThrow({ where: { id: strong.id } })).status).toBe("SENT_TO_CRM");
  });
  it("sent prospects can no longer be dismissed or reassigned, and the lead stays when the prospect list is searched again", async () => {
    const sent = await db.prospect.findFirstOrThrow({ where: { organizationId: org, status: "SENT_TO_CRM", leadId: { not: null } } });
    const { dismiss } = await import("./prospector");
    expect(await dismiss(db, mgr, [sent.id])).toBe(0);
    expect(await db.lead.count({ where: { id: sent.leadId! } })).toBe(1);
  });
});
