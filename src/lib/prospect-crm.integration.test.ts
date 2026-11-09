import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { logOutreach, priorityFor } from "./prospect-crm";
import { rescoreProspects, scoreOne } from "./prospect-scoring";
import { assign, claimProspect, dismiss, restore, ProspectorError, type Actor } from "./prospector";

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

const owned = (by: Actor, over: Record<string, unknown> = {}) => prospect({ status: "ASSIGNED", assignedToId: by.id, ...over });
const st = async (id: string) => (await db.prospect.findUniqueOrThrow({ where: { id } })).status;

describe("logging contact keeps a prospect a prospect", () => {
  it("Contacted moves it to Contacted, and the owner and a manager can both log", async () => {
    const p = await owned(ali);
    await logOutreach(db, ali, p.id, { outcome: "CONTACTED", note: "  No answer, try Monday  ", now: NOW });
    expect(await st(p.id)).toBe("CONTACTED");
    await logOutreach(db, mgr, p.id, { outcome: "CONTACTED", note: "Called again", now: new Date("2026-11-04T11:00:00Z") });
    const log = await db.prospectOutreach.findMany({ where: { prospectId: p.id }, orderBy: { createdAt: "asc" } });
    expect(log.map((l) => [l.userId, l.outcome, l.note])).toEqual([[ali.id, "CONTACTED", "No answer, try Monday"], [mgr.id, "CONTACTED", "Called again"]]);
    expect((await db.prospect.findUniqueOrThrow({ where: { id: p.id } })).leadId).toBeNull();
    expect(await db.lead.count({ where: { source: "Prospector" } })).toBe(0);
  });
  it("Not interested closes the prospect, keeps it, and nobody can contact, assign or convert it until a manager restores it", async () => {
    const p = await owned(ali);
    await logOutreach(db, ali, p.id, { outcome: "NOT_INTERESTED", note: "Has an agency already" });
    expect(await st(p.id)).toBe("NOT_INTERESTED");
    await expect(logOutreach(db, ali, p.id, { outcome: "INTERESTED" })).rejects.toThrow(/not interested and is closed/);
    await expect(logOutreach(db, mgr, p.id, { outcome: "CONTACTED" })).rejects.toThrow(/closed/);
    expect(await assign(db, mgr, [p.id], zara.id)).toBe(0);
    expect((await db.prospect.findUniqueOrThrow({ where: { id: p.id } })).assignedToId).toBe(ali.id);
    expect(await db.lead.count({ where: { source: "Prospector" } })).toBe(0);
    await expect(restore(db, ali, [p.id])).rejects.toThrow(/sales manager/);
    expect(await restore(db, mgr, [p.id])).toBe(1);
    expect(await st(p.id)).toBe("ASSIGNED"); // back to the person who had it
    await logOutreach(db, ali, p.id, { outcome: "CONTACTED" });
    expect(await st(p.id)).toBe("CONTACTED");
  });
  it("reassigning a prospect that is being worked keeps it Contacted", async () => {
    const p = await owned(ali);
    await logOutreach(db, ali, p.id, { outcome: "CONTACTED" });
    expect(await assign(db, mgr, [p.id], zara.id)).toBe(1);
    expect(await db.prospect.findUniqueOrThrow({ where: { id: p.id } })).toMatchObject({ status: "CONTACTED", assignedToId: zara.id });
  });
  it("refuses anyone else, other organizations, bad outcomes, and prospects that are already leads or dismissed", async () => {
    const p = await owned(ali);
    await expect(logOutreach(db, zara, p.id, { outcome: "CONTACTED" })).rejects.toThrow(/assigned to/);
    await expect(logOutreach(db, nobody, p.id, { outcome: "INTERESTED" })).rejects.toThrow(/assigned to/);
    await expect(logOutreach(db, foreign, p.id, { outcome: "CONTACTED" })).rejects.toBeInstanceOf(ProspectorError);
    await expect(logOutreach(db, ali, p.id, { outcome: "SIGNED" })).rejects.toThrow(/Choose what happened/);
    await expect(logOutreach(db, ali, "missing", { outcome: "CONTACTED" })).rejects.toBeInstanceOf(ProspectorError);
    const gone = await owned(ali);
    await dismiss(db, mgr, [gone.id]);
    await expect(logOutreach(db, ali, gone.id, { outcome: "CONTACTED" })).rejects.toThrow(/assigned to/); // dismissing clears the owner
    await expect(logOutreach(db, mgr, gone.id, { outcome: "CONTACTED" })).rejects.toThrow(/dismissed/);
    const sent = await owned(ali);
    await logOutreach(db, ali, sent.id, { outcome: "INTERESTED" });
    await expect(logOutreach(db, ali, sent.id, { outcome: "CONTACTED" })).rejects.toThrow(/already a lead/);
    expect(await db.prospectOutreach.count({ where: { prospectId: p.id } })).toBe(0);
    expect(await st(p.id)).toBe("ASSIGNED");
    expect(await db.lead.count({ where: { source: "Prospector", organizationId: other } })).toBe(0);
  });
});

