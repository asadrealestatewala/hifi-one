import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { DuplicateLeadError, backfillLeadKeys, claimLeadKeys, createLeadGuarded, leadKeys, presentDuplicate, savePolicy, scanLeadDuplicates } from "./lead-duplicates";
import { WorklistError, convertRow, importWorklist } from "./worklists";
import { captureLead, createSource } from "./lead-capture";
import { createContact, openOpportunityFor } from "./crm-contacts";

const url = process.env.TEST_DATABASE_URL ?? "postgresql://hifi:hifi_local_dev@localhost:54329/hifi_one_test";
const db = new PrismaClient({ datasourceUrl: url });
let org: string, stage: string, lost: string, ann: string, bob: string, source: string;

const add = (p: { email?: string | null; phone?: string | null; assignedToId?: string; stageId?: string; name?: string; confirm?: boolean }) =>
  createLeadGuarded(db, { organizationId: org, email: p.email, phone: p.phone, confirm: p.confirm }, (tx) =>
    tx.lead.create({ data: { organizationId: org, name: p.name ?? "Someone", email: p.email ?? null, phone: p.phone ?? null, stageId: p.stageId ?? stage, assignedToId: p.assignedToId ?? ann, createdById: p.assignedToId ?? ann } }));
const agent = (id: string) => ({ id, permissions: new Set(["crm.edit"]) as ReadonlySet<string> });
const manager = { id: "m", permissions: new Set(["crm.edit", "crm.view_all"]) as ReadonlySet<string> };

beforeAll(async () => {
  await db.$executeRawUnsafe('TRUNCATE "LeadKey","CrmSettings","WorklistRow","Worklist","SuppressedContact","Notification","LeadActivity","Lead","LeadSource","ContactActivity","Contact","PipelineStage","User","Organization" CASCADE');
  org = (await db.organization.create({ data: { name: "Dup Org" } })).id;
  stage = (await db.pipelineStage.create({ data: { organizationId: org, name: "New", sortOrder: 1 } })).id;
  lost = (await db.pipelineStage.create({ data: { organizationId: org, name: "Not interested", sortOrder: 9, isLost: true } })).id;
  const u = (name: string) => db.user.create({ data: { organizationId: org, email: `${name}@d.test`, name, passwordHash: "x" } }).then((x) => x.id);
  ann = await u("Ann"); bob = await u("Bob");
  source = (await createSource(db, { organizationId: org, name: "Web", assigneeIds: [ann] })).key;
});
afterAll(async () => { await db.$disconnect(); });

describe("normalising", () => {
  it("treats every way of writing the same number or email as one key", () => {
    const a = leadKeys({ phone: "0300 1234567" }, "PK").phone;
    expect(a).toBe("+923001234567");
    for (const v of ["+92 300 1234567", "0092-300-1234567", "92 300 1234567", "(0300) 123-4567"]) expect(leadKeys({ phone: v }, "PK").phone).toBe(a);
    expect(leadKeys({ email: "  Ann@Example.COM " }, "PK").email).toBe("ann@example.com");
    expect(leadKeys({ phone: "0300 1234567", country: "India" }, "PK").phone).not.toBe(a); // the lead's own country wins over the default
    expect(leadKeys({ email: "nope", phone: "12" }, "PK")).toMatchObject({ email: null, phone: null });
  });
});

