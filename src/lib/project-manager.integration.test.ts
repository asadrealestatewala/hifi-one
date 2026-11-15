import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { PM_ROLE, setProjectManager } from "./project-manager";

const url = process.env.TEST_DATABASE_URL ?? "postgresql://hifi:hifi_local_dev@localhost:54329/hifi_one_test";
const db = new PrismaClient({ datasourceUrl: url });
let org: string, other: string, owner: string, naghma: string, tahira: string, leaver: string, outsider: string, portal: string, project: string, closed: string;
const user = (o: string, name: string, extra: Record<string, unknown> = {}) =>
  db.user.create({ data: { organizationId: o, email: `${name.replace(/\W/g, "")}@pm.test`, name, passwordHash: "x", ...extra } }).then((u) => u.id);
const members = async (projectId: string) =>
  Object.fromEntries((await db.projectMember.findMany({ where: { projectId } })).map((m) => [m.userId, m.role]));

beforeAll(async () => {
  await db.$executeRawUnsafe('TRUNCATE "Notification","ProjectMember","Project","User","Client","Organization" CASCADE');
  org = (await db.organization.create({ data: { name: "PM Org" } })).id;
  other = (await db.organization.create({ data: { name: "Other Org" } })).id;
  owner = await user(org, "Owner Account");
  naghma = await user(org, "Naghma Riaz");
  tahira = await user(org, "Tahira Siraj");
  leaver = await user(org, "Left Already", { active: false });
  outsider = await user(other, "Other Org Person");
  const client = await db.client.create({ data: { organizationId: org, name: "HB Elan" } });
  portal = await user(org, "Client Portal User", { userType: "CLIENT", clientId: client.id });
  project = (await db.project.create({ data: { organizationId: org, number: "PRJ-1", name: "HB Elan social media and ads", managerId: owner, members: { create: [{ userId: owner, role: "Project Manager" }] } } })).id;
  closed = (await db.project.create({ data: { organizationId: org, number: "PRJ-2", name: "Done", managerId: owner, status: "COMPLETED" } })).id;
});
afterAll(async () => { await db.$disconnect(); });

describe("changing a project's manager", () => {
  it("hands the project over, labels the new manager, keeps the old one on the team and tells the new one", async () => {
    const r = await setProjectManager(db, { organizationId: org, projectId: project, managerId: naghma, byUserId: owner });
    expect(r).toEqual({ ok: true, changed: true, fromId: owner, toId: naghma });
    expect((await db.project.findUniqueOrThrow({ where: { id: project } })).managerId).toBe(naghma);
    expect(await members(project)).toEqual({ [owner]: null, [naghma]: PM_ROLE });
    const inbox = await db.notification.findMany({ where: { userId: naghma } });
    expect(inbox.map((n) => n.kind)).toEqual(["project.manager_changed"]);
  });

  it("does nothing when the manager is already that person", async () => {
    const r = await setProjectManager(db, { organizationId: org, projectId: project, managerId: naghma, byUserId: owner });
    expect(r).toMatchObject({ ok: true, changed: false });
    expect(await db.notification.count({ where: { userId: naghma } })).toBe(1);
  });

  it("keeps a member's own role when they were not labelled manager, and does not notify someone who hands it to themselves", async () => {
    await db.projectMember.update({ where: { projectId_userId: { projectId: project, userId: naghma } }, data: { role: "Account lead" } });
    const r = await setProjectManager(db, { organizationId: org, projectId: project, managerId: tahira, byUserId: tahira });
    expect(r).toMatchObject({ ok: true, changed: true });
    expect(await members(project)).toEqual({ [owner]: null, [naghma]: "Account lead", [tahira]: PM_ROLE });
    expect(await db.notification.count({ where: { userId: tahira } })).toBe(0);
  });

  it("refuses inactive staff, client portal users, people from another organization and closed projects", async () => {
    for (const managerId of [leaver, portal, outsider, "missing"]) {
      expect(await setProjectManager(db, { organizationId: org, projectId: project, managerId, byUserId: owner })).toEqual({ ok: false, error: "Choose an active staff member" });
    }
    expect(await setProjectManager(db, { organizationId: org, projectId: closed, managerId: naghma, byUserId: owner })).toMatchObject({ ok: false });
    expect(await setProjectManager(db, { organizationId: other, projectId: project, managerId: outsider, byUserId: outsider })).toEqual({ ok: false, error: "Project not found" });
    expect((await db.project.findUniqueOrThrow({ where: { id: project } })).managerId).toBe(tahira);
    expect((await db.project.findUniqueOrThrow({ where: { id: closed } })).managerId).toBe(owner);
  });
});
