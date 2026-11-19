// Team hours for a past or current week or month: for each person, the hours they could work (working calendar, public holidays and
// approved leave), the hours planned for them (estimates on tasks due in the period), and the hours they logged on projects, split
// into client projects and internal ones (a project with no client). Utilisation is logged hours against the working hours up to
// today (or the whole period once it is over), so a half-finished month is not shown as half empty. Only projects in the viewer's
// scope count: a project manager sees time on the projects they run, projects.manage sees every project they can see. Attendance
// (clocked hours) is HR data and is not shown here. Free of Next.js imports so it can be tested against the database.
import type { PrismaClient, Prisma } from "@prisma/client";
import { addDays, capacityHours, weekStart } from "./workload";
import type { Calendar } from "./working-calendar";

type Db = PrismaClient;
export type Period = "week" | "month";
export type HoursRow = {
  userId: string; name: string;
  availableHours: number; // whole period
  availableSoFar: number; // up to today, or the whole period once it is over
  plannedHours: number; unestimated: number;
  loggedHours: number; clientHours: number; internalHours: number; pendingHours: number;
  utilisation: number | null; // percent of availableSoFar, null when there were no working hours
};
export type HoursReport = { period: Period; from: string; to: string; label: string; prev: string; next: string; current: boolean; rows: HoursRow[]; totals: Omit<HoursRow, "userId" | "name"> };

const isDate = (s: string | undefined) => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`));
const r1 = (n: number) => Math.round(n * 10) / 10;
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

// The week (Monday to Sunday) or calendar month containing `at` (today when missing or invalid), with links to the ones around it.
export function periodRange(period: Period, at: string | undefined, today: string) {
  const d = isDate(at) ? at! : today;
  if (period === "week") {
    const from = weekStart(d), to = addDays(from, 6);
    return { from, to, label: `Week of ${from}`, prev: addDays(from, -7), next: addDays(from, 7) };
  }
  const [y, m] = d.split("-").map(Number);
  const from = `${y}-${String(m).padStart(2, "0")}-01`;
  const to = addDays(m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`, -1);
  return { from, to, label: `${MONTHS[m - 1]} ${y}`, prev: addDays(from, -1), next: addDays(to, 1) };
}

const datesBetween = (from: string, to: string) => { const out: string[] = []; for (let d = from; d <= to; d = addDays(d, 1)) out.push(d); return out; };

export async function loadHoursReport(db: Db, p: { scope: Prisma.ProjectWhereInput; organizationId: string; period: Period; at?: string; today: string; calendar: Calendar; holidays: readonly string[] }): Promise<HoursReport> {
  const range = periodRange(p.period, p.at, p.today);
  const { from, to } = range;
  const project: Prisma.ProjectWhereInput = { ...p.scope, organizationId: p.organizationId };
  const start = new Date(`${from}T00:00:00Z`), end = new Date(`${addDays(to, 1)}T00:00:00Z`);
  const [entries, planned, unestimated, members, managers] = await Promise.all([
    db.timeEntry.findMany({ where: { organizationId: p.organizationId, project, workDate: { gte: from, lte: to } }, select: { userId: true, hours: true, approval: true, project: { select: { clientId: true } } } }),
    db.task.groupBy({ by: ["assigneeId"], where: { project: { ...project, status: { not: "CANCELLED" } }, assigneeId: { not: null }, dueDate: { gte: start, lt: end } }, _sum: { estimatedHours: true } }),
    db.task.groupBy({ by: ["assigneeId"], where: { project: { ...project, status: { not: "CANCELLED" } }, assigneeId: { not: null }, dueDate: { gte: start, lt: end }, estimatedHours: null }, _count: { _all: true } }),
    db.projectMember.findMany({ where: { project: { ...project, archivedAt: null, status: { in: ["ACTIVE", "ON_HOLD"] } } }, select: { userId: true } }),
    db.project.findMany({ where: { ...project, archivedAt: null, status: { in: ["ACTIVE", "ON_HOLD"] } }, select: { managerId: true } }),
  ]);
  const ids = [...new Set([...members.map((m) => m.userId), ...managers.map((m) => m.managerId).filter((x): x is string => !!x), ...entries.map((e) => e.userId), ...planned.map((x) => x.assigneeId!)])];
  const [users, leave] = await Promise.all([
    db.user.findMany({ where: { id: { in: ids }, organizationId: p.organizationId, userType: "EMPLOYEE", OR: [{ active: true }, { id: { in: entries.map((e) => e.userId) } }] }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    db.leaveRequest.findMany({ where: { userId: { in: ids }, status: "APPROVED", startDate: { lte: to }, endDate: { gte: from } }, select: { userId: true, startDate: true, endDate: true } }),
  ]);
  const all = datesBetween(from, to);
  const soFar = all.filter((d) => d <= p.today);
  const plan = new Map(planned.map((x) => [x.assigneeId, Number(x._sum.estimatedHours ?? 0)]));
  const noEst = new Map(unestimated.map((x) => [x.assigneeId, x._count._all]));
  const rows = users.map((u): HoursRow => {
    const mine = entries.filter((e) => e.userId === u.id);
    const sum = (f: (e: (typeof mine)[number]) => boolean) => r1(mine.filter(f).reduce((n, e) => n + Number(e.hours), 0));
    const lv = leave.filter((l) => l.userId === u.id);
    const availableSoFar = capacityHours(p.calendar, soFar, p.holidays, lv);
    const loggedHours = sum(() => true);
    return {
      userId: u.id, name: u.name,
      availableHours: capacityHours(p.calendar, all, p.holidays, lv), availableSoFar,
      plannedHours: r1(plan.get(u.id) ?? 0), unestimated: noEst.get(u.id) ?? 0,
      loggedHours, clientHours: sum((e) => !!e.project.clientId), internalHours: sum((e) => !e.project.clientId), pendingHours: sum((e) => e.approval === "PENDING"),
      utilisation: availableSoFar > 0 ? Math.round((loggedHours / availableSoFar) * 100) : null,
    };
  });
  const tot = (k: keyof Omit<HoursRow, "userId" | "name" | "utilisation">) => r1(rows.reduce((n, r) => n + r[k], 0));
  const totals = {
    availableHours: tot("availableHours"), availableSoFar: tot("availableSoFar"), plannedHours: tot("plannedHours"), unestimated: tot("unestimated"),
    loggedHours: tot("loggedHours"), clientHours: tot("clientHours"), internalHours: tot("internalHours"), pendingHours: tot("pendingHours"), utilisation: null as number | null,
  };
  totals.utilisation = totals.availableSoFar > 0 ? Math.round((totals.loggedHours / totals.availableSoFar) * 100) : null;
  return { period: p.period, ...range, current: from <= p.today && p.today <= to, rows, totals };
}
