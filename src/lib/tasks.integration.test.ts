import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { authorizeOwner, type FileActor } from "./file-access";
import { TaskError, addComment, addSubtask, changeTaskStatus, setBlockers, setRecurrence } from "./tasks";

const url = process.env.TEST_DATABASE_URL ?? "postgresql://hifi:hifi_local_dev@localhost:54329/hifi_one_test";
const db = new PrismaClient({ datasourceUrl: url });
let org: string, ann: string, bob: string, proj: string, other: string;

beforeAll(async () => {
  await db.$executeRawUnsafe('TRUNCATE "TaskComment","Task","ProjectMember","Project","User","Organization" CASCADE');
  org = (await db.organization.create({ data: { name: "Task Org" } })).id;
  const mk = (e: string) => db.user.create({ data: { organizationId: org, email: e, name: e, passwordHash: "x" } }).then((u) => u.id);
  ann = await mk("ann@t.test"); bob = await mk("bob@t.test");
  const mkProject = (name: string, n: string) => db.project.create({ data: { organizationId: org, number: n, name, managerId: ann } }).then((p) => p.id);
  proj = await mkProject("P1", "PRJ-1"); other = await mkProject("P2", "PRJ-2");
  await db.projectMember.create({ data: { projectId: proj, userId: ann } });
});
afterAll(async () => { await db.$disconnect(); });

const task = (title: string, extra: Record<string, unknown> = {}, projectId = proj) => db.task.create({ data: { projectId, title, ...extra } });

describe("subtasks", () => {
  it("adds subtasks one level deep, blocks completing the parent until they are done, and keeps them in the project", async () => {
    const parent = await task("Launch site");
    const s1 = await addSubtask(db, { projectId: proj, parentId: parent.id, title: "Write copy", actorId: ann });
    await addSubtask(db, { projectId: proj, parentId: parent.id, title: "Build pages", actorId: ann });
    await expect(addSubtask(db, { projectId: proj, parentId: s1.id, title: "Too deep", actorId: ann })).rejects.toThrow(/own subtasks/);
    await expect(addSubtask(db, { projectId: proj, parentId: parent.id, title: "x", actorId: ann })).rejects.toThrow(/title/);
    await expect(addSubtask(db, { projectId: proj, parentId: parent.id, title: "Needs member", assigneeId: bob, actorId: ann })).rejects.toThrow(/project members/);
    await expect(addSubtask(db, { projectId: other, parentId: parent.id, title: "Wrong project", actorId: ann })).rejects.toThrow(/not found/);
    await expect(changeTaskStatus(db, { projectId: proj, taskId: parent.id, status: "DONE", actorId: ann })).rejects.toThrow(/2 subtasks are not done/);
    for (const s of await db.task.findMany({ where: { parentId: parent.id } })) await changeTaskStatus(db, { projectId: proj, taskId: s.id, status: "DONE", actorId: ann });
    expect((await changeTaskStatus(db, { projectId: proj, taskId: parent.id, status: "DONE", actorId: ann })).task.status).toBe("DONE");
    await expect(addSubtask(db, { projectId: proj, parentId: parent.id, title: "After done", actorId: ann })).rejects.toThrow(/Reopen/);
  });
});

describe("dependencies", () => {
  it("makes a blocked task wait, rejects loops, self-blocks, other projects and subtask links", async () => {
    const a = await task("Design"), b = await task("Build"), c = await task("Ship");
    await setBlockers(db, { projectId: proj, taskId: b.id, blockerIds: [a.id] });
    await setBlockers(db, { projectId: proj, taskId: c.id, blockerIds: [b.id] });
    await expect(setBlockers(db, { projectId: proj, taskId: a.id, blockerIds: [c.id] })).rejects.toThrow(/loop/);
    await expect(setBlockers(db, { projectId: proj, taskId: a.id, blockerIds: [a.id] })).rejects.toThrow(/itself/);
    const foreign = await task("Elsewhere", {}, other);
    await expect(setBlockers(db, { projectId: proj, taskId: a.id, blockerIds: [foreign.id] })).rejects.toThrow(/this project/);
    const sub = await addSubtask(db, { projectId: proj, parentId: a.id, title: "Sketch", actorId: ann });
    await expect(setBlockers(db, { projectId: proj, taskId: a.id, blockerIds: [sub.id] })).rejects.toThrow(/subtasks/);
    // Cannot start or finish a blocked task, but may leave it in To do
    await expect(changeTaskStatus(db, { projectId: proj, taskId: b.id, status: "IN_PROGRESS", actorId: ann })).rejects.toThrow(/Waiting for: Design/);
    await expect(changeTaskStatus(db, { projectId: proj, taskId: c.id, status: "DONE", actorId: ann })).rejects.toThrow(/Waiting for: Build/);
    await changeTaskStatus(db, { projectId: proj, taskId: sub.id, status: "DONE", actorId: ann });
    await changeTaskStatus(db, { projectId: proj, taskId: a.id, status: "DONE", actorId: ann });
    expect((await changeTaskStatus(db, { projectId: proj, taskId: b.id, status: "IN_PROGRESS", actorId: ann })).task.status).toBe("IN_PROGRESS");
    await expect(setBlockers(db, { projectId: proj, taskId: a.id, blockerIds: Array.from({ length: 11 }, (_, i) => `x${i}`) })).rejects.toThrow(/at most 10/);
  });
});

