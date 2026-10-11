// Notifications, content approvals and prospecting worklists against hifi_one_test.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { ContentError, clientContent, createContent, editContent, transition } from "./content";
import { markAllRead, markRead, notify, notifyPermission, unreadCount, usersWithPermission } from "./notifications";
import { WorklistError, addSuppression, convertRow, importWorklist, setRowStatus, worklistMetrics } from "./worklists";

const url = process.env.TEST_DATABASE_URL ?? "postgresql://hifi:hifi_local_dev@localhost:54329/hifi_one_test";
const db = new PrismaClient({ datasourceUrl: url });

let org: string;
let author: string;
let reviewer: string;
let acmeUser: string;
let otherClientUser: string;
let acme: string;
let other: string;

beforeAll(async () => {
  await db.$executeRawUnsafe(
    'TRUNCATE "WorklistRow","Worklist","SuppressedContact","LeadActivity","Lead","PipelineStage","ContentEvent","ContentVersion","ContentItem","Notification","RolePermission","Permission","UserRole","Role","User","Client","NumberSequence","Organization" CASCADE',
  );
  org = (await db.organization.create({ data: { name: "Engagement Org" } })).id;
  const perm = await db.permission.create({ data: { key: "content.manage", description: "x" } });
  const role = await db.role.create({ data: { organizationId: org, key: "PM", name: "PM", permissions: { create: { permissionId: perm.id } } } });
  const mkUser = (email: string, extra: object = {}) => db.user.create({ data: { organizationId: org, email, name: email, passwordHash: "x", ...extra } });
  author = (await mkUser("author@x.example", { roles: { create: { roleId: role.id } } })).id;
  reviewer = (await mkUser("reviewer@x.example", { roles: { create: { roleId: role.id } } })).id;
  await mkUser("nobody@x.example");
  acme = (await db.client.create({ data: { organizationId: org, name: "Acme" } })).id;
  other = (await db.client.create({ data: { organizationId: org, name: "Other Co" } })).id;
  acmeUser = (await mkUser("pat@acme.example", { userType: "CLIENT", clientId: acme })).id;
  otherClientUser = (await mkUser("sam@other.example", { userType: "CLIENT", clientId: other })).id;
  await db.pipelineStage.create({ data: { organizationId: org, name: "New", sortOrder: 0 } });
});
afterAll(async () => {
  await db.$disconnect();
});

describe("notifications", () => {
  it("targets only users whose roles hold the permission, and can exclude the actor", async () => {
    expect((await usersWithPermission(db, org, "content.manage")).sort()).toEqual([author, reviewer].sort());
    expect(await usersWithPermission(db, org, "content.manage", author)).toEqual([reviewer]);
    expect(await usersWithPermission(db, org, "nothing.here")).toEqual([]);
  });
  it("a repeated event with the same dedupe key notifies once", async () => {
    await notify(db, reviewer, { kind: "t", title: "Hello", dedupeKey: "evt-1" });
    await notify(db, reviewer, { kind: "t", title: "Hello", dedupeKey: "evt-1" });
    await notifyPermission(db, org, "content.manage", { kind: "t", title: "Group", dedupeKey: "evt-2" });
    await notifyPermission(db, org, "content.manage", { kind: "t", title: "Group", dedupeKey: "evt-2" });
    expect(await unreadCount(db, reviewer)).toBe(2);
  });
  it("users can only mark their own notifications read", async () => {
    const n = await db.notification.findFirstOrThrow({ where: { userId: reviewer } });
    expect((await markRead(db, author, n.id)).count).toBe(0);
    expect((await markRead(db, reviewer, n.id)).count).toBe(1);
    expect(await unreadCount(db, reviewer)).toBe(1);
    await markAllRead(db, reviewer);
    expect(await unreadCount(db, reviewer)).toBe(0);
  });
});

