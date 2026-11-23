// Plan the week: the template's rows, copying last week, saving all or nothing, who may plan what, and the planner's
// per-person counts, against hifi_one_test.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { checkLines, linesFromLastWeek, linesFromSheet, loadPlanContext, readDay, readTime, saveWeekPlan, weekProgress, type PlanLine } from "./week-plan";
import { readWorkbook } from "./spreadsheet";
import { buildXlsx } from "./xlsx";

const url = process.env.TEST_DATABASE_URL ?? "postgresql://hifi:hifi_local_dev@localhost:54329/hifi_one_test";
const db = new PrismaClient({ datasourceUrl: url });
let org: string, otherOrg: string, pm: string, pm2: string, boss: string, dev: string, des: string, stranger: string, outsider: string, site: string, app: string, closed: string, foreign: string;
// Wednesday 25 Nov 2026, 10:00 in Karachi; the week runs Mon 23 to Sun 29 Nov
const NOW = new Date("2026-11-25T05:00:00.000Z");
const WEEK = "2026-11-23";
const actor = (id: string, perms: string[] = []) => ({ id, organizationId: org, permissions: new Set(perms) });
const ctxFor = async (id: string, perms: string[] = [], week = WEEK) => (await loadPlanContext(db, actor(id, perms), week, NOW)).ctx;
const line = (p: Partial<PlanLine>): PlanLine => ({ personId: dev, projectId: site, date: "2026-11-26", title: "Write the brief", priority: "MEDIUM", dueTime: "", hours: "", ...p });

beforeAll(async () => {
  await db.$executeRawUnsafe('TRUNCATE "Notification","AuditLog","TaskReview","TaskIssue","TaskComment","Task","ProjectMember","Project","WorkingCalendar","PublicHoliday","UserRole","RolePermission","Role","Permission","User","CompanyProfile","Organization" CASCADE');
  org = (await db.organization.create({ data: { name: "Plan Org" } })).id;
  otherOrg = (await db.organization.create({ data: { name: "Other Org" } })).id;
  await db.companyProfile.create({ data: { organizationId: org, isDefault: true, legalName: "Plan Org", timezone: "Asia/Karachi" } });
  const mk = (o: string, email: string, name: string, extra: object = {}) => db.user.create({ data: { organizationId: o, email, name, passwordHash: "x", ...extra } }).then((u) => u.id);
  pm = await mk(org, "pm@p.test", "Pia PM");
  pm2 = await mk(org, "pm2@p.test", "Paul PM");
  boss = await mk(org, "boss@p.test", "Bo Boss");
  dev = await mk(org, "dev@p.test", "Dev Doe");
  des = await mk(org, "des@p.test", "Dana Designer");
  stranger = await mk(org, "gone@p.test", "Gone Person", { active: false });
  outsider = await mk(otherOrg, "o@p.test", "Other Org Person");
  site = (await db.project.create({ data: { organizationId: org, number: "PRJ-0001", name: "Website", managerId: pm, members: { create: [{ userId: dev }, { userId: des }, { userId: stranger }] } } })).id;
  app = (await db.project.create({ data: { organizationId: org, number: "PRJ-0002", name: "Mobile app", managerId: pm2, members: { create: [{ userId: dev }] } } })).id;
  closed = (await db.project.create({ data: { organizationId: org, number: "PRJ-0003", name: "Old", managerId: pm, status: "COMPLETED", members: { create: [{ userId: dev }] } } })).id;
  foreign = (await db.project.create({ data: { organizationId: otherOrg, number: "PRJ-0001", name: "Theirs", managerId: outsider, members: { create: [{ userId: outsider }] } } })).id;
});
afterAll(async () => { await db.$disconnect(); });

describe("what a manager may plan", () => {
  it("offers only the open projects they manage and the active staff on those teams", async () => {
    const ctx = await ctxFor(pm);
    expect(ctx.week).toBe(WEEK);
    expect(ctx.projects.map((p) => p.name)).toEqual(["Website"]);
    expect(ctx.people.map((p) => p.name)).toEqual(["Dana Designer", "Dev Doe"]); // the inactive member is left out
    expect(ctx.days.filter((d) => d.past).map((d) => d.date)).toEqual(["2026-11-23", "2026-11-24"]);
  });

  it("gives projects.manage every open project of the organization, never another organization's", async () => {
    const ctx = await ctxFor(boss, ["projects.manage"]);
    expect(ctx.projects.map((p) => p.name).sort()).toEqual(["Mobile app", "Website"]);
    expect(ctx.projects.some((p) => p.id === foreign || p.id === closed)).toBe(false);
  });

  it("gives someone who manages nothing nothing to plan", async () => {
    expect((await ctxFor(dev)).projects).toEqual([]);
  });
});

