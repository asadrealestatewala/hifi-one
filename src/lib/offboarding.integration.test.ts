// Offboarding against hifi_one_test: a leaver's open projects and tasks move to a successor in one step; closed projects and
// finished work keep their name; an active person's work can't be moved.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { handOverWork, workHeldBy } from "./offboarding";

const url = process.env.TEST_DATABASE_URL ?? "postgresql://hifi:hifi_local_dev@localhost:54329/hifi_one_test";
const db = new PrismaClient({ datasourceUrl: url });
let org: string, other: string, hr: string, leaver: string, next: string, boss: string, gone: string, stranger: string;
const mkUser = (o: string, name: string, active = true) => db.user.create({ data: { organizationId: o, email: `${name}@off.test`, name, passwordHash: "x", userType: "EMPLOYEE", active } }).then((u) => u.id);
let n = 0;
const project = (managerId: string, members: { userId: string; role?: string }[], status = "ACTIVE") =>
  db.project.create({ data: { organizationId: org, number: `OF-${++n}`, name: `Project ${n}`, managerId, status, members: { create: members } } }).then((x) => x.id);
const task = (projectId: string, assigneeId: string | null, status = "TODO", title = "t") => db.task.create({ data: { projectId, assigneeId, status, title } }).then((t) => t.id);

beforeAll(async () => {
  await db.$executeRawUnsafe('TRUNCATE "Notification","TimeEntry","TaskChecklistItem","Task","ProjectMember","Project","User","Organization" CASCADE');
  org = (await db.organization.create({ data: { name: "Off Org" } })).id;
  other = (await db.organization.create({ data: { name: "Other" } })).id;
  hr = await mkUser(org, "hr"); next = await mkUser(org, "next"); boss = await mkUser(org, "boss"); gone = await mkUser(org, "gone", false); stranger = await mkUser(other, "stranger");
});
beforeEach(async () => {
  await db.notification.deleteMany(); await db.task.deleteMany(); await db.project.deleteMany();
  await db.user.deleteMany({ where: { email: "leaver@off.test" } });
  leaver = await mkUser(org, "leaver");
});
afterAll(async () => { await db.$disconnect(); });

describe("offboarding hand-over", () => {
  it("refuses while the person is still active, and needs an active successor from the organization", async () => {
    const pr = await project(leaver, [{ userId: leaver, role: "Project manager" }]);
    await task(pr, leaver);
    expect(await handOverWork(db, { organizationId: org, userId: leaver, byUserId: hr, mode: "reassign", toUserId: next })).toMatchObject({ ok: false, error: expect.stringMatching(/still active/) });
    await db.user.update({ where: { id: leaver }, data: { active: false } });
    expect(await handOverWork(db, { organizationId: org, userId: leaver, byUserId: hr, mode: "reassign", toUserId: gone })).toMatchObject({ ok: false, error: expect.stringMatching(/active staff/) });
    expect(await handOverWork(db, { organizationId: org, userId: leaver, byUserId: hr, mode: "reassign", toUserId: stranger })).toMatchObject({ ok: false });
    expect(await handOverWork(db, { organizationId: org, userId: leaver, byUserId: hr, mode: "unassign" })).toEqual({ ok: false, error: "Choose who takes over." }); // they manage a project
    expect(await handOverWork(db, { organizationId: other, userId: leaver, byUserId: stranger, mode: "reassign", toUserId: stranger })).toEqual({ ok: false, error: "Staff member not found." });
    expect((await db.project.findUniqueOrThrow({ where: { id: pr } })).managerId).toBe(leaver); // nothing moved
  });

  it("hands over managed projects and open tasks, leaves closed projects and finished work alone, and tells people once", async () => {
    const managed = await project(leaver, [{ userId: leaver, role: "Project manager" }, { userId: boss }]);
    const member = await project(boss, [{ userId: boss, role: "Project manager" }, { userId: leaver, role: "Designer" }]);
    const strayTasks = await project(boss, [{ userId: boss }]); // tasks assigned to them on a team they aren't on
    const closed = await project(leaver, [{ userId: leaver }], "COMPLETED");
    const a = await task(managed, leaver), b = await task(member, leaver), c = await task(member, leaver, "DONE", "finished"), d = await task(strayTasks, leaver), e = await task(closed, leaver);
    const held = await workHeldBy(db, { organizationId: org, userId: leaver });
    expect(held.projects.map((x) => [x.id, x.manages, x.openTasks])).toEqual(expect.arrayContaining([[managed, true, 1], [member, false, 1], [strayTasks, false, 1]]));
    expect(held.projects.some((x) => x.id === closed)).toBe(false);
    await db.user.update({ where: { id: leaver }, data: { active: false } });

    const r = await handOverWork(db, { organizationId: org, userId: leaver, byUserId: hr, mode: "reassign", toUserId: next });
    expect(r).toMatchObject({ ok: true, managed: [managed], reassigned: 3, unassigned: 0, errors: [] });
    expect((await db.project.findUniqueOrThrow({ where: { id: managed } })).managerId).toBe(next);
    for (const id of [a, b, d]) expect((await db.task.findUniqueOrThrow({ where: { id } })).assigneeId).toBe(next);
    expect((await db.task.findUniqueOrThrow({ where: { id: c } })).assigneeId).toBe(leaver); // finished work keeps their name
    expect((await db.task.findUniqueOrThrow({ where: { id: e } })).assigneeId).toBe(leaver); // closed project untouched
    expect(await db.projectMember.count({ where: { userId: leaver, project: { status: "ACTIVE" } } })).toBe(0);
    expect(await db.projectMember.findUnique({ where: { projectId_userId: { projectId: member, userId: next } } })).toMatchObject({ role: "Designer" });
    expect(await db.projectMember.findUnique({ where: { projectId_userId: { projectId: managed, userId: next } } })).toMatchObject({ role: "Project manager" });
    const notes = await db.notification.findMany({ where: { kind: "project.handover" }, select: { userId: true, title: true } });
    expect(notes.filter((x) => x.userId === next)).toHaveLength(1);
    expect(notes.filter((x) => x.userId === boss).length).toBe(2); // the manager of each project they left with tasks
    expect((await workHeldBy(db, { organizationId: org, userId: leaver })).projects).toHaveLength(0);
  });

  it("can leave tasks unassigned for each project manager when the leaver manages nothing", async () => {
    const member = await project(boss, [{ userId: boss }, { userId: leaver }]);
    const t = await task(member, leaver);
    await db.user.update({ where: { id: leaver }, data: { active: false } });
    const r = await handOverWork(db, { organizationId: org, userId: leaver, byUserId: hr, mode: "unassign" });
    expect(r).toMatchObject({ ok: true, managed: [], reassigned: 0, unassigned: 1 });
    expect((await db.task.findUniqueOrThrow({ where: { id: t } })).assigneeId).toBeNull();
    expect(await handOverWork(db, { organizationId: org, userId: leaver, byUserId: hr, mode: "unassign" })).toMatchObject({ ok: false, error: expect.stringMatching(/no work/) });
  });
});
