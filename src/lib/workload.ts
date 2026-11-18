// Team workload for the next 7 days: for each person, the open tasks they hold, what is overdue, the estimated hours due in
// the window against the hours they can work (working calendar, holidays and approved leave), and the time they logged this
// week. Only projects the viewer can see are counted. Free of Next.js imports so it can be tested against the database.
import type { PrismaClient, Prisma } from "@prisma/client";
import { type Calendar, isWorkingDate } from "./working-calendar";

type Db = PrismaClient;
const DAY = 86_400_000;

export type LoadLevel = "AWAY" | "OVER" | "BUSY" | "OK" | "UNSIZED";
export type PersonLoad = {
  userId: string; name: string;
  open: number; overdue: number; dueInWindow: number;
  plannedHours: number; // estimates of open tasks that are overdue or due in the window
  unestimated: number; // of those tasks, how many have no estimate
  capacityHours: number; loggedHours: number; level: LoadLevel; percent: number | null;
};

export const addDays = (date: string, n: number) => new Date(new Date(`${date}T00:00:00Z`).getTime() + n * DAY).toISOString().slice(0, 10);
export const windowDates = (today: string, days = 7) => Array.from({ length: days }, (_, i) => addDays(today, i));
// Monday of the week `today` is in
export const weekStart = (today: string) => addDays(today, -((new Date(`${today}T00:00:00Z`).getUTCDay() + 6) % 7));

// Hours a person can work over the given dates: working days only, less public holidays and approved leave.
export function capacityHours(cal: Pick<Calendar, "workDays" | "fullDayMinutes">, dates: string[], holidays: readonly string[], leave: { startDate: string; endDate: string }[]): number {
  const days = dates.filter((d) => isWorkingDate(cal, d, holidays) && !leave.some((l) => l.startDate <= d && d <= l.endDate)).length;
  return Math.round((days * cal.fullDayMinutes) / 6) / 10;
}

// How full someone is. Over 100% of what they can work is over; 80% or more is busy; no working hours at all is away.
// Work due with no estimates at all can't be measured, so it says so rather than claiming there is room.
export function loadLevel(planned: number, capacity: number, unestimated = 0): { level: LoadLevel; percent: number | null } {
  if (planned === 0 && unestimated > 0 && capacity > 0) return { level: "UNSIZED", percent: 0 };
  if (capacity <= 0) return { level: planned > 0 ? "OVER" : "AWAY", percent: null };
  const percent = Math.round((planned / capacity) * 100);
  return { level: percent > 100 ? "OVER" : percent >= 80 ? "BUSY" : "OK", percent };
}

export async function loadWorkload(
  db: Db,
  p: { scope: Prisma.ProjectWhereInput; organizationId: string; today: string; calendar: Calendar; holidays: readonly string[] },
): Promise<{ people: PersonLoad[]; unassigned: number; window: { from: string; to: string } }> {
  const dates = windowDates(p.today);
  const start = new Date(`${p.today}T00:00:00Z`), end = new Date(`${addDays(p.today, 7)}T00:00:00Z`);
  const project: Prisma.ProjectWhereInput = { ...p.scope, status: { in: ["ACTIVE", "ON_HOLD"] }, archivedAt: null };
  const open: Prisma.TaskWhereInput = { project, status: { not: "DONE" } };
  const [all, late, soon, plannedRows, unestimatedRows, unassigned, members, logged] = await Promise.all([
    db.task.groupBy({ by: ["assigneeId"], where: { ...open, assigneeId: { not: null } }, _count: { _all: true } }),
    db.task.groupBy({ by: ["assigneeId"], where: { ...open, assigneeId: { not: null }, dueDate: { lt: start } }, _count: { _all: true } }),
    db.task.groupBy({ by: ["assigneeId"], where: { ...open, assigneeId: { not: null }, dueDate: { gte: start, lt: end } }, _count: { _all: true } }),
    db.task.groupBy({ by: ["assigneeId"], where: { ...open, assigneeId: { not: null }, dueDate: { lt: end } }, _sum: { estimatedHours: true } }),
    db.task.groupBy({ by: ["assigneeId"], where: { ...open, assigneeId: { not: null }, dueDate: { lt: end }, estimatedHours: null }, _count: { _all: true } }),
    db.task.count({ where: { ...open, assigneeId: null } }),
    db.projectMember.findMany({ where: { project }, select: { userId: true } }),
    db.timeEntry.groupBy({ by: ["userId"], where: { project: p.scope, workDate: { gte: weekStart(p.today), lte: p.today } }, _sum: { hours: true } }),
  ]);
  const ids = [...new Set([...members.map((m) => m.userId), ...all.map((a) => a.assigneeId!)])];
  const [users, leave] = await Promise.all([
    db.user.findMany({ where: { id: { in: ids }, organizationId: p.organizationId, active: true, userType: "EMPLOYEE" }, select: { id: true, name: true } }),
    db.leaveRequest.findMany({ where: { userId: { in: ids }, status: "APPROVED", startDate: { lte: dates[dates.length - 1] }, endDate: { gte: dates[0] } }, select: { userId: true, startDate: true, endDate: true } }),
  ]);
  const count = (rows: { assigneeId: string | null; _count: { _all: number } }[]) => new Map(rows.map((r) => [r.assigneeId, r._count._all]));
  const [cAll, cLate, cSoon, cNoEst] = [count(all), count(late), count(soon), count(unestimatedRows)];
  const planned = new Map(plannedRows.map((r) => [r.assigneeId, Number(r._sum.estimatedHours ?? 0)]));
  const hours = new Map(logged.map((r) => [r.userId, Number(r._sum.hours ?? 0)]));
  const people = users.map((u): PersonLoad => {
    const cap = capacityHours(p.calendar, dates, p.holidays, leave.filter((l) => l.userId === u.id));
    const plan = Math.round((planned.get(u.id) ?? 0) * 10) / 10;
    return {
      userId: u.id, name: u.name, open: cAll.get(u.id) ?? 0, overdue: cLate.get(u.id) ?? 0, dueInWindow: cSoon.get(u.id) ?? 0,
      plannedHours: plan, unestimated: cNoEst.get(u.id) ?? 0, capacityHours: cap, loggedHours: Math.round((hours.get(u.id) ?? 0) * 10) / 10,
      ...loadLevel(plan, cap, cNoEst.get(u.id) ?? 0),
    };
  });
  const rank: Record<LoadLevel, number> = { OVER: 0, BUSY: 1, UNSIZED: 2, OK: 3, AWAY: 4 };
  people.sort((a, b) => rank[a.level] - rank[b.level] || b.overdue - a.overdue || b.open - a.open || a.name.localeCompare(b.name));
  return { people, unassigned, window: { from: dates[0], to: dates[dates.length - 1] } };
}
