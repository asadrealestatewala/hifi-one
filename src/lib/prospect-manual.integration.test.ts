import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { addProspect, removeOwnProspect } from "./prospect-manual";
import { logOutreach } from "./prospect-crm";
import { prospectWhere, ProspectorError, restore, type Actor } from "./prospector";

const url = process.env.TEST_DATABASE_URL ?? "postgresql://hifi:hifi_local_dev@localhost:54329/hifi_one_test";
const db = new PrismaClient({ datasourceUrl: url });
let org: string, other: string, ali: Actor, zara: Actor, mgr: Actor, viewer: Actor, foreign: Actor;
const NOW = new Date("2026-11-05T10:00:00Z");
const actor = (id: string, organizationId: string, perms: string[]): Actor => ({ id, organizationId, permissions: new Set(perms) });
const add = (a: Actor, over: Record<string, unknown> = {}) => addProspect(db, a, { name: "Ahmed Traders", phone: "0300 5550001", country: "PK", source: "REFERRAL", note: "Sara from Gulberg says they need a website", ...over }, NOW);
const fails = (p: Promise<unknown>, text: RegExp) => expect(p).rejects.toThrow(text);

beforeAll(async () => {
  await db.$executeRawUnsafe('TRUNCATE "ProspectOutreach","ProspectSocial","ProspectWebsiteCheck","Prospect","ProspectSearch","SuppressedContact","LeadKey","ContactActivity","Contact","LeadActivity","Lead","PipelineStage","CrmSettings","Notification","UserRole","RolePermission","Permission","Role","User","Organization" CASCADE');
  org = (await db.organization.create({ data: { name: "Manual Org" } })).id;
  other = (await db.organization.create({ data: { name: "Other" } })).id;
  const mk = async (organizationId: string, email: string, name: string) => (await db.user.create({ data: { organizationId, email, name, passwordHash: "x" } })).id;
  const [a, z, m, v, o] = await Promise.all([mk(org, "a@m.test", "Ali Agent"), mk(org, "z@m.test", "Zara Agent"), mk(org, "m@m.test", "Mona Manager"), mk(org, "v@m.test", "Vic Viewer"), mk(other, "o@m.test", "Olga")]);
  await db.pipelineStage.create({ data: { organizationId: org, name: "New", sortOrder: 1, probability: 10 } });
  ali = actor(a, org, ["crm.view", "crm.edit"]);
  zara = actor(z, org, ["crm.view", "crm.edit"]);
  mgr = actor(m, org, ["crm.view", "crm.edit", "crm.view_all"]);
  viewer = actor(v, org, ["crm.view"]);
  foreign = actor(o, other, ["crm.view", "crm.edit"]);
});
afterAll(async () => { await db.$disconnect(); });

