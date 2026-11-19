// Weekly planner against hifi_one_test: the week grid by person and day, the tray, and moving a task (date and person) with its rules.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { loadPlannerWeek, planTask, plannerWeekStart } from "./planner";
import { calendarFrom } from "./working-calendar";

const url = process.env.TEST_DATABASE_URL ?? "postgresql://hifi:hifi_local_dev@localhost:54329/hifi_one_test";
const db = new PrismaClient({ datasourceUrl: url });
const TODAY = "2026-11-18"; // a Wednesday
const CAL = calendarFrom({ workStart: "09:00", workEnd: "18:30", lunchMinutes: 30, graceMinutes: 10, workDays: "1,2,3,4,5" }, "Asia/Karachi"); // 9 h days
const d = (s: string) => new Date(`${s}T00:00:00Z`);
const perms = (...p: string[]) => new Set(p);

let org: string, boss: string, ana: string, bob: string, away: string, outsider: string, client: string;
let mine: string, other: string, closed: string;
let tDue: string, tNoDate: string, tLate: string, tOther: string, tDone: string, tClosed: string;

beforeAll(async () => {
  await db.$executeRawUnsafe('TRUNCATE "LeaveRequest","LeaveType","TimeEntry","Task","ProjectMember","Project","User","Organization" CASCADE');
  org = (await db.organization.create({ data: { name: "Plan Org" } })).id;
  const mk = (name: string, userType = "EMPLOYEE") => db.user.create({ data: { organizationId: org, name, email: `${name}@plan.test`, passwordHash: "x", userType } }).then((u) => u.id);
  boss = await mk("boss"); ana = await mk("ana"); bob = await mk("bob"); away = await mk("away"); outsider = await mk("outsider"); client = await mk("client", "CLIENT");
  mine = (await db.project.create({ data: { organizationId: org, number: "P-1", name: "Mine", managerId: boss, members: { create: [{ userId: boss }, { userId: ana }, { userId: bob }, { userId: away }, { userId: client }] } } })).id;
  other = (await db.project.create({ data: { organizationId: org, number: "P-2", name: "Not mine", managerId: bob, members: { create: [{ userId: bob }, { userId: ana }] } } })).id;
  closed = (await db.project.create({ data: { organizationId: org, number: "P-3", name: "Closed", managerId: boss, status: "COMPLETED", members: { create: [{ userId: ana }] } } })).id;
  const t = (projectId: string, title: string, over: Record<string, unknown> = {}) => db.task.create({ data: { projectId, title, ...over } }).then((x) => x.id);
  tDue = await t(mine, "due thu", { assigneeId: ana, dueDate: d("2026-11-19"), estimatedHours: "6" });
  await t(mine, "due thu 2", { assigneeId: ana, dueDate: d("2026-11-19"), estimatedHours: "5" });
  await t(mine, "due fri no estimate", { assigneeId: ana, dueDate: d("2026-11-20") });
  await t(mine, "unassigned fri", { dueDate: d("2026-11-20"), estimatedHours: "1" });
  tNoDate = await t(mine, "no date", { assigneeId: bob });
  tLate = await t(mine, "late", { assigneeId: bob, dueDate: d("2026-11-10") });
  tDone = await t(mine, "done", { assigneeId: ana, dueDate: d("2026-11-19"), status: "DONE" });
  await t(mine, "next week", { assigneeId: ana, dueDate: d("2026-11-25"), estimatedHours: "3" });
  tOther = await t(other, "other project", { assigneeId: ana, dueDate: d("2026-11-19"), estimatedHours: "40" });
  tClosed = await t(closed, "closed project", { assigneeId: ana, dueDate: d("2026-11-19") });
  const lt = await db.leaveType.create({ data: { organizationId: org, name: "Annual", daysPerYear: "14" } });
  await db.leaveRequest.create({ data: { userId: away, leaveTypeId: lt.id, startDate: "2026-11-19", endDate: "2026-11-20", days: "2", status: "APPROVED" } });
});
afterAll(async () => { await db.$disconnect(); });

const bossActor = () => ({ id: boss, organizationId: org, permissions: perms("tasks.edit") });
const week = (over: Partial<Parameters<typeof loadPlannerWeek>[1]> = {}) => loadPlannerWeek(db, {
  scope: { organizationId: org, managerId: boss }, organizationId: org, today: TODAY, week: "2026-11-18", calendar: CAL,
  holidays: [{ date: "2026-11-17", name: "Test holiday" }], actor: { id: boss, permissions: perms("tasks.edit") }, ...over,
});

describe("plannerWeekStart", () => {
  it("snaps any date to its Monday and ignores nonsense", () => {
    expect(plannerWeekStart("2026-11-22", TODAY)).toBe("2026-11-16");
    expect(plannerWeekStart("garbage", TODAY)).toBe("2026-11-16");
    expect(plannerWeekStart(undefined, TODAY)).toBe("2026-11-16");
  });
});

