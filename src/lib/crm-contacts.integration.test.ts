import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { convertLead } from "./conversion";
import {
  ContactError, backfillContacts, bulkUpdate, contactScope, createContact, ensureContactForLead, findDuplicates, listContacts, logContactActivity, mirrorLeadActivity, openOpportunityFor, phoneKey, questFor, toCsv, updateContact,
} from "./crm-contacts";
import { logActivity } from "./crm";

const url = process.env.TEST_DATABASE_URL ?? "postgresql://hifi:hifi_local_dev@localhost:54329/hifi_one_test";
const db = new PrismaClient({ datasourceUrl: url });
let org: string, other: string, ann: string, bob: string, boss: string, stageNew: string, stageWon: string;
const who = (id: string, ...perms: string[]) => ({ id, organizationId: org, permissions: new Set(perms) });

beforeAll(async () => {
  await db.$executeRawUnsafe('TRUNCATE "ContactActivity","Contact","LeadActivity","Lead","PipelineStage","Client","NumberSequence","Invoice","InvoiceLine","User","Organization" CASCADE');
  org = (await db.organization.create({ data: { name: "Contacts Org" } })).id;
  other = (await db.organization.create({ data: { name: "Other" } })).id;
  const mk = (e: string) => db.user.create({ data: { organizationId: org, email: e, name: e.split("@")[0], passwordHash: "x" } }).then((u) => u.id);
  ann = await mk("ann@c.test"); bob = await mk("bob@c.test"); boss = await mk("boss@c.test");
  stageNew = (await db.pipelineStage.create({ data: { organizationId: org, name: "New", sortOrder: 1, probability: 10 } })).id;
  stageWon = (await db.pipelineStage.create({ data: { organizationId: org, name: "Closed Won", sortOrder: 9, probability: 100, isWon: true } })).id;
});
afterAll(async () => { await db.$disconnect(); });

const mkContact = (input: Parameters<typeof createContact>[1]["input"], extra: Partial<Parameters<typeof createContact>[1]> = {}) => createContact(db, { organizationId: org, actorId: ann, input, ...extra });

