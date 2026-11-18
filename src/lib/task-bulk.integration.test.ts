// bulkEditTasks against hifi_one_test: many tasks changed at once, each checked on its own.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { bulkEditTasks, type BulkActor } from "./task-bulk";

const url = process.env.TEST_DATABASE_URL ?? "postgresql://hifi:hifi_local_dev@localhost:54329/hifi_one_test";
const db = new PrismaClient({ datasourceUrl: url });

let org: string, other: string, manager: string, member: string, outsider: string, stranger: string;
let mine: string, theirs: string, closed: string, foreign: string;
const mkUser = (o: string, name: string) => db.user.create({ data: { organizationId: o, email: `${name}@bulk.test`, name, passwordHash: "x", userType: "EMPLOYEE" } }).then((u) => u.id);
const actor = (id: string, perms: string[] = ["tasks.edit"]): BulkActor => ({ id, organizationId: org, permissions: new Set(perms) });
const task = (projectId: string, title: string, over: Record<string, unknown> = {}) => db.task.create({ data: { projectId, title, ...over } }).then((t) => t.id);

beforeAll(async () => {
  await db.$executeRawUnsafe('TRUNCATE "Notification","TimeEntry","TaskComment","Task","ProjectMember","Project","User","Organization" CASCADE');
  org = (await db.organization.create({ data: { name: "Bulk Org" } })).id;
  other = (await db.organization.create({ data: { name: "Other" } })).id;
  manager = await mkUser(org, "manager");
  member = await mkUser(org, "member");
  outsider = await mkUser(org, "outsider"); // in the org, on no project
  stranger = await mkUser(other, "stranger");
  mine = (await db.project.create({ data: { organizationId: org, number: "B-1", name: "Managed", managerId: manager, members: { create: [{ userId: manager }, { userId: member }] } } })).id;
  theirs = (await db.project.create({ data: { organizationId: org, number: "B-2", name: "Someone else's", managerId: outsider, members: { create: [{ userId: outsider }, { userId: member }] } } })).id;
  closed = (await db.project.create({ data: { organizationId: org, number: "B-3", name: "Closed", managerId: manager, status: "COMPLETED", members: { create: [{ userId: manager }] } } })).id;
  foreign = (await db.project.create({ data: { organizationId: other, number: "X-1", name: "Other org", managerId: stranger } })).id;
});
beforeEach(async () => { await db.timeEntry.deleteMany(); await db.task.deleteMany(); });
afterAll(async () => { await db.$disconnect(); });

