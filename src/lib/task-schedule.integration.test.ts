// Task dates from the Timeline drag against hifi_one_test: who may change them, the start/due rule, and the clash warnings.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { scheduleError, scheduleTask } from "./task-schedule";

const url = process.env.TEST_DATABASE_URL ?? "postgresql://hifi:hifi_local_dev@localhost:54329/hifi_one_test";
const db = new PrismaClient({ datasourceUrl: url });
const d = (s: string) => new Date(`${s}T00:00:00Z`);
const perms = (...p: string[]) => new Set(p);

let org: string, boss: string, ana: string, outsider: string, proj: string, closed: string;
let design: string, build: string, done: string, shut: string;

beforeAll(async () => {
  await db.$executeRawUnsafe('TRUNCATE "Task","ProjectMember","Project","User","Organization" CASCADE');
  org = (await db.organization.create({ data: { name: "Sched Org" } })).id;
  const mk = (name: string) => db.user.create({ data: { organizationId: org, name, email: `${name}@sched.test`, passwordHash: "x", userType: "EMPLOYEE" } }).then((u) => u.id);
  boss = await mk("boss"); ana = await mk("ana"); outsider = await mk("outsider");
  proj = (await db.project.create({ data: { organizationId: org, number: "S-1", name: "Site", managerId: boss, deadline: d("2026-12-31"), members: { create: [{ userId: boss }, { userId: ana }] } } })).id;
  closed = (await db.project.create({ data: { organizationId: org, number: "S-2", name: "Old", managerId: boss, status: "COMPLETED" } })).id;
  design = (await db.task.create({ data: { projectId: proj, title: "Design", assigneeId: ana, dueDate: d("2026-12-10") } })).id;
  build = (await db.task.create({ data: { projectId: proj, title: "Build", assigneeId: ana, dueDate: d("2026-12-20"), blockedBy: [design] } })).id;
  done = (await db.task.create({ data: { projectId: proj, title: "Done", status: "DONE", dueDate: d("2026-12-01") } })).id;
  shut = (await db.task.create({ data: { projectId: closed, title: "Shut", dueDate: d("2026-12-01") } })).id;
});
afterAll(async () => { await db.$disconnect(); });

const bossActor = () => ({ id: boss, organizationId: org, permissions: perms("tasks.edit") });

describe("scheduleError", () => {
  it("accepts empty or ordered dates and refuses a start after the due date or a non-date", () => {
    expect(scheduleError(null, null)).toBeNull();
    expect(scheduleError("2026-12-01", "2026-12-01")).toBeNull();
    expect(scheduleError("2026-12-02", "2026-12-01")).toMatch("start date can't be after");
    expect(scheduleError("2026-02-30", null)).toMatch("valid start date");
    expect(scheduleError(null, "soon")).toMatch("valid due date");
  });
});

describe("scheduleTask", () => {
  it("sets the start and due dates and returns what changed", async () => {
    const r = await scheduleTask(db, { actor: bossActor(), taskId: design, start: "2026-12-01", due: "2026-12-08" });
    expect(r).toMatchObject({ changed: true, before: { startDate: null, dueDate: "2026-12-10" }, after: { startDate: "2026-12-01", dueDate: "2026-12-08" }, warnings: [] });
    const t = await db.task.findUniqueOrThrow({ where: { id: design } });
    expect(t.startDate?.toISOString().slice(0, 10)).toBe("2026-12-01");
    expect((await scheduleTask(db, { actor: bossActor(), taskId: design, start: "2026-12-01", due: "2026-12-08" })).changed).toBe(false);
  });

  it("warns, but saves, when the task would start before the work it waits for is due, or end after the deadline", async () => {
    const r = await scheduleTask(db, { actor: bossActor(), taskId: build, start: "2026-12-05", due: "2027-01-05" });
    expect(r.changed).toBe(true);
    expect(r.warnings).toEqual([
      'It waits for "Design", which is due 2026-12-08, after this task starts.',
      "The due date is after the project deadline (2026-12-31).",
    ]);
    const clean = await scheduleTask(db, { actor: bossActor(), taskId: build, start: "2026-12-09", due: "2026-12-20" });
    expect(clean.warnings).toEqual([]);
  });

  it("refuses team members who do not manage the project, and people outside it", async () => {
    await expect(scheduleTask(db, { actor: { id: ana, organizationId: org, permissions: perms("tasks.edit") }, taskId: build, start: null, due: "2026-12-21" })).rejects.toThrow("Only the project manager");
    await expect(scheduleTask(db, { actor: { id: outsider, organizationId: org, permissions: perms("tasks.edit") }, taskId: build, start: null, due: "2026-12-21" })).rejects.toThrow("Task not found");
    expect((await db.task.findUniqueOrThrow({ where: { id: build } })).dueDate?.toISOString().slice(0, 10)).toBe("2026-12-20");
  });

  it("lets projects.manage change dates on any project it can see", async () => {
    const r = await scheduleTask(db, { actor: { id: outsider, organizationId: org, permissions: perms("tasks.edit", "projects.manage", "projects.view_all") }, taskId: build, start: "2026-12-10", due: "2026-12-21" });
    expect(r.changed).toBe(true);
  });

  it("refuses done tasks, closed projects and a start after the due date", async () => {
    await expect(scheduleTask(db, { actor: bossActor(), taskId: done, start: null, due: "2026-12-05" })).rejects.toThrow("done");
    await expect(scheduleTask(db, { actor: bossActor(), taskId: shut, start: null, due: "2026-12-05" })).rejects.toThrow("closed");
    await expect(scheduleTask(db, { actor: bossActor(), taskId: build, start: "2026-12-22", due: "2026-12-21" })).rejects.toThrow("can't be after");
  });
});
