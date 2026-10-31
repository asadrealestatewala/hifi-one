import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { CaptureError, captureLead, createSource, originAllowed, parseOrigins, rotateKey } from "./lead-capture";

const url = process.env.TEST_DATABASE_URL ?? "postgresql://hifi:hifi_local_dev@localhost:54329/hifi_one_test";
const db = new PrismaClient({ datasourceUrl: url });
let org: string, other: string, naghma: string, asad: string, gone: string, campaign: string;
let key: string, sourceId: string;
const inbox = (id: string) => db.notification.findMany({ where: { userId: id }, orderBy: { createdAt: "asc" } });

beforeAll(async () => {
  await db.$executeRawUnsafe('TRUNCATE "Notification","LeadActivity","Lead","LeadSource","Contact","Campaign","PipelineStage","User","Organization" CASCADE');
  org = (await db.organization.create({ data: { name: "Capture Org" } })).id;
  other = (await db.organization.create({ data: { name: "Other" } })).id;
  await db.pipelineStage.create({ data: { organizationId: org, name: "New", sortOrder: 1 } });
  await db.pipelineStage.create({ data: { organizationId: org, name: "Closed Lost", sortOrder: 9, isLost: true } });
  const u = (name: string, active = true) => db.user.create({ data: { organizationId: org, email: `${name}@c.test`, name, passwordHash: "x", active } }).then((x) => x.id);
  naghma = await u("naghma"); asad = await u("asad"); gone = await u("gone", false);
  campaign = (await db.campaign.create({ data: { organizationId: org, name: "Classwell" } })).id;
});
afterAll(async () => { await db.$disconnect(); });

describe("origins", () => {
  it("allows any website when none are listed, otherwise only the listed ones", () => {
    expect(parseOrigins("https://A.com/, https://www.a.com")).toEqual(["https://a.com", "https://www.a.com"]);
    expect(originAllowed([], null)).toBe(true);
    expect(originAllowed(["https://a.com"], "https://a.com/")).toBe(true);
    expect(originAllowed(["https://a.com"], "https://evil.com")).toBe(false);
    expect(originAllowed(["https://a.com"], null)).toBe(false);
  });
});

