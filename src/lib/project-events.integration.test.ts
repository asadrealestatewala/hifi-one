import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { mentionedMembers, projectMemberAdded, projectStatusChanged, taskAssigned, taskCommented, taskMoved } from "./events";

const url = process.env.TEST_DATABASE_URL ?? "postgresql://hifi:hifi_local_dev@localhost:54329/hifi_one_test";
const db = new PrismaClient({ datasourceUrl: url });
let org: string, other: string, pm: string, tahira: string, areeba: string, faizan: string, outsider: string, project: string, task: string;
const inbox = (id: string) => db.notification.findMany({ where: { userId: id }, orderBy: { createdAt: "asc" } });
const user = (o: string, name: string) => db.user.create({ data: { organizationId: o, email: `${name.replace(/\W/g, "")}@p.test`, name, passwordHash: "x" } }).then((u) => u.id);

beforeAll(async () => {
  await db.$executeRawUnsafe('TRUNCATE "Notification","TaskComment","Task","ProjectMember","Project","User","Organization" CASCADE');
  org = (await db.organization.create({ data: { name: "Proj Org" } })).id;
  other = (await db.organization.create({ data: { name: "Other" } })).id;
  pm = await user(org, "Pam Manager"); tahira = await user(org, "Tahira Siraj"); areeba = await user(org, "Areeba Ismail"); faizan = await user(org, "Faizan"); outsider = await user(org, "Olive Outsider");
  project = (await db.project.create({ data: { organizationId: org, number: "PRJ-1", name: "Launch", managerId: pm, members: { create: [{ userId: pm }, { userId: tahira }, { userId: areeba }, { userId: faizan }] } } })).id;
  task = (await db.task.create({ data: { projectId: project, title: "Design the landing page", assigneeId: tahira, createdById: pm } })).id;
});
afterAll(async () => { await db.$disconnect(); });
const clear = () => db.notification.deleteMany({});

describe("mentions", () => {
  const members = [{ id: "1", name: "Tahira Siraj" }, { id: "2", name: "Areeba Ismail" }, { id: "3", name: "Muhammad Jan" }, { id: "4", name: "Muhammad Ali" }];
  it("matches full names, unique first names and refuses ambiguous ones", () => {
    expect(mentionedMembers("please check @Tahira and @areeba ismail", members).sort()).toEqual(["1", "2"]);
    expect(mentionedMembers("@Muhammad can you look", members)).toEqual([]);
    expect(mentionedMembers("@Muhammad Jan can you look", members)).toEqual(["3"]);
    expect(mentionedMembers("email me at tahira@x.com", members)).toEqual([]);
  });
});

describe("project and task notifications", () => {
  it("tells a person once when they join a project, but not the manager who added them", async () => {
    await projectMemberAdded(db, { organizationId: org, projectId: project, userId: faizan, byUserId: pm, role: "Developer" });
    await projectMemberAdded(db, { organizationId: org, projectId: project, userId: faizan, byUserId: pm });
    await projectMemberAdded(db, { organizationId: org, projectId: project, userId: pm, byUserId: pm });
    expect(await inbox(faizan)).toHaveLength(1);
    expect(await inbox(pm)).toHaveLength(0);
    await clear();
  });

  it("tells each new assignee once and never the person who assigned", async () => {
    await taskAssigned(db, { organizationId: org, taskId: task, toUserId: areeba, byUserId: pm });
    await taskAssigned(db, { organizationId: org, taskId: task, toUserId: areeba, byUserId: pm });
    await taskAssigned(db, { organizationId: org, taskId: task, toUserId: pm, byUserId: pm });
    await taskAssigned(db, { organizationId: org, taskId: task, toUserId: null, byUserId: pm });
    expect(await inbox(areeba)).toHaveLength(1);
    expect(await inbox(pm)).toHaveLength(0);
    await taskAssigned(db, { organizationId: other, taskId: task, toUserId: faizan, byUserId: pm });
    expect(await inbox(faizan)).toHaveLength(0);
    await clear();
  });

  it("tells the manager and the creator when a task goes to review or is finished, not for other moves", async () => {
    await taskMoved(db, { organizationId: org, taskId: task, status: "IN_PROGRESS", byUserId: tahira });
    expect(await inbox(pm)).toHaveLength(0);
    await taskMoved(db, { organizationId: org, taskId: task, status: "REVIEW", byUserId: tahira });
    const got = await inbox(pm);
    expect(got).toHaveLength(1);
    expect(got[0].title).toBe("Tahira Siraj sent a task for review");
    expect(await inbox(tahira)).toHaveLength(0);
    await clear();
  });

  it("tells the whole team about a project status change except the person who made it", async () => {
    await projectStatusChanged(db, { organizationId: org, projectId: project, status: "ON_HOLD", byUserId: pm });
    expect((await inbox(tahira))[0].title).toBe("Launch is now on hold");
    expect(await inbox(pm)).toHaveLength(0);
    expect(await inbox(outsider)).toHaveLength(0);
    await clear();
  });

  it("sorts comment readers into mentioned and watching, once each, never reaching outsiders", async () => {
    const earlier = await db.taskComment.create({ data: { taskId: task, authorId: areeba, body: "On it" } });
    expect(earlier.id).toBeTruthy();
    const c = await db.taskComment.create({ data: { taskId: task, authorId: faizan, body: "Draft is ready, @Tahira please review. cc @Olive Outsider and @Pam" } });
    await taskCommented(db, { organizationId: org, taskId: task, commentId: c.id, authorId: faizan, body: c.body });
    await taskCommented(db, { organizationId: org, taskId: task, commentId: c.id, authorId: faizan, body: c.body });
    expect((await inbox(tahira)).map((n) => n.kind)).toEqual(["task.mention"]);
    expect((await inbox(pm)).map((n) => n.kind)).toEqual(["task.mention"]);
    expect((await inbox(areeba)).map((n) => n.kind)).toEqual(["task.comment"]);
    expect(await inbox(outsider)).toHaveLength(0);
    expect(await inbox(faizan)).toHaveLength(0);
  });
});