describe("blocking (default)", () => {
  it("blocks the same phone typed differently, even when the first lead is Not interested, and the database holds the claim", async () => {
    const first = await add({ name: "Cold lead", phone: "0311 2223334", email: "Cold@X.com", stageId: lost });
    await expect(add({ phone: "+92 311 2223334", assignedToId: bob })).rejects.toBeInstanceOf(DuplicateLeadError);
    await expect(add({ email: "cold@x.com", assignedToId: bob })).rejects.toBeInstanceOf(DuplicateLeadError);
    expect(await db.lead.count({ where: { organizationId: org, name: "Someone" } })).toBe(0);
    expect(await db.leadKey.count({ where: { leadId: first.id } })).toBe(2);
    // the unique index refuses a second claim even if the application check were bypassed
    await expect(db.leadKey.create({ data: { organizationId: org, kind: "EMAIL", key: "cold@x.com", leadId: first.id } })).rejects.toThrow();
  });

  it("two agents saving the same person at the same instant create exactly one lead", async () => {
    const r = await Promise.allSettled([add({ email: "race@x.com", assignedToId: ann }), add({ email: "RACE@x.com", assignedToId: bob }), add({ email: "race@x.com", assignedToId: ann })]);
    expect(r.filter((x) => x.status === "fulfilled")).toHaveLength(1);
    expect(await db.lead.count({ where: { organizationId: org, email: { equals: "race@x.com", mode: "insensitive" } } })).toBe(1);
  });

  it("tells the owner's own agent and managers who owns it, and tells another agent nothing about it", async () => {
    await add({ name: "Zed", email: "zed@x.com", assignedToId: ann });
    const err = await add({ email: "zed@x.com", assignedToId: bob }).catch((e) => e as DuplicateLeadError);
    const m = (err as DuplicateLeadError).matches[0];
    const own = presentDuplicate(m, agent(ann)), mgr = presentDuplicate(m, manager), other = presentDuplicate(m, agent(bob));
    expect(own.text).toMatch(/Zed.*owned by Ann/); expect(own.href).toBe(`/leads/${m.leadId}`);
    expect(mgr.text).toMatch(/owned by Ann/);
    expect(other.href).toBeNull(); expect(other.text).not.toMatch(/Zed|Ann/);
    expect((err as DuplicateLeadError).message).not.toMatch(/Zed|Ann/);
  });

  it("allows leads with no phone or email, and different people", async () => {
    await add({ name: "No details" }); await add({ name: "No details 2" });
    await add({ phone: "0300 5550001" }); await add({ phone: "0300 5550002" });
  });
});

describe("modes", () => {
  it("warn needs a confirmation, off checks nothing, and block is the default again afterwards", async () => {
    await add({ email: "w@x.com" });
    await savePolicy(db, org, { mode: "WARN", defaultCountry: "PK" });
    const e = await add({ email: "w@x.com", assignedToId: bob }).catch((x) => x as DuplicateLeadError);
    expect(e).toBeInstanceOf(DuplicateLeadError); expect((e as DuplicateLeadError).canConfirm).toBe(true);
    const confirmed = await add({ email: "w@x.com", assignedToId: bob, confirm: true });
    expect(await db.leadKey.count({ where: { leadId: confirmed.id } })).toBe(0); // the older lead keeps the claim
    await savePolicy(db, org, { mode: "OFF", defaultCountry: "PK" });
    await add({ email: "w@x.com", assignedToId: bob });
    await savePolicy(db, org, { mode: "BLOCK", defaultCountry: "PK" });
    await expect(add({ email: "w@x.com" })).rejects.toBeInstanceOf(DuplicateLeadError);
    await expect(savePolicy(db, org, { mode: "NOPE" as never, defaultCountry: "PK" })).rejects.toThrow();
  });
});

describe("existing data", () => {
  it("reports old duplicates without deleting anything, and a backfill keeps the oldest lead's claim", async () => {
    await db.lead.create({ data: { organizationId: org, name: "Old A", email: "old@x.com", phone: "03009990000", stageId: stage, createdAt: new Date("2025-01-01") } });
    await db.lead.create({ data: { organizationId: org, name: "Old B", email: "OLD@x.com", phone: "+923009990000", stageId: lost, createdAt: new Date("2025-02-01") } });
    const before = await db.lead.count();
    const scan = await scanLeadDuplicates(db, org);
    const g = scan.groups.filter((x) => x.leads.some((l) => l.name === "Old A"));
    expect(g.map((x) => x.kind).sort()).toEqual(["EMAIL", "PHONE"]);
    expect(g[0].leads.map((l) => l.name)).toEqual(["Old A", "Old B"]);
    const r = await backfillLeadKeys(db, org);
    expect(r.leftUnclaimed).toBeGreaterThan(0);
    expect(await db.lead.count()).toBe(before);
    expect((await db.leadKey.findFirst({ where: { organizationId: org, key: "old@x.com" }, include: { lead: true } }))?.lead.name).toBe("Old A");
    expect((await backfillLeadKeys(db, org)).leads).toBe(before); // safe to repeat
    await expect(add({ phone: "0300 9990000", assignedToId: bob })).rejects.toBeInstanceOf(DuplicateLeadError);
  });
});