describe("Interested turns the prospect into a lead", () => {
  it("makes the lead with the contact, service, priority, owner, call note and contact history, and marks the prospect Converted", async () => {
    // a weak site: low mobile speed and SEO, no title, no analytics: scores high
    const p = await owned(ali, { website: "https://weak.example", rating: 4.8, ratingCount: 220, mapsUrl: "https://maps.example/x" });
    await db.prospectWebsiteCheck.create({ data: { prospectId: p.id, organizationId: org, status: "DONE", reachable: true, https: false, hasTitle: false, hasMetaDescription: false, hasAnalytics: false, hasGtm: false, hasMetaPixel: false, hasContactForm: false, hasWhatsapp: false, lowConfidence: false, psiStatus: "OK", mobileScore: 38, seoScore: 62, checkedAt: NOW } });
    await rescoreProspects(db, org, [p.id], NOW);
    await logOutreach(db, ali, p.id, { outcome: "CONTACTED", note: "Spoke to the receptionist", now: new Date("2026-11-03T09:00:00Z") });
    const r = await logOutreach(db, ali, p.id, { outcome: "INTERESTED", note: "Wants a new website, call Monday", now: new Date("2026-11-04T09:00:00Z") });
    expect(r).toMatchObject({ outcome: "INTERESTED", linkedExisting: false });
    const after = await db.prospect.findUniqueOrThrow({ where: { id: p.id } });
    expect(after).toMatchObject({ status: "SENT_TO_CRM", leadId: r.leadId });
    const lead = await db.lead.findUniqueOrThrow({ where: { id: r.leadId! }, include: { stage: true, activities: true } });
    expect(lead).toMatchObject({ name: p.name, company: p.name, phone: p.phone, city: "Lahore", country: "Pakistan", source: "Prospector", priority: "HIGH", assignedToId: ali.id, createdById: ali.id, organizationId: org });
    expect(lead.stage.name).toBe("New"); // the first open stage, not Won
    expect(lead.serviceInterest).toBe("SEO and web optimisation");
    expect(lead.tags).toEqual(["prospector", "seo"]);
    expect(lead.website).toBe("https://weak.example");
    const notes = lead.activities.filter((a) => a.kind === "NOTE").map((a) => a.body ?? "");
    expect(notes.find((b) => b.startsWith("Contact history"))).toMatch(/2026-11-03 · Ali Agent · Contacted: Spoke to the receptionist\n2026-11-04 · Ali Agent · Interested: Wants a new website, call Monday/);
    expect(notes).toContain((await scoreOne(db, org, p.id, NOW))!.pitch);
    expect(lead.activities.find((a) => a.kind === "CREATED")?.body).toContain("said it is interested");
    expect(lead.contactId).not.toBeNull();
    expect(await db.contactActivity.count({ where: { contactId: lead.contactId!, kind: "NOTE" } })).toBe(2);
    expect(await db.notification.count({ where: { userId: ali.id, kind: "lead.assigned" } })).toBe(0); // they did it themselves
  });
  it("sets the priority from the score", () => {
    expect([priorityFor(80), priorityFor(60), priorityFor(59), priorityFor(35), priorityFor(34), priorityFor(0), priorityFor(null)]).toEqual(["HIGH", "HIGH", "MEDIUM", "MEDIUM", "LOW", "LOW", "LOW"]);
  });
  it("cannot make two leads, even from two clicks at once", async () => {
    const p = await owned(ali);
    const before = await db.lead.count({ where: { source: "Prospector" } });
    const both = await Promise.allSettled([logOutreach(db, ali, p.id, { outcome: "INTERESTED" }), logOutreach(db, mgr, p.id, { outcome: "INTERESTED" })]);
    expect(both.filter((x) => x.status === "fulfilled")).toHaveLength(1);
    expect(await db.lead.count({ where: { source: "Prospector" } })).toBe(before + 1);
    expect(await db.prospectOutreach.count({ where: { prospectId: p.id } })).toBe(1); // the loser left no log entry
  });
  it("keeps the owner when a manager records the interest, and tells them", async () => {
    await db.notification.deleteMany({});
    const p = await owned(zara);
    const r = await logOutreach(db, mgr, p.id, { outcome: "INTERESTED" });
    expect((await db.lead.findUniqueOrThrow({ where: { id: r.leadId! } })).assignedToId).toBe(zara.id);
    expect(await db.notification.count({ where: { userId: zara.id, kind: "lead.assigned" } })).toBe(1);
    expect(await db.notification.count({ where: { userId: mgr.id } })).toBe(0);
  });
  it("gives a prospect nobody owned to the manager who recorded the interest", async () => {
    const p = await prospect();
    const r = await logOutreach(db, mgr, p.id, { outcome: "INTERESTED", note: "Walked in" });
    expect((await db.lead.findUniqueOrThrow({ where: { id: r.leadId! } })).assignedToId).toBe(mgr.id);
  });
});

