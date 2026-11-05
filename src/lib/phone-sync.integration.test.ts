import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { canonicalPhone, isSuppressed } from "./lead-duplicates";
import { addSuppression, convertRow, importWorklist } from "./worklists";
import { captureLead, createSource } from "./lead-capture";

// The same person must be recognised however their number was typed, wherever it is entered: stored the same way on leads, and the
// do-not-contact list matches a local number against an international one and the other way round.
const url = process.env.TEST_DATABASE_URL ?? "postgresql://hifi:hifi_local_dev@localhost:54329/hifi_one_test";
const db = new PrismaClient({ datasourceUrl: url });
let org: string, other: string, ann: string, key: string;

beforeAll(async () => {
  await db.$executeRawUnsafe('TRUNCATE "LeadKey","CrmSettings","WorklistRow","Worklist","SuppressedContact","Notification","LeadActivity","Lead","LeadSource","ContactActivity","Contact","PipelineStage","UserRole","RolePermission","Permission","Role","User","Organization" CASCADE');
  org = (await db.organization.create({ data: { name: "Sync Org" } })).id;
  other = (await db.organization.create({ data: { name: "Other Org" } })).id;
  await db.pipelineStage.create({ data: { organizationId: org, name: "New", sortOrder: 1 } });
  ann = (await db.user.create({ data: { organizationId: org, email: "ann@s.test", name: "Ann", passwordHash: "x" } })).id;
  key = (await createSource(db, { organizationId: org, name: "Web", assigneeIds: [ann] })).key;
});
afterAll(async () => { await db.$disconnect(); });

describe("one way to store and compare phone numbers", () => {
  it("canonicalPhone reads a local number in the lead's country, else the organization's default", async () => {
    expect(await canonicalPhone(db, org, "0300 5551000")).toBe("+923005551000");
    expect(await canonicalPhone(db, org, "(020) 7946 0958", "GB")).toBe("+442079460958");
    expect(await canonicalPhone(db, org, "+971 50 555 1001", "PK")).toBe("+971505551001");
    expect(await canonicalPhone(db, org, "")).toBeNull();
  });
  it("a website form stores the phone in +international form", async () => {
    await captureLead(db, { key, origin: null, input: { name: "Web Person", phone: "0300-5551002" } });
    expect((await db.lead.findFirstOrThrow({ where: { organizationId: org, name: "Web Person" } })).phone).toBe("+923005551002");
  });
  it("the do-not-contact list matches local against international, either way round, and by email ignoring case", async () => {
    await addSuppression(db, { organizationId: org, phone: "0300 5551003" });
    await addSuppression(db, { organizationId: org, phone: "+92 300 5551004" });
    await addSuppression(db, { organizationId: org, email: "Stop@Later.pk" });
    expect((await db.suppressedContact.findMany({ where: { organizationId: org, phone: { not: null } }, orderBy: { phone: "asc" } })).map((s) => s.phone)).toEqual(["+923005551003", "+923005551004"]);
    expect(await isSuppressed(db, org, { phone: "+92 300 5551003" })).toBe(true);
    expect(await isSuppressed(db, org, { phone: "0300-5551004" })).toBe(true);
    expect(await isSuppressed(db, org, { email: "stop@later.PK" })).toBe(true);
    expect(await isSuppressed(db, org, { phone: "0300 5559999", email: "fine@x.pk" })).toBe(false);
    expect(await isSuppressed(db, other, { phone: "0300 5551003" })).toBe(false);
  });
  it("a worklist row typed one way is blocked by a do-not-contact number typed the other way, on import and on a later suppression", async () => {
    await addSuppression(db, { organizationId: org, phone: "+92 300 5551010" });
    const imp = await importWorklist(db, { organizationId: org, name: "Sync list", csv: "Name,Phone\nBlocked local,0300 5551010\nLater local,0300 5551011\nClean,0300 5551012\n", createdById: ann });
    expect(imp.imported).toBeGreaterThanOrEqual(3);
    const status = async (n: string) => (await db.worklistRow.findFirstOrThrow({ where: { name: n } })).status;
    expect(await status("Blocked local")).toBe("DO_NOT_CONTACT");
    expect(await status("Later local")).toBe("NEW");
    await addSuppression(db, { organizationId: org, phone: "+923005551011" });
    expect(await status("Later local")).toBe("DO_NOT_CONTACT");
    expect(await status("Clean")).toBe("NEW");
  });
  it("converting a worklist row stores the lead's phone in +international form", async () => {
    const row = await db.worklistRow.findFirstOrThrow({ where: { name: "Clean" } });
    const r = await convertRow(db, { organizationId: org, rowId: row.id, actorId: ann });
    expect((await db.lead.findUniqueOrThrow({ where: { id: r.leadId } })).phone).toBe("+923005551012");
  });
});