describe("content approvals", () => {
  let id: string;
  const staff = (userId: string) => ({ id: userId, type: "STAFF" as const });
  const client = (userId: string, clientId: string) => ({ id: userId, type: "CLIENT" as const, clientId });

  it("walks Draft to Client Review, with internal review by someone other than the author", async () => {
    const item = await createContent(db, { organizationId: org, clientId: acme, platform: "INSTAGRAM", title: "Launch post", copy: "We launch!", createdById: author, assignedToId: reviewer });
    id = item.id;
    await transition(db, { organizationId: org, id, actor: staff(author), to: "INTERNAL_REVIEW" });
    await expect(transition(db, { organizationId: org, id, actor: staff(author), to: "CLIENT_REVIEW" })).rejects.toThrow(/other than the author/);
    await expect(transition(db, { organizationId: org, id, actor: staff(reviewer), to: "APPROVED" })).rejects.toThrow(/not allowed/);
    await transition(db, { organizationId: org, id, actor: staff(reviewer), to: "CLIENT_REVIEW" });
    const msgs = await db.notification.findMany({ where: { userId: acmeUser } });
    expect(msgs.map((m) => m.kind)).toEqual(["content.review"]);
    expect(await db.notification.count({ where: { userId: otherClientUser } })).toBe(0);
  });

  it("copy is locked while the client reviews it", async () => {
    await expect(editContent(db, { organizationId: org, id, copy: "Sneaky change" })).rejects.toThrow(/with the client/);
  });

  it("another client cannot see or act on the item; drafts are hidden from the portal", async () => {
    await expect(transition(db, { organizationId: org, id, actor: client(otherClientUser, other), to: "APPROVED" })).rejects.toThrow(/not found/);
    expect((await clientContent(db, other)).length).toBe(0);
    await createContent(db, { organizationId: org, clientId: acme, platform: "FACEBOOK", title: "Secret draft", copy: "internal", createdById: author });
    const titles = (await clientContent(db, acme)).map((c) => c.title);
    expect(titles).toEqual(["Launch post"]);
  });

  it("a rejection needs a reason, is attributed to the client user, and notifies staff", async () => {
    await expect(transition(db, { organizationId: org, id, actor: client(acmeUser, acme), to: "CHANGES_REQUESTED" })).rejects.toThrow(/reason/);
    await transition(db, { organizationId: org, id, actor: client(acmeUser, acme), to: "CHANGES_REQUESTED", comment: "Use our new logo" });
    const ev = await db.contentEvent.findFirstOrThrow({ where: { itemId: id, toStatus: "CHANGES_REQUESTED" } });
    expect(ev.actorId).toBe(acmeUser);
    expect(ev.actorType).toBe("CLIENT");
    expect(ev.comment).toBe("Use our new logo");
    const staffNotes = await db.notification.findMany({ where: { kind: "content.decision" } });
    expect(staffNotes.map((n) => n.userId).sort()).toEqual([author, reviewer].sort());
  });

  it("editing creates a new version; approval after review is final for the client", async () => {
    const edited = await editContent(db, { organizationId: org, id, copy: "We launch with our new logo!" });
    expect(edited.version).toBe(2);
    expect(await db.contentVersion.count({ where: { itemId: id } })).toBe(2);
    await transition(db, { organizationId: org, id, actor: staff(author), to: "INTERNAL_REVIEW" });
    await transition(db, { organizationId: org, id, actor: staff(reviewer), to: "CLIENT_REVIEW" });
    const approved = await transition(db, { organizationId: org, id, actor: client(acmeUser, acme), to: "APPROVED" });
    expect(approved.status).toBe("APPROVED");
    await expect(transition(db, { organizationId: org, id, actor: client(acmeUser, acme), to: "CHANGES_REQUESTED", comment: "late" })).rejects.toThrow(ContentError);
  });

  it("publishing needs scheduling first, and every status change is on the record", async () => {
    await expect(transition(db, { organizationId: org, id, actor: staff(author), to: "PUBLISHED" })).rejects.toThrow(/not allowed/);
    await transition(db, { organizationId: org, id, actor: staff(author), to: "SCHEDULED" });
    await transition(db, { organizationId: org, id, actor: staff(author), to: "PUBLISHED" });
    expect((await db.contentItem.findUniqueOrThrow({ where: { id } })).status).toBe("PUBLISHED");
    // every status change is on the record
    expect(await db.contentEvent.count({ where: { itemId: id } })).toBe(9); // created, review x2, client review x2, changes requested, approved, scheduled, published
  });
});