describe("checking the lines", () => {
  it("says what is wrong on each line", async () => {
    const ctx = await ctxFor(pm);
    const errors = checkLines([
      line({}),
      line({ title: "x" }),
      line({ projectId: app }),
      line({ personId: stranger }),
      line({ date: "2026-11-24" }),
      line({ date: "2026-12-01" }),
      line({ dueTime: "25:00" }),
      line({ hours: "lots" }),
      line({ priority: "URGENT" }),
    ], ctx);
    expect(errors.map((e) => [e.line, e.message])).toEqual([
      [1, "Write the task."],
      [2, "Choose a project you plan."],
      [3, "That person is not on this project's team. Add them to the team first."],
      [4, "That day has passed."],
      [5, "Choose a day of this week."],
      [6, "Enter the due time as hours and minutes, for example 15:00."],
      [7, "Hours must be a number such as 2 or 1.5."],
      [8, "Choose a priority."],
    ]);
    expect(checkLines([], ctx)).toEqual([{ line: -1, message: "Add at least one task." }]);
  });
});

describe("saving the week", () => {
  it("saves nothing when one line is wrong", async () => {
    const ctx = await ctxFor(pm);
    const before = await db.task.count();
    const r = await saveWeekPlan(db, { actor: actor(pm), ctx, lines: [line({}), line({ personId: outsider })], now: NOW });
    expect(r.ok).toBe(false);
    expect(await db.task.count()).toBe(before);
  });

  it("creates every line as a task with its day, time, priority, hours and when it was assigned", async () => {
    const ctx = await ctxFor(pm);
    const r = await saveWeekPlan(db, { actor: actor(pm), ctx, now: NOW, lines: [
      line({ title: "  Homepage   copy ", priority: "HIGH", dueTime: "15:00", hours: "2.5" }),
      line({ personId: des, date: "2026-11-27", title: "Banner set" }),
    ] });
    expect(r.ok).toBe(true);
    const tasks = await db.task.findMany({ where: { projectId: site }, orderBy: { title: "asc" } });
    expect(tasks.map((t) => [t.title, t.assigneeId, t.dueDate!.toISOString().slice(0, 10), t.dueTime, t.priority, t.estimatedHours?.toString() ?? null, t.createdById])).toEqual([
      ["Banner set", des, "2026-11-27", null, "MEDIUM", null, pm],
      ["Homepage copy", dev, "2026-11-26", "15:00", "HIGH", "2.5", pm],
    ]);
    expect(tasks.every((t) => t.assignedAt?.getTime() === NOW.getTime())).toBe(true);
  });

  it("refuses a project the manager no longer plans, checked again at save time", async () => {
    const ctx = await ctxFor(pm);
    await db.project.update({ where: { id: site }, data: { managerId: pm2 } });
    const r = await saveWeekPlan(db, { actor: actor(pm), ctx, lines: [line({ title: "Too late" })], now: NOW });
    await db.project.update({ where: { id: site }, data: { managerId: pm } });
    expect(r).toEqual({ ok: false, errors: [{ line: 0, message: "This project is closed or no longer yours to plan." }] });
  });
});