describe("loadPlannerWeek", () => {
  it("puts each open task on its due day, with the day's estimates against the person's hours", async () => {
    const w = await week();
    expect(w.from).toBe("2026-11-16");
    expect(w.to).toBe("2026-11-22");
    const a = w.rows.find((r) => r.name === "ana")!;
    const thu = a.cells.find((c) => c.date === "2026-11-19")!;
    expect(thu.tasks.map((t) => t.title).sort()).toEqual(["due thu", "due thu 2"]); // not done, not another manager's project, not closed
    expect(thu).toMatchObject({ plannedHours: 11, capacityHours: 9 });
    expect(a.cells.find((c) => c.date === "2026-11-20")!.unestimated).toBe(1);
    expect(a.cells.find((c) => c.date === "2026-11-17")!.capacityHours).toBe(0); // public holiday
    expect(a.cells.find((c) => c.date === "2026-11-21")!.capacityHours).toBe(0); // Saturday
    expect(a.capacityHours).toBe(36); // four working days of 9 hours
    expect(thu.tasks.every((t) => t.canMove)).toBe(true);
  });

  it("gives approved leave no hours and marks the days", async () => {
    const r = (await week()).rows.find((x) => x.name === "away")!;
    expect(r.cells.find((c) => c.date === "2026-11-19")).toMatchObject({ away: true, capacityHours: 0 });
    expect(r.capacityHours).toBe(18);
  });

  it("lists tasks with no date or already overdue in the tray, and unassigned work in its own row", async () => {
    const w = await week();
    expect(w.tray.map((t) => t.title).sort()).toEqual(["late", "no date"]);
    expect(w.trayTotal).toBe(2);
    expect(w.rows.at(-1)).toMatchObject({ userId: null, name: "Unassigned" });
    expect(w.days.find((x) => x.date === "2026-11-17")).toMatchObject({ holiday: "Test holiday", working: false });
    expect(w.days.find((x) => x.date === "2026-11-18")!.today).toBe(true);
    expect(w.people.map((p) => p.name)).not.toContain("client"); // client logins are never given work
  });

  it("shows a person without planning rights only their own row, read only", async () => {
    const w = await week({ scope: { organizationId: org, OR: [{ managerId: ana }, { members: { some: { userId: ana } } }] }, onlyUserId: ana, actor: { id: ana, permissions: perms("tasks.edit") } });
    expect(w.rows.map((r) => r.name)).toEqual(["ana"]);
    const all = w.rows[0].cells.flatMap((c) => c.tasks);
    expect(all.map((t) => t.title)).toContain("other project");
    expect(all.every((t) => !t.canMove)).toBe(true);
  });
});

describe("planTask", () => {
  it("moves a task to another day and person in one step", async () => {
    const r = await planTask(db, { actor: bossActor(), move: { taskId: tDue, date: "2026-11-23", assigneeId: bob } });
    expect(r).toMatchObject({ changed: true, before: { dueDate: "2026-11-19", assigneeId: ana }, after: { dueDate: "2026-11-23", assigneeId: bob } });
    const t = await db.task.findUniqueOrThrow({ where: { id: tDue } });
    expect(t.dueDate?.toISOString().slice(0, 10)).toBe("2026-11-23");
    expect(t.assigneeId).toBe(bob);
  });

  it("keeps the assignee when none is given, and takes the date off from the tray", async () => {
    await planTask(db, { actor: bossActor(), move: { taskId: tNoDate, date: "2026-11-20" } });
    expect((await db.task.findUniqueOrThrow({ where: { id: tNoDate } })).assigneeId).toBe(bob);
    await planTask(db, { actor: bossActor(), move: { taskId: tNoDate, date: null } });
    expect((await db.task.findUniqueOrThrow({ where: { id: tNoDate } })).dueDate).toBeNull();
    expect((await planTask(db, { actor: bossActor(), move: { taskId: tNoDate, date: null } })).changed).toBe(false);
  });

  it("refuses someone who does not manage the project", async () => {
    await expect(planTask(db, { actor: { id: ana, organizationId: org, permissions: perms("tasks.edit") }, move: { taskId: tLate, date: "2026-11-20" } })).rejects.toThrow("Only the project manager");
    await expect(planTask(db, { actor: { id: outsider, organizationId: org, permissions: perms("tasks.edit") }, move: { taskId: tLate, date: "2026-11-20" } })).rejects.toThrow("Task not found");
    await expect(planTask(db, { actor: bossActor(), move: { taskId: tOther, date: "2026-11-20" } })).rejects.toThrow("Task not found"); // boss is not on it
    expect((await db.task.findUniqueOrThrow({ where: { id: tLate } })).dueDate?.toISOString().slice(0, 10)).toBe("2026-11-10");
  });

  it("lets projects.manage move tasks on any project it can see", async () => {
    const r = await planTask(db, { actor: { id: outsider, organizationId: org, permissions: perms("tasks.edit", "projects.manage", "projects.view_all") }, move: { taskId: tOther, date: "2026-11-24" } });
    expect(r.changed).toBe(true);
  });

  it("refuses people off the team, client logins, done tasks, closed projects and bad dates", async () => {
    await expect(planTask(db, { actor: bossActor(), move: { taskId: tLate, date: "2026-11-20", assigneeId: outsider } })).rejects.toThrow("not on this project's team");
    await expect(planTask(db, { actor: bossActor(), move: { taskId: tLate, date: "2026-11-20", assigneeId: client } })).rejects.toThrow("not on this project's team");
    await expect(planTask(db, { actor: bossActor(), move: { taskId: tDone, date: "2026-11-20" } })).rejects.toThrow("done");
    await expect(planTask(db, { actor: bossActor(), move: { taskId: tClosed, date: "2026-11-20" } })).rejects.toThrow("closed");
    await expect(planTask(db, { actor: bossActor(), move: { taskId: tLate, date: "2026-02-31x" } })).rejects.toThrow("valid date");
  });
});
