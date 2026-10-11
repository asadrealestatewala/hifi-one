import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { ContactError, contactEmailHistory, createContact, ensureContactForLead, findDuplicates, mergeContacts, previewMerge } from "./crm-contacts";

const url = process.env.TEST_DATABASE_URL ?? "postgresql://hifi:hifi_local_dev@localhost:54329/hifi_one_test";
const db = new PrismaClient({ datasourceUrl: url });
let org: string, ann: string, stage: string;

beforeAll(async () => {
  await db.$executeRawUnsafe('TRUNCATE "ContactActivity","Contact","LeadActivity","Lead","PipelineStage","Client","NumberSequence","EmailMessage","User","Organization" CASCADE');
  org = (await db.organization.create({ data: { name: "Merge Org" } })).id;
  ann = (await db.user.create({ data: { organizationId: org, email: "ann@m.test", name: "Ann", passwordHash: "x" } })).id;
  stage = (await db.pipelineStage.create({ data: { organizationId: org, name: "New", sortOrder: 1, probability: 10 } })).id;
});
afterAll(async () => { await db.$disconnect(); });

const mk = (input: Parameters<typeof createContact>[1]["input"]) => createContact(db, { organizationId: org, actorId: ann, input, confirmDuplicate: true });

describe("merging contacts", () => {
  it("moves leads, timeline, tags, phones and emails, fills blanks, and archives the duplicate", async () => {
    const keep = await mk({ firstName: "Sara", lastName: "Khan", emails: [{ type: "WORK", value: "sara@a.test" }], tags: ["vip"], city: "Lahore" });
    const dupe = await mk({ firstName: "S.", lastName: "Khan", emails: [{ type: "WORK", value: "sara@a.test" }, { type: "PERSONAL", value: "sara@home.test" }], phones: [{ type: "MOBILE", value: "+92 316 8080801" }], tags: ["retail", "vip"], city: "Karachi", jobTitle: "Founder", notes: "Met at expo" });
    const lead = await db.lead.create({ data: { organizationId: org, name: "S. Khan", email: "sara@home.test", stageId: stage, contactId: dupe.id } });
    await db.contactActivity.create({ data: { contactId: dupe.id, kind: "NOTE", body: "called" } });

    const prev = await previewMerge(db, { organizationId: org, intoId: keep.id, fromId: dupe.id });
    expect(prev.moves).toMatchObject({ leads: 1, activities: 2, emails: 1, phones: 1, tags: 1, client: false });

    const merged = await mergeContacts(db, { organizationId: org, actorId: ann, intoId: keep.id, fromId: dupe.id });
    expect((merged.emails as { value: string }[]).map((e) => e.value)).toEqual(["sara@a.test", "sara@home.test"]);
    expect(merged.tags.sort()).toEqual(["retail", "vip"]);
    expect(merged.city).toBe("Lahore"); // the kept record wins
    expect(merged.jobTitle).toBe("Founder"); // blanks are filled
    expect(merged.notes).toContain("Met at expo");
    expect(merged.matchKeys).toContain("+923168080801");

    expect((await db.lead.findUniqueOrThrow({ where: { id: lead.id } })).contactId).toBe(keep.id);
    expect(await db.contactActivity.count({ where: { contactId: keep.id, body: "called" } })).toBe(1);
    const old = await db.contact.findUniqueOrThrow({ where: { id: dupe.id } });
    expect(old).toMatchObject({ archived: true, matchKeys: [], primaryEmail: null });
    // The archived duplicate no longer triggers duplicate warnings
    expect(await findDuplicates(db, org, { emails: ["sara@home.test"], phones: [] })).toEqual([expect.objectContaining({ id: keep.id })]);
  });

  it("moves an organization's people and its client link", async () => {
    const keep = await mk({ kind: "ORGANIZATION", name: "Acme Ltd" });
    const dupe = await mk({ kind: "ORGANIZATION", name: "Acme Limited" });
    const person = await mk({ firstName: "Tom", parentId: dupe.id });
    const client = await db.client.create({ data: { organizationId: org, name: "Acme Limited", contactId: dupe.id } });
    await mergeContacts(db, { organizationId: org, actorId: ann, intoId: keep.id, fromId: dupe.id });
    expect((await db.contact.findUniqueOrThrow({ where: { id: person.id } })).parentId).toBe(keep.id);
    expect((await db.client.findUniqueOrThrow({ where: { id: client.id } })).contactId).toBe(keep.id);
  });

  it("refuses unsafe merges", async () => {
    const a = await mk({ kind: "ORGANIZATION", name: "Alpha" }), b = await mk({ kind: "ORGANIZATION", name: "Beta" }), p = await mk({ firstName: "Pat" });
    await expect(mergeContacts(db, { organizationId: org, actorId: ann, intoId: a.id, fromId: a.id })).rejects.toThrow(/different/);
    await expect(mergeContacts(db, { organizationId: org, actorId: ann, intoId: a.id, fromId: p.id })).rejects.toThrow(/person can only/);
    await db.client.create({ data: { organizationId: org, name: "Alpha client", contactId: a.id } });
    await db.client.create({ data: { organizationId: org, name: "Beta client", contactId: b.id } });
    await expect(mergeContacts(db, { organizationId: org, actorId: ann, intoId: a.id, fromId: b.id })).rejects.toThrow(/client account/);
    await expect(mergeContacts(db, { organizationId: org, actorId: ann, intoId: a.id, fromId: "ghost" })).rejects.toThrow(ContactError);
    // other organizations' contacts are not reachable
    const o2 = (await db.organization.create({ data: { name: "Other" } })).id;
    await expect(mergeContacts(db, { organizationId: o2, actorId: ann, intoId: a.id, fromId: b.id })).rejects.toThrow(/not found/);
  });

  it("works with a lead-created contact and keeps invoice emails out of the contact's email history unless finance access", async () => {
    const lead = await db.lead.create({ data: { organizationId: org, name: "Zed", email: "zed@z.test", stageId: stage } });
    const c = await ensureContactForLead(db, lead.id);
    await db.emailMessage.createMany({ data: [
      { organizationId: org, toEmail: "zed@z.test", subject: "Hi", body: "x", status: "SENT", relatedType: "CONTACT", relatedId: c! },
      { organizationId: org, toEmail: "zed@z.test", subject: "Invoice INV-1 for 5,000", body: "x", status: "SENT", relatedType: "INVOICE", relatedId: "i1" },
      { organizationId: org, toEmail: "someone@else.test", subject: "No", body: "x", status: "SENT" },
    ] });
    expect((await contactEmailHistory(db, org, c!, ["zed@z.test"], false)).map((m) => m.subject)).toEqual(["Hi"]);
    expect((await contactEmailHistory(db, org, c!, ["zed@z.test"], true)).map((m) => m.subject).sort()).toEqual(["Hi", "Invoice INV-1 for 5,000"]);
    expect(c).toBeTruthy();
  });
});