describe("every way in", () => {
  it("website forms add a note to the existing lead, whatever its status, and tell the visitor nothing", async () => {
    const cold = await add({ name: "Cold web", email: "coldweb@x.com", stageId: lost });
    const r = await captureLead(db, { key: source, origin: null, input: { name: "Cold Web", email: "ColdWeb@x.com", message: "back again" } });
    expect(r).toMatchObject({ ok: true, duplicate: true });
    expect(await db.lead.count({ where: { email: { equals: "coldweb@x.com", mode: "insensitive" } } })).toBe(1);
    expect(await db.leadActivity.count({ where: { leadId: cold.id, kind: "NOTE" } })).toBe(1);
    const fresh = await captureLead(db, { key: source, origin: null, input: { name: "Fresh", email: "fresh@x.com" } });
    expect(fresh.duplicate).toBe(false);
    expect(await db.leadKey.count({ where: { key: "fresh@x.com" } })).toBe(1);
  });

  it("converting a worklist row is refused for an existing lead and tells the viewer only what they may see", async () => {
    const lead = await add({ name: "Wl", phone: "0322 1110000", assignedToId: ann });
    const imp = await importWorklist(db, { organizationId: org, name: "List", csv: "Name,Phone\nWl again,+92 322 1110000\nNew person,0322 1110099\n", createdById: ann });
    expect(imp.duplicates).toBe(1);
    const rows = await db.worklistRow.findMany({ where: { worklistId: imp.worklistId }, orderBy: { rowNumber: "asc" } });
    expect(rows[0].duplicateLeadId).toBe(lead.id);
    const err = await convertRow(db, { organizationId: org, rowId: rows[0].id, actorId: bob, viewer: agent(bob) }).catch((e) => e);
    expect(err).toBeInstanceOf(WorklistError); expect(err.message).not.toMatch(/Wl|Ann/);
    const ok = await convertRow(db, { organizationId: org, rowId: rows[1].id, actorId: bob, viewer: agent(bob) });
    expect(ok.created).toBe(true);
    expect(await db.leadKey.count({ where: { leadId: ok.leadId } })).toBe(1);
  });

  it("a new contact opening a deal is checked, but a second deal for the same contact is allowed", async () => {
    await add({ name: "Has lead", email: "haslead@x.com" });
    await expect(createContact(db, { organizationId: org, actorId: bob, input: { kind: "PERSON", firstName: "Dup", lastName: "Person", emails: [{ type: "WORK", value: "haslead@x.com" }] }, opportunity: {}, confirmDuplicate: true })).rejects.toThrow(/already exists/);
    const c = await createContact(db, { organizationId: org, actorId: bob, input: { kind: "PERSON", firstName: "Deal", lastName: "Maker", emails: [{ type: "WORK", value: "dealmaker@x.com" }] }, opportunity: {} });
    await openOpportunityFor(db, { organizationId: org, contactId: c.id, actorId: bob, opp: {} });
    expect(await db.lead.count({ where: { contactId: c.id } })).toBe(2);
  });

  it("claims follow a lead's email when the lead is edited elsewhere", async () => {
    const l = await add({ email: "before@x.com" });
    await db.lead.update({ where: { id: l.id }, data: { email: "after@x.com" } });
    await db.$transaction((tx) => claimLeadKeys(tx, { leadId: l.id, organizationId: org, email: "after@x.com" }));
    expect(await db.leadKey.findMany({ where: { leadId: l.id } })).toMatchObject([{ key: "after@x.com" }]);
  });
});