describe("an agent adds a prospect they found themselves", () => {
  it("saves it owned by the agent, as a prospect and not a lead, with a normalised phone and email", async () => {
    const r = await add(ali, { email: "  Bilal@Ahmed.PK " });
    const p = await db.prospect.findUniqueOrThrow({ where: { id: r.id } });
    expect(p).toMatchObject({ origin: "MANUAL", status: "ASSIGNED", assignedToId: ali.id, addedById: ali.id, searchId: null, name: "Ahmed Traders", phone: "+923005550001", email: "bilal@ahmed.pk", country: "PK", sourceLabel: "REFERRAL", notes: "Sara from Gulberg says they need a website" });
    expect(p.placeId.startsWith("manual:")).toBe(true);
    expect(p.score).not.toBeNull();
    expect(await db.lead.count()).toBe(0);
  });
  it("is visible to its owner and a manager, and to nobody else", async () => {
    const mine = await db.prospect.findMany({ where: prospectWhere(ali, {}) });
    expect(mine.some((p) => p.phone === "+923005550001")).toBe(true);
    expect((await db.prospect.findMany({ where: prospectWhere(zara, {}) })).length).toBe(0);
    expect((await db.prospect.findMany({ where: prospectWhere(mgr, {}) })).length).toBeGreaterThan(0);
    expect((await db.prospect.findMany({ where: prospectWhere(ali, { mineOnly: true, manual: true }) })).length).toBe(1);
    expect((await db.prospect.findMany({ where: prospectWhere(mgr, { mineOnly: true }) })).length).toBe(0);
  });
  it("needs edit access, a name, a source, and a phone or email, and names the field each problem belongs to", async () => {
    await fails(add(viewer), /permission/);
    const field = async (over: Record<string, unknown>) => add(ali, over).then(() => "saved", (e: ProspectorError) => e.field ?? "general");
    expect(await field({ name: "" })).toBe("name");
    expect(await field({ source: "" })).toBe("source");
    expect(await field({ phone: "", email: "" })).toBe("phone");
    expect(await field({ phone: "abc" })).toBe("phone");
    expect(await field({ phone: "0300 55", name: "Short" })).toBe("phone");
    expect(await field({ phone: "", email: "nope" })).toBe("email");
  });
  it("reads a local number in the chosen country, and says exactly what is wrong with one it cannot read", async () => {
    expect((await add(ali, { name: "Local A", phone: "0300-5550101" })).id).toBeTruthy();
    expect((await add(ali, { name: "Local B", phone: "(020) 7946 0958", country: "GB" })).id).toBeTruthy();
    expect((await add(ali, { name: "Intl", phone: "+971 50 555 0102", country: "PK" })).id).toBeTruthy();
    expect(await db.prospect.findMany({ where: { name: { in: ["Local A", "Local B", "Intl"] } }, select: { name: true, phone: true }, orderBy: { name: "asc" } })).toEqual([{ name: "Intl", phone: "+971505550102" }, { name: "Local A", phone: "+923005550101" }, { name: "Local B", phone: "+442079460958" }]);
    await fails(add(ali, { name: "Too short", phone: "0300 123" }), /too short for Pakistan.*For example 0300 1234567/);
    await fails(add(ali, { name: "Too long", phone: "0300 123456789" }), /too long for Pakistan/);
    await fails(add(ali, { name: "Letters", phone: "03OO 1234567" }), /digits only/);
  });
  it("refuses a number or email that is already a prospect, in any spelling, and does not reveal other people's prospects", async () => {
    await fails(add(ali, { phone: "+92 300 5550001" }), /Ahmed Traders is already in Prospector/);
    await fails(add(ali, { phone: "", email: "BILAL@ahmed.pk" }), /already in Prospector/);
    await fails(add(zara, { phone: "03005550001" }), /belongs to another team member/);
    expect(await db.prospect.count({ where: { phone: "+923005550001" } })).toBe(1);
  });
  it("two agents adding the same person at the same moment make one prospect", async () => {
    const results = await Promise.allSettled([add(ali, { name: "Race A", phone: "0300 5550010" }), add(zara, { name: "Race B", phone: "0300 5550010" })]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await db.prospect.count({ where: { phone: "+923005550010" } })).toBe(1);
  });
  it("refuses numbers and emails on the do-not-contact list", async () => {
    await db.suppressedContact.createMany({ data: [{ organizationId: org, phone: "03005550020" }, { organizationId: org, email: "stop@x.pk" }] });
    await fails(add(ali, { phone: "+92 300 5550020" }), /do-not-contact/);
    await fails(add(ali, { phone: "", email: "Stop@X.pk" }), /do-not-contact/);
  });
  it("applies the lead duplicate protection: blocked in BLOCK mode, confirmable in WARN, skipped when OFF", async () => {
    const stage = await db.pipelineStage.findFirstOrThrow({ where: { organizationId: org } });
    await db.lead.create({ data: { organizationId: org, name: "Existing Lead", phone: "+923005550030", email: "lead@x.pk", stageId: stage.id, assignedToId: zara.id } });
    await fails(add(ali, { phone: "0300 5550030" }), /A lead with this phone number already exists and belongs to another team member/);
    await fails(add(ali, { phone: "", email: "lead@x.pk" }), /already exists/);
    await fails(add(mgr, { phone: "0300 5550030" }), /Existing Lead/);
    await db.crmSettings.upsert({ where: { organizationId: org }, create: { organizationId: org, duplicateMode: "WARN" }, update: { duplicateMode: "WARN" } });
    await fails(add(ali, { phone: "0300 5550030" }), /Add anyway/);
    expect((await add(ali, { name: "Warn ok", phone: "0300 5550030", confirm: true })).id).toBeTruthy();
    await db.crmSettings.update({ where: { organizationId: org }, data: { duplicateMode: "OFF" } });
    expect((await add(ali, { name: "Off mode", phone: "", email: "lead@x.pk" })).id).toBeTruthy();
    await db.crmSettings.update({ where: { organizationId: org }, data: { duplicateMode: "BLOCK" } });
  });
  it("removing a prospect added by mistake: only before any contact, only by its adder or a manager, kept as dismissed", async () => {
    const a = await add(ali, { name: "Typo", phone: "0300 5550060" });
    await expect(removeOwnProspect(db, zara, a.id)).rejects.toBeInstanceOf(ProspectorError);
    await expect(removeOwnProspect(db, viewer, a.id)).rejects.toBeInstanceOf(ProspectorError);
    await removeOwnProspect(db, ali, a.id);
    expect((await db.prospect.findUniqueOrThrow({ where: { id: a.id } })).status).toBe("DISMISSED");
    await expect(removeOwnProspect(db, ali, a.id)).rejects.toThrow(/already been contacted or closed/);
    const b = await add(ali, { name: "Called", phone: "0300 5550061" });
    await logOutreach(db, ali, b.id, { outcome: "CONTACTED" });
    await expect(removeOwnProspect(db, ali, b.id)).rejects.toThrow(/already been contacted or closed/);
    const g = await db.prospect.create({ data: { organizationId: org, placeId: "g-1", name: "Google one", status: "ASSIGNED", assignedToId: ali.id } });
    await expect(removeOwnProspect(db, mgr, g.id)).rejects.toThrow(/Only the person who added/);
  });
  it("a deleted prospect can be added again by the person who deleted it (the record comes back, no duplicate); others are told to ask a manager", async () => {
    const a = await add(ali, { name: "Typo name", phone: "0300 5550070", note: "wrong note" });
    await removeOwnProspect(db, ali, a.id);
    await fails(add(zara, { name: "Same person", phone: "0300 5550070" }), /dismissed\. Ask a sales manager to restore it/);
    const again = await add(ali, { name: "Right name", phone: "0300 5550070", note: "right note" });
    expect(again.id).toBe(a.id);
    expect(await db.prospect.count({ where: { organizationId: org, phone: "+923005550070" } })).toBe(1);
    expect(await db.prospect.findUniqueOrThrow({ where: { id: a.id } })).toMatchObject({ name: "Right name", notes: "right note", status: "ASSIGNED", assignedToId: ali.id });
  });
  it("My Prospects hides deleted prospects by default, and a manager restores one to its owner's list", async () => {
    const a = await add(ali, { name: "Hide me", phone: "0300 5550071" });
    await removeOwnProspect(db, ali, a.id);
    const shown = async (who: Actor, status?: string) => (await db.prospect.findMany({ where: prospectWhere(who, { mineOnly: who === ali, hideDismissed: !status, status }) })).map((r) => r.id);
    expect(await shown(ali)).not.toContain(a.id);
    expect(await shown(mgr, "DISMISSED")).toContain(a.id);
    await expect(restore(db, ali, [a.id])).rejects.toThrow(/sales manager/);
    expect(await restore(db, mgr, [a.id])).toBe(1);
    expect((await db.prospect.findUniqueOrThrow({ where: { id: a.id } })).status).toBe("ASSIGNED");
    expect(await shown(ali)).toContain(a.id);
  });
  it("another organization's data is never matched", async () => {
    expect((await add(foreign, { phone: "0300 5550001" })).id).toBeTruthy();
  });
});

