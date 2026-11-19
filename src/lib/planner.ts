// Weekly planner: one row per person, one column per day of a Monday-to-Sunday week. Each open task sits on the day it is due,
// and each day shows the estimates due that day against the hours the person can work (working calendar, public holidays,
// approved leave). A tray beside the grid holds open tasks with no due date and tasks already overdue, so they can be dragged
// onto a day. Moving a task changes its due date and, when it lands on another person's row, its assignee, in one step.
// Only the project's manager (or projects.manage) may move a task. Free of Next.js imports so it can be tested against the database.
import type { Prisma, PrismaClient } from "@prisma/client";
import { TaskError } from "./tasks";
import { type Calendar, isWorkingDate } from "./working-calendar";
import { addDays, weekStart } from "./workload";

type Db = PrismaClient;

export const TRAY_LIMIT = 60; // tasks shown in the tray; the count says how many more there are
export const CELL_LIMIT = 200; // tasks loaded for the grid in one week

export type PlannerTask = {
  id: string; title: string; projectId: string; project: string; assigneeId: string | null; due: string | null;
  hours: number | null; priority: string; status: string; overdue: boolean; canMove: boolean;
};
export type PlannerDay = { date: string; working: boolean; holiday: string | null; today: boolean };
export type PlannerCell = { date: string; capacityHours: number; plannedHours: number; unestimated: number; away: boolean; tasks: PlannerTask[] };
export type PlannerRow = { userId: string | null; name: string; plannedHours: number; capacityHours: number; cells: PlannerCell[] };
export type PlannerWeek = {
  from: string; to: string; prev: string; next: string; days: PlannerDay[];
  rows: PlannerRow[]; tray: PlannerTask[]; trayTotal: number; truncated: boolean;
  people: { id: string; name: string }[]; // who can be given work (a row each)
};

