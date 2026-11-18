import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import {
  RemovalError, archiveProject, clientDeleteBlockers, deleteClient, deleteProject, describeBlockers, nameMatches, projectDeleteBlockers, restoreProject, setClientActive,
} from "./record-removal";

const url = process.env.TEST_DATABASE_URL ?? "postgresql://hifi:hifi_local_dev@localhost:54329/hifi_one_test";
const db = new PrismaClient({ datasourceUrl: url });
let org: string, other: string, pm: string;

beforeAll(async () => {
  await db.$executeRawUnsafe('TRUNCATE "TaskComment","Task","Milestone","ProjectUpdate","ProjectMember","TimeEntry","Invoice","HashtagGroup","ClientInvite","Project","Client","User","Organization" CASCADE');
  org = (await db.organization.create({ data: { name: "Removal Org" } })).id;
  other = (await db.organization.create({ data: { name: "Other Org" } })).id;
  pm = (await db.user.create({ data: { organizationId: org, email: "pm@r.test", name: "PM", passwordHash: "x" } })).id;
});
afterAll(async () => { await db.$disconnect(); });

const mkProject = async (number: string, extra: object = {}) => (await db.project.create({ data: { organizationId: org, number, name: `Project ${number}`, managerId: pm, ...extra } })).id;

describe("deleting a test project", () => {
  it("removes a project with only tasks, comments, milestones, updates and members", async () => {
    const id = await mkProject("PRJ-T1", { members: { create: { userId: pm } } });
    const parent = await db.task.create({ data: { projectId: id, title: "Parent" } });
    await db.task.create({ data: { projectId: id, title: "Child", parentId: parent.id } });
    await db.taskComment.create({ data: { taskId: parent.id, authorId: pm, body: "hello" } });
    expect(await projectDeleteBlockers(db, id)).toEqual([]);
    const r = await deleteProject(db, org, id);
    expect(r.tasks).toBe(2);
    expect(await db.project.count({ where: { id } })).toBe(0);
    expect(await db.task.count({ where: { projectId: id } })).toBe(0);
    expect(await db.projectMember.count({ where: { projectId: id } })).toBe(0);
  });

  it("refuses when time was logged, and says what is in the way", async () => {
    const id = await mkProject("PRJ-T2");
    await db.timeEntry.create({ data: { organizationId: org, projectId: id, userId: pm, workDate: "2026-11-18", hours: "1.50" } });
    const b = await projectDeleteBlockers(db, id);
    expect(b).toEqual([{ label: "time logs", count: 1 }]);
    expect(describeBlockers(b)).toBe("1 time log");
    await expect(deleteProject(db, org, id)).rejects.toThrow(/1 time log.*Archive it instead/);
    expect(await db.project.count({ where: { id } })).toBe(1);
  });

  it("refuses when an invoice points at the project", async () => {
    const client = await db.client.create({ data: { organizationId: org, name: "Billed client" } });
    const id = await mkProject("PRJ-T3", { clientId: client.id });
    await db.invoice.create({ data: { organizationId: org, clientId: client.id, projectId: id, currency: "USD" } });
    await expect(deleteProject(db, org, id)).rejects.toBeInstanceOf(RemovalError);
  });

  it("cannot reach a project in another organization", async () => {
    const id = await mkProject("PRJ-T4");
    await expect(deleteProject(db, other, id)).rejects.toThrow("Project not found.");
    expect(await db.project.count({ where: { id } })).toBe(1);
  });
});

describe("archiving a project", () => {
  it("only archives a closed project, and restores it", async () => {
    const id = await mkProject("PRJ-A1");
    await expect(archiveProject(db, org, id, pm)).rejects.toThrow(/Completed or Cancelled/);
    await db.project.update({ where: { id }, data: { status: "CANCELLED" } });
    const a = await archiveProject(db, org, id, pm);
    expect(a.archivedAt).not.toBeNull();
    expect(a.archivedById).toBe(pm);
    await expect(archiveProject(db, org, id, pm)).rejects.toThrow(/already archived/);
    expect((await restoreProject(db, org, id)).archivedAt).toBeNull();
    await expect(restoreProject(db, other, id)).rejects.toThrow("Project not found.");
  });
});

describe("deleting a test client", () => {
  it("removes a client with only content settings and an unused invite", async () => {
    const c = await db.client.create({ data: { organizationId: org, name: "testt" } });
    await db.hashtagGroup.create({ data: { organizationId: org, clientId: c.id, name: "Tags", tags: "#a", createdById: pm } });
    expect(await clientDeleteBlockers(db, org, c.id)).toEqual([]);
    await deleteClient(db, org, c.id);
    expect(await db.client.count({ where: { id: c.id } })).toBe(0);
    expect(await db.hashtagGroup.count({ where: { clientId: c.id } })).toBe(0);
  });

  it("refuses while the client still has a project, then allows it once the project is gone", async () => {
    const c = await db.client.create({ data: { organizationId: org, name: "Umair Testing" } });
    const p = await mkProject("PRJ-C1", { clientId: c.id });
    await expect(deleteClient(db, org, c.id)).rejects.toThrow(/1 project.*Mark it inactive/);
    await deleteProject(db, org, p);
    await deleteClient(db, org, c.id);
    expect(await db.client.count({ where: { id: c.id } })).toBe(0);
  });

  it("refuses when the client has invoices, and other organizations cannot touch it", async () => {
    const c = await db.client.create({ data: { organizationId: org, name: "Real client" } });
    await db.invoice.create({ data: { organizationId: org, clientId: c.id, currency: "USD" } });
    await expect(deleteClient(db, org, c.id)).rejects.toThrow(/invoice/);
    await expect(deleteClient(db, other, c.id)).rejects.toThrow("Client not found.");
    await expect(setClientActive(db, other, c.id, false)).rejects.toThrow("Client not found.");
    expect((await setClientActive(db, org, c.id, false)).active).toBe(false);
  });
});

describe("typed confirmation", () => {
  it("needs the exact name, ignoring spaces at the ends", () => {
    expect(nameMatches("HB Elan ", "HB Elan")).toBe(true);
    expect(nameMatches("hb elan", "HB Elan")).toBe(false);
    expect(nameMatches(null, "HB Elan")).toBe(false);
  });
});