describe("duplicates and blocked numbers", () => {
  it("refuses a do-not-contact number, links a lead that already has the number, and allows a prospect with no phone", async () => {
    const dnc = await owned(ali);
    await db.suppressedContact.create({ data: { organizationId: org, phone: dnc.phone! } });
    await expect(logOutreach(db, ali, dnc.id, { outcome: "INTERESTED" })).rejects.toThrow(/do-not-contact/);
    expect(await st(dnc.id)).toBe("ASSIGNED");
    expect(await db.prospectOutreach.count({ where: { prospectId: dnc.id } })).toBe(0);

    const stage = await db.pipelineStage.findFirstOrThrow({ where: { organizationId: org, name: "New" } });
    const known = await owned(ali);
    const lead = await db.lead.create({ data: { organizationId: org, name: "Known", phone: known.phone!.replace("+92", "0"), stageId: stage.id } });
    const before = await db.lead.count({ where: { organizationId: org } });
    const r = await logOutreach(db, ali, known.id, { outcome: "INTERESTED" });
    expect(r).toMatchObject({ leadId: lead.id, linkedExisting: true });
    expect(await db.lead.count({ where: { organizationId: org } })).toBe(before);
    expect(await db.prospect.findUniqueOrThrow({ where: { id: known.id } })).toMatchObject({ status: "SENT_TO_CRM", leadId: lead.id });

    // the lead made by a conversion claims its phone, so the CRM-wide guard now protects it too
    const mine = await owned(ali);
    const made = await logOutreach(db, ali, mine.id, { outcome: "INTERESTED" });
    expect(await db.leadKey.count({ where: { leadId: made.leadId!, kind: "PHONE", key: mine.phone! } })).toBe(1);
    // a second prospect row with the same number (found under another place id) links that lead instead of making a copy
    const twin = await owned(ali, { phone: mine.phone });
    expect(await logOutreach(db, ali, twin.id, { outcome: "INTERESTED" })).toMatchObject({ leadId: made.leadId, linkedExisting: true });

    const noPhone = await owned(ali, { phone: null });
    const n = await logOutreach(db, ali, noPhone.id, { outcome: "INTERESTED" });
    expect((await db.lead.findUniqueOrThrow({ where: { id: n.leadId! } })).phone).toBeNull();
  });
});

