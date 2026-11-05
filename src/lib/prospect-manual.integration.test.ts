import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { addProspect } from "./prospect-manual";
import { logOutreach } from "./prospect-crm";
import { prospectWhere, ProspectorError, type Actor } from "./prospector";

const url = process.env.TEST_DATABASE_URL ?? "postgresql://hifi:hifi_local_dev@localhost:54329/hifi_one_test";
const db = new PrismaClient({ datasourceUrl: url });
let org: string, other: string, ali: Actor, zara: Actor, mgr: Actor, viewer: Actor, foreign: Actor;
const NOW = new Date("2026-11-05T10:00:00Z");
const actor = (id: string, organizationId: string, perms: string[]): Actor => ({ id, organizationId, permissions: new Set(perms) });
const add = (a: Actor, over: Record<string, unknown> = {}) => addProspect(db, a, { contactName: "Bilal Ahmed", company: "Ahmed Traders", phone: "0300 5550001", source: "REFERRAL", sourceDetail: "Sara from Gulberg", ...over }, NOW);
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
    const r = await add(ali, { email: "  Bilal@Ahmed.PK ", website: "ahmed.pk" });
    const p = await db.prospect.findUniqueOrThrow({ where: { id: r.id } });
    expect(p).toMatchObject({ origin: "MANUAL", status: "ASSIGNED", assignedToId: ali.id, addedById: ali.id, searchId: null, name: "Ahmed Traders", contactName: "Bilal Ahmed", phone: "+923005550001", email: "bilal@ahmed.pk", website: "https://ahmed.pk", sourceLabel: "REFERRAL", sourceDetail: "Sara from Gulberg" });
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
  it("needs edit access, a name or company, a source, and a phone or email", async () => {
    await fails(add(viewer), /permission/);
    await fails(add(ali, { contactName: "", company: "", phone: "0300 5550002" }), /name or the company/);
    await fails(add(ali, { source: "" }), /where this prospect came from/);
    await fails(add(ali, { phone: "", email: "" }), /phone number or an email/);
    await fails(add(ali, { phone: "abc" }), /phone number does not look right/);
    await fails(add(ali, { phone: "", email: "nope" }), /email address does not look right/);
    await fails(add(ali, { phone: "0300 5550003", website: "javascript:alert(1)" }), /website/);
  });
  it("refuses a number or email that is already a prospect, in any spelling, and does not reveal other people's prospects", async () => {
    await fails(add(ali, { phone: "+92 300 5550001" }), /Ahmed Traders is already in Prospector/);
    await fails(add(ali, { phone: "", email: "BILAL@ahmed.pk" }), /already in Prospector/);
    await fails(add(zara, { phone: "03005550001" }), /belongs to another team member/);
    expect(await db.prospect.count({ where: { phone: "+923005550001" } })).toBe(1);
  });
  it("two agents adding the same person at the same moment make one prospect", async () => {
    const results = await Promise.allSettled([add(ali, { phone: "0300 5550010" }), add(zara, { phone: "0300 5550010" })]);
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
    expect((await add(ali, { phone: "0300 5550030", confirm: true })).id).toBeTruthy();
    await db.crmSettings.update({ where: { organizationId: org }, data: { duplicateMode: "OFF" } });
    expect((await add(ali, { phone: "", email: "lead@x.pk" })).id).toBeTruthy();
    await db.crmSettings.update({ where: { organizationId: org }, data: { duplicateMode: "BLOCK" } });
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
    const a = await add(ali, { phone: "0300 5550050", email: "dana@shop.pk", contactName: "Dana", company: "Dana Shop", source: "OWN_CONTACT", sourceDetail: "Met at expo", notes: "Wants a website" });
    const r = await logOutreach(db, ali, a.id, { outcome: "INTERESTED", note: "Wants a quote", now: NOW });
    const lead = await db.lead.findUniqueOrThrow({ where: { id: r.leadId! }, include: { activities: true } });
    expect(lead).toMatchObject({ name: "Dana", company: "Dana Shop", phone: "+923005550050", email: "dana@shop.pk", source: "Prospector: Own contact", assignedToId: ali.id });
    expect(lead.notes).toContain("Met at expo");
    expect(lead.notes).toContain("Wants a website");
    expect(lead.tags).toContain("own-contact");
    expect((await db.prospect.findUniqueOrThrow({ where: { id: a.id } })).status).toBe("SENT_TO_CRM");
    expect(await db.leadKey.count({ where: { leadId: lead.id } })).toBe(2);
    // the lead now blocks a second prospect with the same email
    await fails(add(zara, { phone: "", email: "dana@shop.pk" }), /already exists|already in Prospector/);
  });
  it("an email-only prospect converts, and the conversion is refused if the email went on the do-not-contact list meanwhile", async () => {
    const a = await add(ali, { phone: "", email: "late@x.pk" });
    await db.suppressedContact.create({ data: { organizationId: org, email: "LATE@x.pk" } });
    await fails(logOutreach(db, ali, a.id, { outcome: "INTERESTED" }), /do-not-contact/);
    expect(await db.lead.count({ where: { email: "late@x.pk" } })).toBe(0);
  });
});