describe("the Excel template", () => {
  it("reads back the rows of a template made by buildXlsx, with names, numbers, day names and times", async () => {
    const ctx = await ctxFor(pm);
    const bytes = buildXlsx([{ name: "Week plan", rows: [
      ["Person", "Project", "Day", "Task", "Priority", "Due time", "Hours"],
      ["dev doe", "PRJ-0001", "Thu", "Fix the footer", "high", "3 pm", "1"],
      ["des@p.test", "Website", "27/11/2026", "Logo variants", "", "", ""],
      [],
      ["Nobody", "Website", "Fri", "Ghost task", "", "", ""],
      ["Dev Doe", "Mobile app", "Fri", "Not my project", "", "", ""],
      ["Dev Doe", "Website", "Next Monday", "Wrong day", "", "", ""],
      ["Dev Doe", "Website", "Fri", "Odd priority", "whenever", "noonish", ""],
    ], textColumns: true }]);
    const [sheet] = await readWorkbook(Buffer.from(bytes), "plan.xlsx");
    const r = linesFromSheet(sheet.rows, ctx);
    expect(r.lines.map((l) => [l.personId, l.projectId, l.date, l.title, l.priority, l.dueTime, l.hours])).toEqual([
      [dev, site, "2026-11-26", "Fix the footer", "HIGH", "15:00", "1"],
      [des, site, "2026-11-27", "Logo variants", "MEDIUM", "", ""],
      [dev, site, "2026-11-27", "Odd priority", "MEDIUM", "", ""],
    ]);
    expect(r.skipped).toEqual([
      { row: 5, reason: 'Nobody called "Nobody" is on a project you plan.' },
      { row: 6, reason: 'No open project "Mobile app" that you plan.' },
      { row: 7, reason: '"Next Monday" is not a day of this week.' },
      { row: 8, reason: 'Priority "whenever" was not understood, so Medium was used.' },
      { row: 8, reason: 'Due time "noonish" was not understood, so it was left empty (end of the office day).' },
    ]);
  });

  it("explains a sheet without the needed columns", async () => {
    const ctx = await ctxFor(pm);
    expect(linesFromSheet([["Name", "Notes"], ["a", "b"]], ctx).skipped[0].reason).toContain("No heading row with a Task column");
    expect(linesFromSheet([["Task", "Person"], ["a", "b"]], ctx).skipped[0].reason).toBe("Missing columns: Project, Day. Use the template.");
  });

  it("reads days and times the way people type them", () => {
    const days = [{ date: "2026-11-23", label: "", working: true, past: false }, { date: "2026-11-26", label: "", working: true, past: false }];
    expect(["Mon", "monday", "MON.", "2026-11-26", "26/11/2026", "Tue", "M", ""].map((d) => readDay(d, days))).toEqual(["2026-11-23", "2026-11-23", "2026-11-23", "2026-11-26", "2026-11-26", null, null, null]);
    expect(["15:00", "9:05", "3 pm", "12 am", "15.30", "", "15", "13 pm", "24:00"].map(readTime)).toEqual(["15:00", "09:05", "15:00", "00:00", "15:30", "", null, null, null]);
  });
});

describe("copy last week", () => {
  it("brings last week's dated, assigned tasks a week later, leaving out subtasks, repeating tasks and other managers' projects", async () => {
    const parent = await db.task.create({ data: { projectId: site, title: "Weekly report", assigneeId: dev, dueDate: new Date("2026-11-17T00:00:00Z"), dueTime: "17:00", priority: "HIGH", estimatedHours: "1.5" } });
    await db.task.create({ data: { projectId: site, title: "A subtask", assigneeId: dev, dueDate: new Date("2026-11-18T00:00:00Z"), parentId: parent.id } });
    await db.task.create({ data: { projectId: site, title: "Repeats itself", assigneeId: dev, dueDate: new Date("2026-11-18T00:00:00Z"), recurrence: "WEEKLY" } });
    await db.task.create({ data: { projectId: site, title: "Nobody's", dueDate: new Date("2026-11-18T00:00:00Z") } });
    await db.task.create({ data: { projectId: app, title: "Pauls's", assigneeId: dev, dueDate: new Date("2026-11-18T00:00:00Z") } });
    const lines = await linesFromLastWeek(db, await ctxFor(pm));
    expect(lines).toEqual([{ personId: dev, projectId: site, date: "2026-11-24", title: "Weekly report", priority: "HIGH", dueTime: "17:00", hours: "1.5" }]);
  });
});

describe("the planner's week per person", () => {
  it("counts done, late and not started for the week's tasks", async () => {
    const d = (s: string) => new Date(`${s}T00:00:00Z`);
    const proj = (await db.project.create({ data: { organizationId: org, number: "PRJ-0009", name: "Counts", managerId: pm, members: { create: [{ userId: des }] } } })).id;
    await db.task.createMany({ data: [
      { projectId: proj, title: "on time", assigneeId: des, status: "DONE", dueDate: d("2026-11-24"), completedAt: new Date("2026-11-24T08:00:00Z") },
      { projectId: proj, title: "done late", assigneeId: des, status: "DONE", dueDate: d("2026-11-23"), dueTime: "10:00", completedAt: new Date("2026-11-23T09:00:00Z") },
      { projectId: proj, title: "late open", assigneeId: des, status: "IN_PROGRESS", dueDate: d("2026-11-24") },
      { projectId: proj, title: "to do later", assigneeId: des, status: "TODO", dueDate: d("2026-11-28") },
      { projectId: proj, title: "next week", assigneeId: des, status: "TODO", dueDate: d("2026-11-30") },
    ] });
    const m = await weekProgress(db, { projectWhere: { id: proj }, week: "2026-11-25", calendar: { timezone: "Asia/Karachi", workEnd: "18:30" }, now: NOW });
    expect(m.get(des)).toEqual({ total: 4, done: 2, late: 2, notStarted: 1 });
    const own = await weekProgress(db, { projectWhere: { id: proj }, week: WEEK, calendar: { timezone: "Asia/Karachi", workEnd: "18:30" }, now: NOW, onlyUserId: dev });
    expect(own.size).toBe(0);
  });
});