describe("website lead capture", () => {
  it("creates a source whose key is shown once and stored only as a hash", async () => {
    await expect(createSource(db, { organizationId: org, name: "x", assigneeIds: [naghma] })).rejects.toThrow(CaptureError);
    await expect(createSource(db, { organizationId: org, name: "Bad", assigneeIds: [] })).rejects.toThrow(/who receives/);
    await expect(createSource(db, { organizationId: org, name: "Bad", assigneeIds: [gone] })).rejects.toThrow(/active staff/);
    await expect(createSource(db, { organizationId: org, name: "Bad", assigneeIds: [naghma], allowedOrigins: "not a site" })).rejects.toThrow(/website address/);
    const made = await createSource(db, { organizationId: org, name: "Classwell website", campaignId: campaign, assigneeIds: [naghma, asad], allowedOrigins: "https://classwell.test" });
    key = made.key; sourceId = made.source.id;
    // a person who left after the form was set up must be skipped, not given leads
    await db.leadSource.update({ where: { id: sourceId }, data: { assigneeIds: [naghma, gone, asad] } });
    expect(key).toMatch(/^hlk_/);
    expect(made.source.keyHash).not.toContain(key);
    await expect(createSource(db, { organizationId: org, name: "Classwell website", assigneeIds: [naghma] })).rejects.toThrow(/already exists/);
  });

  it("creates a tagged lead, assigns it in turn, tells the assignee, and skips inactive staff", async () => {
    const send = (n: number) => captureLead(db, { key, origin: "https://classwell.test", input: { name: `Visitor ${n}`, email: `v${n}@mail.test`, message: "Need a demo", utm_source: "google", utm_medium: "cpc", utm_campaign: "spring", landing_url: "https://classwell.test/pricing" } });
    await send(1); await send(2); await send(3);
    const leads = await db.lead.findMany({ where: { organizationId: org }, orderBy: { createdAt: "asc" } });
    expect(leads.map((l) => l.assignedToId)).toEqual([naghma, asad, naghma]);
    expect(leads[0]).toMatchObject({ source: "Website: Classwell website", campaignId: campaign, leadSourceId: sourceId, utmSource: "google", utmMedium: "cpc", utmCampaign: "spring", landingUrl: "https://classwell.test/pricing", notes: "Need a demo" });
    expect(leads[0].contactId).not.toBeNull();
    expect((await inbox(naghma)).map((n) => n.kind)).toEqual(["lead.assigned", "lead.assigned"]);
    expect((await db.leadSource.findUniqueOrThrow({ where: { id: sourceId } })).leadCount).toBe(3);
  });

  it("adds a resubmission to the open lead instead of creating another", async () => {
    const before = await db.lead.count({ where: { organizationId: org } });
    const r = await captureLead(db, { key, origin: "https://classwell.test", input: { name: "Visitor 1 again", email: "V1@Mail.test", message: "Any news?" } });
    expect(r.duplicate).toBe(true);
    expect(await db.lead.count({ where: { organizationId: org } })).toBe(before);
    const lead = await db.lead.findFirstOrThrow({ where: { email: "v1@mail.test" }, include: { activities: true } });
    expect(lead.activities.map((a) => a.body).join("|")).toContain("again");
  });

  it("refuses unknown keys, other websites, bad details, and silently drops bot submissions", async () => {
    await expect(captureLead(db, { key: "nope", origin: null, input: {} })).rejects.toMatchObject({ status: 401 });
    await expect(captureLead(db, { key: "hlk_" + "a".repeat(32), origin: null, input: { email: "a@b.co" } })).rejects.toMatchObject({ status: 401 });
    await expect(captureLead(db, { key, origin: "https://evil.test", input: { name: "X", email: "x@y.co" } })).rejects.toMatchObject({ status: 403 });
    await expect(captureLead(db, { key, origin: "https://classwell.test", input: { name: "No contact" } })).rejects.toThrow(/email address or a phone/);
    await expect(captureLead(db, { key, origin: "https://classwell.test", input: { name: "Bad", email: "not-an-email" } })).rejects.toThrow(/valid email/);
    const before = await db.lead.count();
    const bot = await captureLead(db, { key, origin: "https://classwell.test", input: { name: "Bot", email: "bot@spam.co", website_url: "http://spam" } });
    expect(bot).toEqual({ ok: true, duplicate: false });
    expect(await db.lead.count()).toBe(before);
  });

  it("stops accepting after the form is switched off or its key is replaced, and caps long text", async () => {
    const newKey = await rotateKey(db, { organizationId: org, id: sourceId });
    await expect(captureLead(db, { key, origin: "https://classwell.test", input: { name: "Old key", email: "old@k.co" } })).rejects.toMatchObject({ status: 401 });
    await captureLead(db, { key: newKey, origin: "https://classwell.test", input: { name: "N".repeat(500), email: "long@k.co", message: "m".repeat(9000), landing_url: "javascript:alert(1)" } });
    const l = await db.lead.findFirstOrThrow({ where: { email: "long@k.co" } });
    expect(l.name.length).toBe(120);
    expect(l.notes?.length).toBe(2000);
    expect(l.landingUrl).toBeNull();
    await db.leadSource.update({ where: { id: sourceId }, data: { active: false } });
    await expect(captureLead(db, { key: newKey, origin: "https://classwell.test", input: { name: "Off", email: "off@k.co" } })).rejects.toMatchObject({ status: 401 });
    await expect(rotateKey(db, { organizationId: other, id: sourceId })).rejects.toThrow(/not found/i);
  });

  it("tells managers when nobody is assigned", async () => {
    const mgrRole = await db.permission.upsert({ where: { key: "crm.view_all" }, update: {}, create: { key: "crm.view_all", description: "x" } });
    const role = await db.role.create({ data: { organizationId: org, key: "MGR", name: "Manager" } });
    await db.rolePermission.create({ data: { roleId: role.id, permissionId: mgrRole.id } });
    const mgr = await db.user.create({ data: { organizationId: org, email: "mgr@c.test", name: "Mgr", passwordHash: "x", roles: { create: { roleId: role.id } } } });
    const s = await createSource(db, { organizationId: org, name: "Unassigned form", assignMode: "NONE" });
    await captureLead(db, { key: s.key, origin: null, input: { name: "Lone", phone: "+923001112233" } });
    expect((await inbox(mgr.id)).map((n) => n.kind)).toEqual(["lead.unassigned"]);
  });
});