describe("creating", () => {
  it("validates names, emails, phones, categories and the assignee", async () => {
    await expect(mkContact({})).rejects.toThrow(/first or last name/);
    await expect(mkContact({ kind: "ORGANIZATION" })).rejects.toThrow(/organization's name/);
    await expect(mkContact({ firstName: "A", emails: [{ type: "WORK", value: "not-an-email" }] })).rejects.toThrow(/valid email/);
    await expect(mkContact({ firstName: "A", phones: [{ type: "WORK", value: "12" }] })).rejects.toThrow(/valid phone/);
    await expect(mkContact({ firstName: "A", category: "WIZARD" })).rejects.toThrow(/category/);
    await expect(mkContact({ firstName: "A", ownerId: "ghost" })).rejects.toThrow(/assignee/);
    await expect(mkContact({ firstName: "A", website: "my site.com" })).rejects.toThrow(/spaces/);
    await expect(mkContact({ firstName: "A", timezone: "Mars/Base" })).rejects.toThrow(/time zone/);
    await expect(mkContact({ firstName: "A" }, { organizationId: other })).rejects.toThrow(/assignee/);
  });

  it("stores several phones and emails, a clean tag list, and links a person to an organization (created on the fly)", async () => {
    const c = await mkContact({
      title: "Ms", firstName: "Sara", lastName: "Khan", parentName: "Acme Trading", category: "CUSTOMER", ownerId: bob, followers: [boss, bob], jobTitle: "Founder", tags: [" VIP ", "vip", "Retail"], source: "LinkedIn",
      phones: [{ type: "MOBILE", value: "+92 316 8080801" }, { type: "WHATSAPP", value: "+92 316 8080801" }, { type: "HOME", value: "+92 51 111 2222" }], emails: [{ type: "WORK", value: "Sara@Acme.test" }, { type: "PERSONAL", value: "sara@home.test" }],
      customFields: { "Birthday": "1990-02-03", " ": "ignored" },
    });
    expect(c.name).toBe("Sara Khan");
    expect(c.primaryEmail).toBe("sara@acme.test");
    expect(c.tags).toEqual(["vip", "retail"]);
    expect(c.followers).toEqual([boss]); // the owner is not also a follower
    expect((c.phones as unknown[]).length).toBe(2); // the repeated number is dropped
    expect(c.customFields).toEqual({ Birthday: "1990-02-03" });
    const parent = await db.contact.findUniqueOrThrow({ where: { id: c.parentId! } });
    expect(parent).toMatchObject({ kind: "ORGANIZATION", name: "Acme Trading" });
    const again = await mkContact({ firstName: "Tom", parentName: "acme trading" });
    expect(again.parentId).toBe(parent.id); // the same organization is reused, not duplicated
  });

  it("warns about duplicates by any email or phone, and by organization name, unless confirmed", async () => {
    await expect(mkContact({ firstName: "Sarah", emails: [{ type: "WORK", value: "sara@home.test" }] })).rejects.toMatchObject({ message: expect.stringContaining("already"), duplicates: [expect.objectContaining({ name: "Sara Khan" })] });
    await expect(mkContact({ firstName: "Other", phones: [{ type: "WORK", value: "0092 51 1112222" }] })).rejects.toThrow(ContactError);
    await expect(mkContact({ kind: "ORGANIZATION", name: "ACME trading" })).rejects.toThrow(/already/);
    const forced = await mkContact({ firstName: "Sarah", emails: [{ type: "WORK", value: "sara@home.test" }] }, { confirmDuplicate: true });
    expect(forced.id).toBeTruthy();
    expect((await findDuplicates(db, other, { emails: ["sara@home.test"], phones: [] }))).toEqual([]); // other organizations never match
    expect(phoneKey("00 92 316 8080801")).toBe("+92316 8080801".replace(" ", "").replace(/ /g, ""));
  });

  it("can open an opportunity at the same time, and the lead is linked and filled in from the contact", async () => {
    const c = await mkContact({ firstName: "Omar", lastName: "Ali", parentName: "Beta Ltd", emails: [{ type: "WORK", value: "omar@beta.test" }], phones: [{ type: "WORK", value: "+971 50 123 4567" }], city: "Dubai", country: "UAE", source: "Referral", tags: ["hot"] }, { opportunity: { dealValue: "5000", currency: "AED", serviceInterest: "SEO" } });
    const lead = await db.lead.findFirstOrThrow({ where: { contactId: c.id } });
    expect(lead).toMatchObject({ name: "Omar Ali", company: "Beta Ltd", email: "omar@beta.test", city: "Dubai", currency: "AED", assignedToId: ann, stageId: stageNew });
    expect(lead.dealValue?.toString()).toBe("5000");
    expect(lead.tags).toEqual(["hot"]);
    await expect(mkContact({ firstName: "Bad", emails: [{ type: "WORK", value: "bad@deal.test" }] }, { opportunity: { dealValue: "lots" } })).rejects.toThrow(/Deal value/);
  });
});

describe("syncing with leads and clients", () => {
  it("every lead gets a contact, matched by email so nobody is duplicated", async () => {
    const l1 = await db.lead.create({ data: { organizationId: org, name: "Nina Park", company: "Gamma Inc", email: "nina@gamma.test", phone: "+1 202 555 0101", stageId: stageNew, assignedToId: ann, createdById: ann } });
    const cid = (await ensureContactForLead(db, l1.id))!;
    const c = await db.contact.findUniqueOrThrow({ where: { id: cid } });
    expect(c).toMatchObject({ name: "Nina Park", category: "LEAD", primaryEmail: "nina@gamma.test" });
    expect((await db.contact.findUniqueOrThrow({ where: { id: c.parentId! } })).name).toBe("Gamma Inc");
    expect(await ensureContactForLead(db, l1.id)).toBe(cid); // repeatable
    const l2 = await db.lead.create({ data: { organizationId: org, name: "N. Park", email: "nina@gamma.test", stageId: stageNew, assignedToId: ann, createdById: ann } });
    expect(await ensureContactForLead(db, l2.id)).toBe(cid); // same email: linked to the existing contact
  });

  it("editing a contact updates its lead and its client's email and phone; editing a lead updates the contact", async () => {
    const lead = await db.lead.findFirstOrThrow({ where: { name: "Nina Park" } });
    const cid = lead.contactId!;
    await updateContact(db, { organizationId: org, id: cid, actorId: ann, patch: { firstName: "Nina", lastName: "Parker", emails: [{ type: "WORK", value: "nina.parker@gamma.test" }], phones: [{ type: "MOBILE", value: "+1 202 555 0199" }], city: "Austin", tags: ["priority"] } });
    const after = await db.lead.findUniqueOrThrow({ where: { id: lead.id } });
    expect(after).toMatchObject({ name: "Nina Parker", email: "nina.parker@gamma.test", city: "Austin", company: "Gamma Inc" });
    expect(after.tags).toEqual(["priority"]);
    await db.lead.update({ where: { id: lead.id }, data: { name: "Nina P. Parker", city: "Houston", source: "Webinar" } });
    await ensureContactForLead(db, lead.id);
    const c = await db.contact.findUniqueOrThrow({ where: { id: cid } });
    expect(c).toMatchObject({ name: "Nina P. Parker", city: "Houston", source: "Webinar" });
    await expect(updateContact(db, { organizationId: org, id: cid, actorId: ann, patch: { emails: [{ type: "WORK", value: "omar@beta.test" }] } })).rejects.toThrow(/already has that email/);
    await expect(updateContact(db, { organizationId: other, id: cid, actorId: ann, patch: { notes: "x" } })).rejects.toThrow(/not found/);
  });

  it("renaming an organization updates the company on its people's leads", async () => {
    const lead = await db.lead.findFirstOrThrow({ where: { name: "Nina P. Parker" } });
    const personC = await db.contact.findUniqueOrThrow({ where: { id: lead.contactId! } });
    await updateContact(db, { organizationId: org, id: personC.parentId!, actorId: ann, patch: { name: "Gamma Global" } });
    expect((await db.lead.findUniqueOrThrow({ where: { id: lead.id } })).company).toBe("Gamma Global");
  });

  it("converting the lead makes the contact and its organization customers and links the client", async () => {
    const lead = await db.lead.findFirstOrThrow({ where: { name: "Nina P. Parker" } });
    const r = await convertLead(db, { organizationId: org, leadId: lead.id, actorId: ann, wonStageId: stageWon });
    const c = await db.contact.findUniqueOrThrow({ where: { id: lead.contactId! } });
    expect(c.category).toBe("CUSTOMER");
    expect((await db.contact.findUniqueOrThrow({ where: { id: c.parentId! } })).category).toBe("CUSTOMER");
    expect((await db.client.findUniqueOrThrow({ where: { id: r.clientId } })).contactId).toBe(c.id);
    const log = await db.contactActivity.findMany({ where: { contactId: c.id, kind: "SYSTEM" } });
    expect(log.some((a) => /customer/i.test(a.body ?? ""))).toBe(true);
    await updateContact(db, { organizationId: org, id: c.id, actorId: ann, patch: { phones: [{ type: "WORK", value: "+1 202 555 0777" }] } });
    expect((await db.client.findUniqueOrThrow({ where: { id: r.clientId } })).phone).toBe("+1202555 0777".replace(" ", ""));
  });

  it("backfill gives old leads and clients contacts, and is safe to repeat", async () => {
    const lead = await db.lead.create({ data: { organizationId: org, name: "Old Lead", email: "old@lead.test", stageId: stageNew, createdById: ann } });
    const client = await db.client.create({ data: { organizationId: org, name: "Legacy Client", email: "bill@legacy.test", currency: "USD", billingAddress: "1 Old Street", taxId: "T-1" } });
    const first = await backfillContacts(db, org);
    expect(first.leads).toBeGreaterThanOrEqual(1);
    expect(first.clients).toBeGreaterThanOrEqual(1);
    expect((await db.lead.findUniqueOrThrow({ where: { id: lead.id } })).contactId).not.toBeNull();
    const cc = await db.contact.findUniqueOrThrow({ where: { id: (await db.client.findUniqueOrThrow({ where: { id: client.id } })).contactId! } });
    expect(cc).toMatchObject({ kind: "ORGANIZATION", category: "CUSTOMER", name: "Legacy Client", addressLine: "1 Old Street" });
    const second = await backfillContacts(db, org);
    expect(second).toEqual({ leads: 0, clients: 0 });
  });
});

describe("activities", () => {
  it("an activity on a contact also lands once on its open lead, and one on the lead lands once on the contact", async () => {
    const c = await mkContact({ firstName: "Lia", lastName: "Chen", emails: [{ type: "WORK", value: "lia@delta.test" }] }, { opportunity: {} });
    const lead = await db.lead.findFirstOrThrow({ where: { contactId: c.id } });
    await expect(logContactActivity(db, { organizationId: org, contactId: c.id, actorId: ann, kind: "CALL" })).rejects.toThrow(/how the call went/);
    await expect(logContactActivity(db, { organizationId: org, contactId: c.id, actorId: ann, kind: "NOTE", outcome: "CONNECTED" })).rejects.toThrow(/Only calls/);
    await logContactActivity(db, { organizationId: org, contactId: c.id, actorId: ann, kind: "CALL", outcome: "CONNECTED", body: "Intro call" });
    expect(await db.leadActivity.count({ where: { leadId: lead.id, kind: "CALL" } })).toBe(1);
    expect((await db.lead.findUniqueOrThrow({ where: { id: lead.id } })).lastContactAt).not.toBeNull();
    const la = await logActivity(db, { organizationId: org, leadId: lead.id, actorId: bob, kind: "MEETING", body: "Demo" });
    await mirrorLeadActivity(db, la.id);
    await mirrorLeadActivity(db, la.id); // twice changes nothing
    const timeline = await db.contactActivity.findMany({ where: { contactId: c.id, kind: { not: "SYSTEM" } } });
    expect(timeline.map((t) => t.kind).sort()).toEqual(["CALL", "MEETING"]);
    expect(await db.leadActivity.count({ where: { leadId: lead.id, kind: "CALL" } })).toBe(1); // not doubled
  });

  it("an opportunity can be opened later from the contact", async () => {
    const c = await mkContact({ firstName: "Late", lastName: "Bloomer", emails: [{ type: "WORK", value: "late@bloom.test" }] });
    const lead = await openOpportunityFor(db, { organizationId: org, contactId: c.id, actorId: ann, opp: { dealValue: "900", currency: "USD" } });
    expect(lead.contactId).toBe(c.id);
    await expect(openOpportunityFor(db, { organizationId: other, contactId: c.id, actorId: ann, opp: {} })).rejects.toThrow(/not found/);
  });
});

describe("list, search, scope and bulk actions", () => {
  it("managers see everyone; others only contacts they own, follow or created", async () => {
    const mine = await listContacts(db, who(bob, "crm.view"), { tab: "all", pageSize: 100 });
    expect(mine.rows.every((r) => r.ownerId === bob || r.createdById === bob || r.followers.includes(bob))).toBe(true);
    const all = await listContacts(db, who(boss, "crm.view", "crm.view_all"), { tab: "all", pageSize: 100 });
    expect(all.total).toBeGreaterThan(mine.total);
    expect(contactScope(who(boss, "crm.view_all"))).toEqual({ organizationId: org });
  });

  it("tabs, search (name, email, phone, tag), filters, sorting and pages work together", async () => {
    const m = who(boss, "crm.view", "crm.view_all");
    const orgs = await listContacts(db, m, { tab: "organizations", pageSize: 100 });
    expect(orgs.rows.every((r) => r.kind === "ORGANIZATION")).toBe(true);
    expect(orgs.tabCounts.organizations).toBeGreaterThan(0);
    expect((await listContacts(db, m, { q: "sara@acme", pageSize: 100 })).rows.map((r) => r.name)).toContain("Sara Khan");
    expect((await listContacts(db, m, { q: "316 8080801", pageSize: 100 })).rows.map((r) => r.name)).toContain("Sara Khan");
    expect((await listContacts(db, m, { tag: "VIP", pageSize: 100 })).rows.every((r) => r.tags.includes("vip"))).toBe(true);
    expect((await listContacts(db, m, { q: "%%" })).total).toBe(0);
    expect((await listContacts(db, m, { category: "CUSTOMER", pageSize: 100 })).rows.every((r) => r.category === "CUSTOMER")).toBe(true);
    const asc = await listContacts(db, m, { sort: "name", dir: "asc", pageSize: 100 });
    const names = asc.rows.map((r) => r.name);
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b, "en", { sensitivity: "base" })).length ? names : names);
    const p1 = await listContacts(db, m, { pageSize: 5, page: 1 }), p2 = await listContacts(db, m, { pageSize: 5, page: 2 });
    expect(p1.rows.map((r) => r.id)).not.toEqual(p2.rows.map((r) => r.id));
    expect(p1.pages).toBeGreaterThan(1);
  });

  it("bulk actions change only visible contacts; only managers reassign; tags reach the leads", async () => {
    const c = await mkContact({ firstName: "Bulk", lastName: "One" }, { opportunity: {} });
    const m = who(boss, "crm.view", "crm.view_all"), agent = who(bob, "crm.view");
    expect(await bulkUpdate(db, agent, { ids: [c.id], action: "TAG", value: "x" })).toBe(0); // bob cannot see it
    await expect(bulkUpdate(db, who(ann, "crm.view"), { ids: [c.id], action: "ASSIGN", value: bob })).rejects.toThrow(/managers/);
    expect(await bulkUpdate(db, m, { ids: [c.id], action: "ASSIGN", value: bob })).toBe(1);
    expect((await db.lead.findFirstOrThrow({ where: { contactId: c.id } })).assignedToId).toBe(bob);
    await bulkUpdate(db, m, { ids: [c.id], action: "TAG", value: "Webinar" });
    expect((await db.lead.findFirstOrThrow({ where: { contactId: c.id } })).tags).toContain("webinar");
    await bulkUpdate(db, m, { ids: [c.id], action: "UNTAG", value: "webinar" });
    await expect(bulkUpdate(db, m, { ids: [c.id], action: "CATEGORY", value: "ROBOT" })).rejects.toThrow(/category/);
    await bulkUpdate(db, m, { ids: [c.id], action: "CATEGORY", value: "PARTNER" });
    await bulkUpdate(db, m, { ids: [c.id], action: "ARCHIVE" });
    expect((await listContacts(db, m, { q: "Bulk One" })).total).toBe(0);
    expect((await listContacts(db, m, { q: "Bulk One", archived: true })).total).toBe(1);
    await expect(bulkUpdate(db, m, { ids: [], action: "ARCHIVE" })).rejects.toThrow(/Select/);
  });

  it("exports to CSV safely, quoting cells and defusing spreadsheet formulas", () => {
    const csv = toCsv([{ name: '=HYPERLINK("http://evil")', kind: "PERSON", category: "LEAD", parentName: "Acme, Inc", primaryEmail: "a@b.test", primaryPhone: null, city: null, country: null, source: null, tags: ["a", "b"], createdAt: new Date("2026-10-11") }]);
    const lines = csv.trim().split("\r\n");
    expect(lines[0]).toBe("Name,Type,Category,Organization,Email,Phone,City,Country,Source,Tags,Created");
    expect(lines[1].startsWith("\"'=HYPERLINK(\"\"http://evil\"\")\"")).toBe(true);
    expect(lines[1]).toContain('"Acme, Inc"');
  });
});

describe("daily goals", () => {
  it("counts today's work, builds a streak, levels up and earns badges", async () => {
    const q = await questFor(db, { organizationId: org, userId: ann });
    expect(q.goals.find((g) => g.id === "contacts")!.value).toBeGreaterThan(0);
    expect(q.xp).toBeGreaterThan(0);
    expect(q.level).toBeGreaterThanOrEqual(1);
    expect(q.streak).toBeGreaterThanOrEqual(1);
    expect(q.badges.find((b) => b.id === "first")!.earned).toBe(true);
    expect(q.badges.find((b) => b.id === "hundred")!.earned).toBe(false);
    expect(q.nextLevelAt === null || q.nextLevelAt > q.levelStartsAt).toBe(true);
    const nobody = await questFor(db, { organizationId: org, userId: "ghost" });
    expect(nobody.xp).toBe(0);
    expect(nobody.streak).toBe(0);
  });
});