describe("recurring tasks", () => {
  it("creates the next occurrence once when completed, with the next due date, and never twice", async () => {
    const t = await task("Monthly report", { recurrence: "MONTHLY", dueDate: new Date("2026-01-31T00:00:00Z"), assigneeId: ann, priority: "HIGH" });
    const r = await changeTaskStatus(db, { projectId: proj, taskId: t.id, status: "DONE", actorId: ann });
    expect(r.next).toMatchObject({ title: "Monthly report", status: "TODO", assigneeId: ann, priority: "HIGH", recurrence: "MONTHLY", recurredFromId: t.id });
    expect(r.next!.dueDate!.toISOString().slice(0, 10)).toBe("2026-02-28");
    // Reopen and complete again: the unique link means no second copy
    await changeTaskStatus(db, { projectId: proj, taskId: t.id, status: "TODO", actorId: ann });
    const again = await changeTaskStatus(db, { projectId: proj, taskId: t.id, status: "DONE", actorId: ann });
    expect(again.next).toBeNull();
    expect(await db.task.count({ where: { recurredFromId: t.id } })).toBe(1);
  });

  it("two people completing at once still create one copy", async () => {
    const t = await task("Weekly sync", { recurrence: "WEEKLY", dueDate: new Date("2026-03-02T00:00:00Z") });
    const results = await Promise.allSettled([1, 2].map(() => changeTaskStatus(db, { projectId: proj, taskId: t.id, status: "DONE", actorId: ann })));
    expect(results.some((r) => r.status === "fulfilled")).toBe(true);
    expect(await db.task.count({ where: { recurredFromId: t.id } })).toBe(1);
  });

  it("validates the repeat choice and refuses repeating subtasks", async () => {
    const t = await task("Standing task");
    await expect(setRecurrence(db, { projectId: proj, taskId: t.id, recurrence: "YEARLY" })).rejects.toThrow(/daily, weekly or monthly/);
    expect((await setRecurrence(db, { projectId: proj, taskId: t.id, recurrence: "DAILY" })).recurrence).toBe("DAILY");
    expect((await setRecurrence(db, { projectId: proj, taskId: t.id, recurrence: null })).recurrence).toBeNull();
    const sub = await addSubtask(db, { projectId: proj, parentId: t.id, title: "Part one", actorId: ann });
    await expect(setRecurrence(db, { projectId: proj, taskId: sub.id, recurrence: "DAILY" })).rejects.toThrow(TaskError);
  });
});

describe("comments", () => {
  it("stores comments as internal by default, trims, and rejects empty, oversized and other-project tasks", async () => {
    const t = await task("Discuss");
    const c = await addComment(db, { projectId: proj, taskId: t.id, authorId: ann, body: "  looks good  " });
    expect(c).toMatchObject({ body: "looks good", internal: true });
    await expect(addComment(db, { projectId: proj, taskId: t.id, authorId: ann, body: "   " })).rejects.toThrow(/Write a comment/);
    await expect(addComment(db, { projectId: proj, taskId: t.id, authorId: ann, body: "x".repeat(4001) })).rejects.toThrow(/too long/);
    await expect(addComment(db, { projectId: other, taskId: t.id, authorId: ann, body: "hi" })).rejects.toThrow(/not found/);
  });
});

describe("files on a task follow the project", () => {
  it("lets members and managers in, limits uploads to the assignee or manager, and closes to others and closed projects", async () => {
    const t = await task("With files", { assigneeId: ann });
    const actor = (id: string, ...perms: string[]): FileActor => ({ id, organizationId: org, userType: "EMPLOYEE", clientId: null, vendorId: null, permissions: new Set(perms) });
    expect(await authorizeOwner(db, actor(ann, "projects.view", "tasks.edit"), "TASK", t.id, "upload")).toBe(true);
    expect(await authorizeOwner(db, actor(ann, "projects.view"), "TASK", t.id, "read")).toBe(true);
    expect(await authorizeOwner(db, actor(bob, "projects.view", "tasks.edit"), "TASK", t.id, "read")).toBe(false); // not on the project
    expect(await authorizeOwner(db, actor(bob, "projects.view", "projects.view_all"), "TASK", t.id, "read")).toBe(true);
    expect(await authorizeOwner(db, actor(bob, "projects.view", "projects.view_all", "tasks.edit"), "TASK", t.id, "upload")).toBe(false); // sees it, but is neither manager nor assignee
    expect(await authorizeOwner(db, { ...actor(ann, "projects.view"), userType: "CLIENT" }, "TASK", t.id, "read")).toBe(false);
    await db.project.update({ where: { id: proj }, data: { status: "COMPLETED" } });
    expect(await authorizeOwner(db, actor(ann, "projects.view", "tasks.edit"), "TASK", t.id, "upload")).toBe(false);
    await db.project.update({ where: { id: proj }, data: { status: "ACTIVE" } });
  });
});