describe("bulkEditTasks", () => {
  it("assigns many tasks at once, but only to people on each task's team", async () => {
    const a = await task(mine, "a"), b = await task(mine, "b"), c = await task(theirs, "c");
    const r = await bulkEditTasks(db, { actor: actor(manager, ["tasks.edit", "projects.manage", "projects.view_all"]), taskIds: [a, b, c], change: { kind: "assign", userId: member } });
    expect(r.changed.map((x) => x.id).sort()).toEqual([a, b, c].sort());
    const r2 = await bulkEditTasks(db, { actor: actor(manager, ["tasks.edit", "projects.manage", "projects.view_all"]), taskIds: [a, c], change: { kind: "assign", userId: manager } });
    expect(r2.changed.map((x) => x.id)).toEqual([a]);
    expect(r2.skipped).toEqual([{ id: c, title: "c", reason: "That person is not on this project's team." }]);
    expect((await db.task.findUnique({ where: { id: c } }))!.assigneeId).toBe(member);
  });

  it("refuses an inactive person or someone from another organization", async () => {
    const a = await task(mine, "a");
    await expect(bulkEditTasks(db, { actor: actor(manager), taskIds: [a], change: { kind: "assign", userId: stranger } })).rejects.toThrow("active staff member");
  });

  it("lets only the project manager change details; others are skipped with the reason", async () => {
    const a = await task(mine, "a"), b = await task(theirs, "b");
    const r = await bulkEditTasks(db, { actor: actor(manager), taskIds: [a, b], change: { kind: "due", date: "2026-12-01" } });
    // the manager of "mine" is not on "theirs", so that task is invisible to them
    expect(r.changed.map((x) => x.id)).toEqual([a]);
    expect(r.skipped).toEqual([{ id: b, title: "", reason: "Task not found." }]);
    const m = await bulkEditTasks(db, { actor: actor(member), taskIds: [a, b], change: { kind: "priority", value: "HIGH" } });
    expect(m.changed).toHaveLength(0);
    expect(m.skipped.map((s) => s.reason)).toEqual(["Only the project manager can change this task.", "Only the project manager can change this task."]);
    expect((await db.task.findUnique({ where: { id: a } }))!.dueDate!.toISOString().slice(0, 10)).toBe("2026-12-01");
  });

  it("lets an assignee move their own tasks, follows the waiting rules, and never touches closed projects or other organizations", async () => {
    const own = await task(mine, "own", { assigneeId: member });
    const notOwn = await task(mine, "not own", { assigneeId: manager });
    const blocker = await task(mine, "blocker");
    const waits = await task(mine, "waits", { assigneeId: member, blockedBy: [blocker] });
    const old = await task(closed, "old", { assigneeId: member });
    const elsewhere = await task(foreign, "elsewhere");
    const r = await bulkEditTasks(db, { actor: actor(member), taskIds: [own, notOwn, waits, old, elsewhere], change: { kind: "status", value: "DONE" } });
    expect(r.changed.map((x) => x.id)).toEqual([own]);
    const reasons = Object.fromEntries(r.skipped.map((s) => [s.id, s.reason]));
    expect(reasons[notOwn]).toBe("You can only move tasks assigned to you.");
    expect(reasons[waits]).toMatch(/blocker/);
    expect(reasons[elsewhere]).toBe("Task not found.");
    expect(reasons[old]).toBe("Task not found."); // the member is not on the closed project
    const r2 = await bulkEditTasks(db, { actor: actor(manager), taskIds: [old], change: { kind: "status", value: "TODO" } });
    expect(r2.skipped[0].reason).toBe("The project is closed.");
  });

  it("deletes tasks with their subtasks, but keeps any with logged time", async () => {
    const a = await task(mine, "a"), b = await task(mine, "b");
    const sub = await task(mine, "sub of a", { parentId: a });
    const waiting = await task(mine, "waiting on a", { blockedBy: [a] });
    await db.timeEntry.create({ data: { organizationId: org, projectId: mine, taskId: b, userId: member, workDate: "2026-11-18", hours: "1.5" } });
    const r = await bulkEditTasks(db, { actor: actor(manager), taskIds: [a, b], change: { kind: "delete" } });
    expect(r.deleted).toBe(1);
    expect(r.kept).toBe(1);
    expect(await db.task.findUnique({ where: { id: a } })).toBeNull();
    expect(await db.task.findUnique({ where: { id: sub } })).toBeNull();
    expect(await db.task.findUnique({ where: { id: b } })).not.toBeNull();
    expect((await db.task.findUnique({ where: { id: waiting } }))!.blockedBy).toEqual([]);
    const denied = await bulkEditTasks(db, { actor: actor(member), taskIds: [b], change: { kind: "delete" } });
    expect(denied.deleted).toBe(0);
    expect(denied.skipped[0].reason).toBe("Only the project manager can change this task.");
  });

  it("rejects a bad value before touching anything", async () => {
    const a = await task(mine, "a");
    await expect(bulkEditTasks(db, { actor: actor(manager), taskIds: [a], change: { kind: "priority", value: "URGENT" } })).rejects.toThrow();
    await expect(bulkEditTasks(db, { actor: actor(manager), taskIds: [a], change: { kind: "due", date: "18/11/2026" } })).rejects.toThrow("valid due date");
  });
});