export const isDate = (s: string | null | undefined): s is string => Boolean(s && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`)));
const ymd = (d: Date) => d.toISOString().slice(0, 10);
const round1 = (n: number) => Math.round(n * 10) / 10;

// The Monday of the requested week, or of this week when nothing (or nonsense) is asked for.
export const plannerWeekStart = (asked: string | undefined, today: string) => weekStart(isDate(asked) ? asked : today);

export async function loadPlannerWeek(db: Db, p: {
  scope: Prisma.ProjectWhereInput; // projects in view
  organizationId: string; today: string; week: string; calendar: Calendar; holidays: { date: string; name: string }[];
  actor: { id: string; permissions: ReadonlySet<string> };
  onlyUserId?: string; // a person without management rights sees their own row only
}): Promise<PlannerWeek> {
  const from = weekStart(p.week);
  const dates = Array.from({ length: 7 }, (_, i) => addDays(from, i));
  const to = dates[6];
  const holidayName = new Map(p.holidays.map((h) => [h.date, h.name]));
  const holidayDates = p.holidays.map((h) => h.date);
  const project: Prisma.ProjectWhereInput = { ...p.scope, status: { in: ["ACTIVE", "ON_HOLD"] }, archivedAt: null };
  const open: Prisma.TaskWhereInput = { project, status: { not: "DONE" }, ...(p.onlyUserId ? { assigneeId: p.onlyUserId } : {}) };
  const select = { id: true, title: true, projectId: true, assigneeId: true, dueDate: true, estimatedHours: true, priority: true, status: true, project: { select: { name: true, managerId: true } } } as const;
  const start = new Date(`${from}T00:00:00Z`), end = new Date(`${addDays(to, 1)}T00:00:00Z`), todayStart = new Date(`${p.today}T00:00:00Z`);
  const trayWhere: Prisma.TaskWhereInput = { ...open, OR: [{ dueDate: null }, { dueDate: { lt: todayStart } }] };
  const [inWeek, tray, trayTotal, members] = await Promise.all([
    db.task.findMany({ where: { ...open, dueDate: { gte: start, lt: end } }, select, orderBy: [{ dueDate: "asc" }, { priority: "asc" }, { id: "asc" }], take: CELL_LIMIT + 1 }),
    db.task.findMany({ where: trayWhere, select, orderBy: [{ dueDate: { sort: "asc", nulls: "last" } }, { createdAt: "asc" }, { id: "asc" }], take: TRAY_LIMIT }),
    db.task.count({ where: trayWhere }),
    p.onlyUserId ? Promise.resolve([{ userId: p.onlyUserId }]) : db.projectMember.findMany({ where: { project }, select: { userId: true }, distinct: ["userId"] }),
  ]);
  const truncated = inWeek.length > CELL_LIMIT;
  const weekTasks = inWeek.slice(0, CELL_LIMIT);
  const ids = [...new Set([...members.map((m) => m.userId), ...weekTasks.map((t) => t.assigneeId).filter((x): x is string => Boolean(x))])];
  const [users, leave] = await Promise.all([
    db.user.findMany({ where: { id: { in: ids }, organizationId: p.organizationId, active: true, userType: "EMPLOYEE" }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    db.leaveRequest.findMany({ where: { userId: { in: ids }, status: "APPROVED", startDate: { lte: to }, endDate: { gte: from } }, select: { userId: true, startDate: true, endDate: true } }),
  ]);
  const manages = (managerId: string | null) => p.actor.permissions.has("projects.manage") || managerId === p.actor.id;
  const toTask = (t: (typeof weekTasks)[number]): PlannerTask => ({
    id: t.id, title: t.title, projectId: t.projectId, project: t.project.name, assigneeId: t.assigneeId,
    due: t.dueDate ? ymd(t.dueDate) : null, hours: t.estimatedHours === null ? null : Number(t.estimatedHours), priority: t.priority, status: t.status,
    overdue: Boolean(t.dueDate && ymd(t.dueDate) < p.today), canMove: manages(t.project.managerId),
  });
  const dayHours = p.calendar.fullDayMinutes / 60;
  const onLeave = (uid: string, d: string) => leave.some((l) => l.userId === uid && l.startDate <= d && d <= l.endDate);
  const known = new Set(users.map((u) => u.id));
  const rowFor = (userId: string | null, name: string): PlannerRow => {
    const cells = dates.map((date): PlannerCell => {
      const tasks = weekTasks.filter((t) => ymd(t.dueDate!) === date && (userId === null ? !t.assigneeId || !known.has(t.assigneeId) : t.assigneeId === userId)).map(toTask);
      const away = userId !== null && onLeave(userId, date);
      const capacityHours = userId === null || away || !isWorkingDate(p.calendar, date, holidayDates) ? 0 : round1(dayHours);
      return { date, tasks, away, capacityHours, plannedHours: round1(tasks.reduce((n, t) => n + (t.hours ?? 0), 0)), unestimated: tasks.filter((t) => t.hours === null).length };
    });
    return { userId, name, cells, plannedHours: round1(cells.reduce((n, c) => n + c.plannedHours, 0)), capacityHours: round1(cells.reduce((n, c) => n + c.capacityHours, 0)) };
  };
  const rows = users.map((u) => rowFor(u.id, u.name));
  const unassigned = rowFor(null, "Unassigned");
  if (!p.onlyUserId && unassigned.cells.some((c) => c.tasks.length)) rows.push(unassigned);
  return {
    from, to, prev: addDays(from, -7), next: addDays(from, 7), truncated,
    days: dates.map((date) => ({ date, working: isWorkingDate(p.calendar, date, holidayDates), holiday: holidayName.get(date) ?? null, today: date === p.today })),
    rows, tray: tray.map(toTask), trayTotal, people: users,
  };
}

export type PlanMove = { taskId: string; date: string | null; assigneeId?: string | null }; // assigneeId left out = keep the assignee

// Moves one task to a day (and optionally a person) in one step. Rules: the actor sees the project and manages it, the project is
// open, the task is not done, the date is real, and a new assignee is an active staff member on that project's team.
export async function planTask(db: Db, p: { actor: { id: string; organizationId: string; permissions: ReadonlySet<string> }; move: PlanMove }): Promise<{
  task: { id: string; title: string; projectId: string }; before: { dueDate: string | null; assigneeId: string | null }; after: { dueDate: string | null; assigneeId: string | null }; changed: boolean;
}> {
  const m = p.move;
  if (m.date !== null && !isDate(m.date)) throw new TaskError("Enter a valid date.");
  const viewAll = p.actor.permissions.has("projects.view_all");
  const t = await db.task.findFirst({
    where: { id: m.taskId, project: { organizationId: p.actor.organizationId, ...(viewAll ? {} : { OR: [{ managerId: p.actor.id }, { members: { some: { userId: p.actor.id } } }] }) } },
    select: { id: true, title: true, projectId: true, assigneeId: true, dueDate: true, status: true, project: { select: { managerId: true, status: true } } },
  });
  if (!t) throw new TaskError("Task not found.");
  if (!(p.actor.permissions.has("projects.manage") || t.project.managerId === p.actor.id)) throw new TaskError("Only the project manager can reschedule this task.");
  if (t.project.status === "COMPLETED" || t.project.status === "CANCELLED") throw new TaskError("The project is closed.");
  if (t.status === "DONE") throw new TaskError("This task is done. Reopen it before planning it again.");
  const assigneeId = m.assigneeId === undefined ? t.assigneeId : m.assigneeId;
  if (assigneeId && assigneeId !== t.assigneeId) {
    const [member, person] = await Promise.all([
      db.projectMember.findUnique({ where: { projectId_userId: { projectId: t.projectId, userId: assigneeId } }, select: { userId: true } }),
      db.user.findFirst({ where: { id: assigneeId, organizationId: p.actor.organizationId, active: true, userType: "EMPLOYEE" }, select: { id: true } }),
    ]);
    if (!member || !person) throw new TaskError("That person is not on this project's team.");
  }
  const before = { dueDate: t.dueDate ? ymd(t.dueDate) : null, assigneeId: t.assigneeId };
  const after = { dueDate: m.date, assigneeId };
  const changed = before.dueDate !== after.dueDate || before.assigneeId !== after.assigneeId;
  if (changed) await db.task.update({ where: { id: t.id }, data: { dueDate: m.date ? new Date(`${m.date}T00:00:00.000Z`) : null, assigneeId } });
  return { task: { id: t.id, title: t.title, projectId: t.projectId }, before, after, changed };
}
