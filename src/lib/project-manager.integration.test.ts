import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { PM_ROLE, removeProjectMember, setProjectManager, setProjectMemberRole } from "./project-manager";

const url = process.env.TEST_DATABASE_URL ?? "postgresql://hifi:hifi_local_dev@localhost:54329/hifi_one_test";
const db = new PrismaClient({ datasourceUrl: url });
let org: string, other: string, owner: string, naghma: string, tahira: string, leaver: string, outsider: string, portal: string, project: string, closed: string;
const user = (o: string, name: string, extra: Record<string, unknown> = {}) =>
  db.user.create({ data: { organizationId: o, email: `${name.replace(/\W/g, "")}@pm.test`, name, passwordHash: "x", ...extra } }).then((u) => u.id);
const members = async (projectId: string) =>
  Object.fromEntries((await db.projectMember.findMany({ where: { projectId } })).map((m) => [m.userId, m.role]));

beforeAll(async () => {
  await db.$executeRawUnsafe('TRUNCATE "Notification","TimeEntry","Task","ProjectMember","Project","User","Client","Organization" CASCADE');
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

describe("removing someone from a project's team", () => {
  it("removes a member, unassigns only their open tasks, keeps logged time, and tells them", async () => {
    const p = (await db.project.create({ data: { organizationId: org, number: "PRJ-R1", name: "Team project", managerId: owner, members: { create: [{ userId: owner, role: PM_ROLE }, { userId: tahira, role: "Designer" }] } } })).id;
    const open = await db.task.create({ data: { projectId: p, title: "Open work", assigneeId: tahira } });
    const done = await db.task.create({ data: { projectId: p, title: "Finished work", assigneeId: tahira, status: "DONE" } });
    await db.timeEntry.create({ data: { organizationId: org, projectId: p, userId: tahira, workDate: "2026-11-18", hours: "2" } });
    const r = await removeProjectMember(db, { organizationId: org, projectId: p, userId: tahira, byUserId: owner });
    expect(r).toEqual({ ok: true, unassigned: 1 });
    expect(await members(p)).toEqual({ [owner]: PM_ROLE });
    expect((await db.task.findUniqueOrThrow({ where: { id: open.id } })).assigneeId).toBeNull();
    expect((await db.task.findUniqueOrThrow({ where: { id: done.id } })).assigneeId).toBe(tahira);
    expect(await db.timeEntry.count({ where: { projectId: p, userId: tahira } })).toBe(1);
    expect(await db.notification.count({ where: { userId: tahira, kind: "project.member_removed" } })).toBe(1);
  });

  it("refuses to remove the manager, someone not on the team, on a closed project or from another organization", async () => {
    const p = (await db.project.create({ data: { organizationId: org, number: "PRJ-R2", name: "Guarded", managerId: owner, members: { create: [{ userId: owner, role: PM_ROLE }, { userId: naghma }] } } })).id;
    expect(await removeProjectMember(db, { organizationId: org, projectId: p, userId: owner, byUserId: owner })).toMatchObject({ ok: false, error: expect.stringMatching(/new project manager first/) });
    expect(await removeProjectMember(db, { organizationId: org, projectId: p, userId: tahira, byUserId: owner })).toMatchObject({ ok: false, error: expect.stringMatching(/not on the team/) });
    expect(await removeProjectMember(db, { organizationId: other, projectId: p, userId: naghma, byUserId: owner })).toMatchObject({ ok: false, error: "Project not found" });
    await db.project.update({ where: { id: p }, data: { status: "CANCELLED" } });
    expect(await removeProjectMember(db, { organizationId: org, projectId: p, userId: naghma, byUserId: owner })).toMatchObject({ ok: false, error: expect.stringMatching(/closed/) });
    expect(Object.keys(await members(p)).sort()).toEqual([owner, naghma].sort());
  });

  it("changes or clears a member's role", async () => {
    const p = (await db.project.create({ data: { organizationId: org, number: "PRJ-R3", name: "Roles", managerId: owner, members: { create: [{ userId: owner, role: PM_ROLE }, { userId: naghma, role: "Writer" }] } } })).id;
    expect(await setProjectMemberRole(db, { organizationId: org, projectId: p, userId: naghma, role: "  Social media manager " })).toEqual({ ok: true, role: "Social media manager" });
    expect(await setProjectMemberRole(db, { organizationId: org, projectId: p, userId: naghma, role: "" })).toEqual({ ok: true, role: null });
    expect(await setProjectMemberRole(db, { organizationId: org, projectId: p, userId: tahira, role: "X" })).toMatchObject({ ok: false });
    expect(await setProjectMemberRole(db, { organizationId: other, projectId: p, userId: naghma, role: "X" })).toMatchObject({ ok: false, error: "Project not found" });
  });
});