describe("prospecting worklists", () => {
  let worklistId: string;
  const csv = [
    "Name,Company,E-mail,Phone,Notes",
    "Amy Lee,Beta Ltd,amy@beta.example,+92 300 1111111,met at expo",
    "Bob Stone,Gamma,not-an-email,,bad email",
    ",,,,empty row of commas",
    "Cara Diaz,Delta,cara@delta.example,,",
    "Cara Again,Delta,CARA@delta.example,,duplicate of earlier row",
    "Dan Poe,Echo,dan@echo.example,+92 311 2222222,already a lead",
    "Eve Fox,Foxtrot,eve@fox.example,,suppressed",
    "Faye Ng,,,,no contact details",
  ].join("\n");

  it("imports valid rows, reports every skipped row with a reason, flags CRM duplicates and suppressed contacts", async () => {
    await db.lead.create({ data: { organizationId: org, name: "Dan (existing)", email: "dan@echo.example", stageId: (await db.pipelineStage.findFirstOrThrow()).id } });
    await addSuppression(db, { organizationId: org, email: "EVE@fox.example", reason: "Asked to stop" });
    const r = await importWorklist(db, { organizationId: org, name: "Expo list", source: "Trade expo", csv, createdById: author });
    worklistId = r.worklistId;
    expect(r.imported).toBe(4); // Amy, Cara, Dan, Eve
    expect(r.skipped.map((s) => s.row)).toEqual([3, 4, 6, 9]);
    expect(r.skipped.find((s) => s.row === 3)!.reason).toMatch(/Invalid email/);
    expect(r.skipped.find((s) => s.row === 6)!.reason).toMatch(/Duplicate of an earlier row/);
    expect(r.duplicates).toBe(1);
    expect(r.suppressed).toBe(1);
    expect(await db.lead.count()).toBe(1); // importing created no CRM leads
  });

  it("keeps the original columns, and both metrics separate: processed vs real leads", async () => {
    const amy = await db.worklistRow.findFirstOrThrow({ where: { worklistId, name: "Amy Lee" } });
    expect((amy.raw as Record<string, string>).Notes).toBe("met at expo");
    expect(await worklistMetrics(db, worklistId)).toMatchObject({ total: 4, processed: 0, leadsGenerated: 0, doNotContact: 1 });
    await setRowStatus(db, { organizationId: org, rowId: amy.id, status: "CONTACTED", note: "Called" });
    const cara = await db.worklistRow.findFirstOrThrow({ where: { worklistId, name: "Cara Diaz" } });
    await setRowStatus(db, { organizationId: org, rowId: cara.id, status: "NOT_INTERESTED" });
    expect(await worklistMetrics(db, worklistId)).toMatchObject({ processed: 2, leadsGenerated: 0 });
  });

  it("converting creates one real lead (even if retried at the same time) and counts as a lead generated", async () => {
    const amy = await db.worklistRow.findFirstOrThrow({ where: { worklistId, name: "Amy Lee" } });
    const results = await Promise.all([1, 2, 3].map(() => convertRow(db, { organizationId: org, rowId: amy.id, actorId: author })));
    expect(new Set(results.map((r) => r.leadId)).size).toBe(1);
    expect(results.filter((r) => r.created)).toHaveLength(1);
    expect(await db.lead.count({ where: { email: "amy@beta.example" } })).toBe(1);
    expect((await worklistMetrics(db, worklistId)).leadsGenerated).toBe(1);
    await expect(setRowStatus(db, { organizationId: org, rowId: amy.id, status: "NEW" })).rejects.toThrow(/already become a lead/);
  });

  it("blocks conversion of suppressed contacts and of contacts already in the CRM", async () => {
    const eve = await db.worklistRow.findFirstOrThrow({ where: { worklistId, name: "Eve Fox" } });
    await expect(convertRow(db, { organizationId: org, rowId: eve.id, actorId: author })).rejects.toThrow(/do-not-contact/);
    const dan = await db.worklistRow.findFirstOrThrow({ where: { worklistId, name: "Dan Poe" } });
    expect(dan.duplicateLeadId).not.toBeNull();
    await expect(convertRow(db, { organizationId: org, rowId: dan.id, actorId: author })).rejects.toThrow(/already in the CRM/);
  });

  it("suppressing a contact later stops outreach on rows already imported", async () => {
    const cara = await db.worklistRow.findFirstOrThrow({ where: { worklistId, name: "Cara Diaz" } });
    await db.worklistRow.update({ where: { id: cara.id }, data: { status: "CONTACTED" } });
    await addSuppression(db, { organizationId: org, email: "cara@delta.example" });
    expect((await db.worklistRow.findUniqueOrThrow({ where: { id: cara.id } })).status).toBe("DO_NOT_CONTACT");
    await expect(setRowStatus(db, { organizationId: org, rowId: cara.id, status: "CONTACTED" })).rejects.toThrow(WorklistError);
  });

  it("rejects files without a usable header or rows", async () => {
    await expect(importWorklist(db, { organizationId: org, name: "Bad", csv: "foo,bar\n1,2", createdById: author })).rejects.toThrow(/name or company/);
    await expect(importWorklist(db, { organizationId: org, name: "Empty", csv: "Name,Email", createdById: author })).rejects.toThrow(/header row/);
    await expect(importWorklist(db, { organizationId: org, name: "All bad", csv: "Name,Email\nX,nope", createdById: author })).rejects.toThrow(/No usable rows/);
  });
});