describe("a hand-added prospect uses the same Log contact flow", () => {
  it("Contacted keeps it a prospect; Not interested closes it", async () => {
    const a = await add(ali, { phone: "0300 5550040" });
    await logOutreach(db, ali, a.id, { outcome: "CONTACTED", note: "Called" });
    expect((await db.prospect.findUniqueOrThrow({ where: { id: a.id } })).status).toBe("CONTACTED");
    await expect(logOutreach(db, zara, a.id, { outcome: "CONTACTED" })).rejects.toBeInstanceOf(ProspectorError);
    await logOutreach(db, ali, a.id, { outcome: "NOT_INTERESTED" });
    expect((await db.prospect.findUniqueOrThrow({ where: { id: a.id } })).status).toBe("NOT_INTERESTED");
    await fails(add(ali, { phone: "0300 5550040" }), /closed as not interested/);
  });
  it("Interested creates one lead owned by the agent with the person, company, email, source and notes", async () => {
    const a = await add(ali, { name: "Dana Shop", phone: "0300 5550050", email: "dana@shop.pk", source: "OWN_CONTACT", note: "Met at expo, wants a website" });
    const r = await logOutreach(db, ali, a.id, { outcome: "INTERESTED", note: "Wants a quote", now: NOW });
    const lead = await db.lead.findUniqueOrThrow({ where: { id: r.leadId! }, include: { activities: true } });
    expect(lead).toMatchObject({ name: "Dana Shop", company: null, phone: "+923005550050", email: "dana@shop.pk", source: "Prospector: Own contact", assignedToId: ali.id });
    expect(lead.notes).toContain("Met at expo, wants a website");
    expect(lead.tags).toContain("own-contact");
    expect((await db.prospect.findUniqueOrThrow({ where: { id: a.id } })).status).toBe("SENT_TO_CRM");
    expect(await db.leadKey.count({ where: { leadId: lead.id } })).toBe(2);
    // the lead now blocks a second prospect with the same email
    await fails(add(zara, { phone: "", email: "dana@shop.pk" }), /already exists|already in Prospector|already a prospect/);
  });
  it("an email-only prospect converts, and the conversion is refused if the email went on the do-not-contact list meanwhile", async () => {
    const a = await add(ali, { phone: "", email: "late@x.pk" });
    await db.suppressedContact.create({ data: { organizationId: org, email: "LATE@x.pk" } });
    await fails(logOutreach(db, ali, a.id, { outcome: "INTERESTED" }), /do-not-contact/);
    expect(await db.lead.count({ where: { email: "late@x.pk" } })).toBe(0);
  });
});