describe("the duplicate setting", () => {
  it("with checking switched off, conversion does not look for an existing lead", async () => {
    await db.crmSettings.upsert({ where: { organizationId: org }, create: { organizationId: org, duplicateMode: "OFF", defaultCountry: "PK" }, update: { duplicateMode: "OFF" } });
    try {
      const stage = await db.pipelineStage.findFirstOrThrow({ where: { organizationId: org, name: "New" } });
      const p = await owned(ali);
      await db.lead.create({ data: { organizationId: org, name: "Same number", phone: p.phone, stageId: stage.id } });
      const r = await logOutreach(db, ali, p.id, { outcome: "INTERESTED" });
      expect(r.linkedExisting).toBe(false);
    } finally {
      await db.crmSettings.update({ where: { organizationId: org }, data: { duplicateMode: "BLOCK" } });
    }
  });
});

describe("channel, result and claiming", () => {
  it("stores how and whether they were reached, refuses unknown values, and carries it into the lead history", async () => {
    const p = await owned(ali);
    await expect(logOutreach(db, ali, p.id, { outcome: "CONTACTED", channel: "PIGEON" })).rejects.toThrow(/how you reached/);
    await expect(logOutreach(db, ali, p.id, { outcome: "CONTACTED", result: "MAYBE" })).rejects.toThrow(/spoke/);
    await logOutreach(db, ali, p.id, { outcome: "CONTACTED", channel: "WHATSAPP", result: "NO_ANSWER" });
    const r = await logOutreach(db, ali, p.id, { outcome: "INTERESTED", channel: "CALL", result: "SPOKE", note: "Wants a demo" });
    const log = await db.prospectOutreach.findMany({ where: { prospectId: p.id }, orderBy: { createdAt: "asc" } });
    expect(log.map((l) => [l.channel, l.result])).toEqual([["WHATSAPP", "NO_ANSWER"], ["CALL", "SPOKE"]]);
    const note = await db.leadActivity.findFirstOrThrow({ where: { leadId: r.leadId!, body: { contains: "Contact history" } } });
    expect(note.body).toContain("(WhatsApp, no answer)");
    expect(note.body).toContain("(Phone call, spoke to them)");
  });
  it("an agent claims an unassigned prospect from their own search, once; others cannot", async () => {
    const mine = await prospect({ searchId: (await db.prospectSearch.create({ data: { organizationId: org, userId: ali.id, businessType: "x", city: "Lahore", country: "PK", query: "q" } })).id });
    await expect(claimProspect(db, zara, mine.id)).rejects.toThrow(/not found/); // not in Zara's list
    await expect(claimProspect(db, nobody, mine.id)).rejects.toThrow(ProspectorError);
    expect(await claimProspect(db, ali, mine.id)).toEqual({ name: mine.name });
    const after = await db.prospect.findUniqueOrThrow({ where: { id: mine.id } });
    expect([after.status, after.assignedToId]).toEqual(["ASSIGNED", ali.id]);
    await expect(claimProspect(db, ali, mine.id)).rejects.toThrow(/already yours/);
    await logOutreach(db, ali, mine.id, { outcome: "CONTACTED", channel: "CALL", result: "SPOKE" });
    const taken = await owned(zara, { searchId: mine.searchId });
    await expect(claimProspect(db, ali, taken.id)).rejects.toThrow(/someone else/);
  });
});
