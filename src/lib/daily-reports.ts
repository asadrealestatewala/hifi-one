// Daily reports: every employee writes a short end-of-day report on working days; their manager or HR sees who has
// and has not, reads them beside the day's facts (attendance, tasks finished, field visits) and can acknowledge
// each with a note and a rating. Free of Next.js imports so it can be tested against the database.
import type { PrismaClient } from "@prisma/client";
import { WEEKEND_DAYS, isDateString, workedMinutes } from "./hr-rules";

export class ReportError extends Error {}
type Db = PrismaClient;

export const MAX_DAYS_BACK = 7; // a report can still be written for up to a week back; it is then marked late
export const MIN_SUMMARY = 10;
export const REPORTS_SINCE = process.env.DAILY_REPORTS_SINCE ?? "2026-11-10"; // the day daily reports went live; nobody is marked as missing a report before it

const addDays = (s: string, n: number) => new Date(Date.parse(`${s}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const isWeekend = (s: string, weekend: readonly number[] = WEEKEND_DAYS) => weekend.includes(new Date(`${s}T00:00:00Z`).getUTCDay());

// Start and end (exclusive) of a company-local day as instants, so "finished today" means today in Karachi, not UTC.
export function dayBounds(workDate: string, timeZone: string): { gte: Date; lt: Date } {
  const offset = (d: Date) => {
    const parts = new Intl.DateTimeFormat("en-US", { timeZone, hour12: false, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }).formatToParts(d);
    const v = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
    const asUtc = Date.UTC(v("year"), v("month") - 1, v("day"), v("hour") % 24, v("minute"), v("second"));
    return (asUtc - d.getTime()) / 60_000; // minutes east of UTC
  };
  const guess = new Date(`${workDate}T00:00:00Z`);
  const gte = new Date(guess.getTime() - offset(guess) * 60_000);
  const next = new Date(`${addDays(workDate, 1)}T00:00:00Z`);
  const lt = new Date(next.getTime() - offset(next) * 60_000);
  return { gte, lt };
}

// Is a report expected from this person on this date? Not on weekends, not while on approved leave, not before they joined.
export function reportExpected(p: { workDate: string; joinDate?: string | null; leaves: { startDate: string; endDate: string }[]; weekend?: readonly number[] }): boolean {
  if (p.workDate < REPORTS_SINCE || isWeekend(p.workDate, p.weekend)) return false;
  if (p.joinDate && p.workDate < p.joinDate) return false;
  return !p.leaves.some((l) => l.startDate <= p.workDate && p.workDate <= l.endDate);
}

export async function submitDailyReport(
  db: Db,
  p: { organizationId: string; userId: string; workDate: string; today: string; summary: string; blockers?: string; plan?: string; hoursWorked?: string | number | null },
) {
  if (!isDateString(p.workDate)) throw new ReportError("Enter a valid date.");
  if (p.workDate > p.today) throw new ReportError("You cannot report on a day that has not happened yet.");
  if (p.workDate < addDays(p.today, -MAX_DAYS_BACK)) throw new ReportError(`Reports can be written for the last ${MAX_DAYS_BACK} days only. Ask HR if an older day needs one.`);
  const summary = p.summary.trim();
  if (summary.length < MIN_SUMMARY) throw new ReportError("Say what you worked on today, in at least a sentence.");
  let hours: number | null = null;
  if (p.hoursWorked !== undefined && p.hoursWorked !== null && String(p.hoursWorked).trim() !== "") {
    hours = Number(p.hoursWorked);
    if (!Number.isFinite(hours) || hours < 0 || hours > 24) throw new ReportError("Hours worked must be between 0 and 24.");
    hours = Math.round(hours * 2) / 2;
  }
  const existing = await db.dailyReport.findUnique({ where: { userId_workDate: { userId: p.userId, workDate: p.workDate } } });
  if (existing?.reviewedAt) throw new ReportError("This report has already been reviewed and can no longer be changed.");
  const data = { summary, blockers: p.blockers?.trim() || null, plan: p.plan?.trim() || null, hoursWorked: hours };
  if (existing) return { report: await db.dailyReport.update({ where: { id: existing.id }, data }), created: false };
  return { report: await db.dailyReport.create({ data: { organizationId: p.organizationId, userId: p.userId, workDate: p.workDate, late: p.workDate < p.today, ...data } }), created: true };
}

// The manager of the person, or HR (canReviewAll), acknowledges a report. Never your own.
export async function reviewDailyReport(db: Db, p: { organizationId: string; reportId: string; reviewerId: string; canReviewAll: boolean; note?: string; rating?: number | string | null }) {
  const r = await db.dailyReport.findFirst({ where: { id: p.reportId, organizationId: p.organizationId } });
  if (!r) throw new ReportError("Report not found.");
  if (r.userId === p.reviewerId) throw new ReportError("You cannot review your own report.");
  if (!p.canReviewAll) {
    const u = await db.user.findUnique({ where: { id: r.userId }, select: { managerId: true } });
    if (u?.managerId !== p.reviewerId) throw new ReportError("Only the person's manager or HR can review this report.");
  }
  let rating: number | null = null;
  if (p.rating !== undefined && p.rating !== null && String(p.rating).trim() !== "") {
    rating = Number(p.rating);
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) throw new ReportError("The rating is 1 to 5.");
  }
  return db.dailyReport.update({ where: { id: r.id }, data: { reviewedById: p.reviewerId, reviewedAt: new Date(), reviewNote: p.note?.trim() || null, rating } });
}

export type DayRow = {
  userId: string; name: string; designation: string | null; departmentId: string | null; managerId: string | null;
  expected: boolean; onLeave: boolean; report: Awaited<ReturnType<Db["dailyReport"]["findFirst"]>>;
  attendanceMinutes: number | null; tasksDone: number; visits: number;
};

// Everyone who should report on one day, with what arrived and the day's facts beside it. `managerId` narrows the
// list to one manager's direct reports (what a manager without attendance.view_all may see).
export async function dayStatus(db: Db, p: { organizationId: string; workDate: string; timeZone: string; managerId?: string; now?: Date }): Promise<DayRow[]> {
  const staff = await db.employeeProfile.findMany({
    where: { organizationId: p.organizationId, archivedAt: null, status: "ACTIVE", ...(p.managerId ? { user: { managerId: p.managerId } } : {}) },
    select: { userId: true, designation: true, joinDate: true, user: { select: { name: true, departmentId: true, managerId: true, active: true } } },
    orderBy: { user: { name: "asc" } },
  });
  const ids = staff.map((s) => s.userId);
  if (ids.length === 0) return [];
  const bounds = dayBounds(p.workDate, p.timeZone);
  const [reports, leaves, attendance, tasks, visits] = await Promise.all([
    db.dailyReport.findMany({ where: { organizationId: p.organizationId, workDate: p.workDate, userId: { in: ids } } }),
    db.leaveRequest.findMany({ where: { userId: { in: ids }, status: "APPROVED", startDate: { lte: p.workDate }, endDate: { gte: p.workDate } }, select: { userId: true, startDate: true, endDate: true } }),
    db.attendanceRecord.findMany({ where: { userId: { in: ids }, workDate: p.workDate }, include: { breaks: true } }),
    db.task.groupBy({ by: ["assigneeId"], where: { assigneeId: { in: ids }, status: "DONE", completedAt: { gte: bounds.gte, lt: bounds.lt } }, _count: true }),
    db.prospectVisit.groupBy({ by: ["agentId"], where: { organizationId: p.organizationId, agentId: { in: ids }, visitedAt: { gte: bounds.gte, lt: bounds.lt } }, _count: true }),
  ]);
  const rep = new Map(reports.map((r) => [r.userId, r]));
  const att = new Map(attendance.map((a) => [a.userId, workedMinutes(a, a.breaks, p.now).worked]));
  const done = new Map(tasks.map((t) => [t.assigneeId!, t._count]));
  const vis = new Map(visits.map((v) => [v.agentId, v._count]));
  return staff.filter((s) => s.user.active).map((s) => {
    const mine = leaves.filter((l) => l.userId === s.userId);
    const onLeave = mine.length > 0;
    return {
      userId: s.userId, name: s.user.name, designation: s.designation, departmentId: s.user.departmentId, managerId: s.user.managerId,
      expected: reportExpected({ workDate: p.workDate, joinDate: s.joinDate ? s.joinDate.toISOString().slice(0, 10) : null, leaves: mine }), onLeave,
      report: rep.get(s.userId) ?? null, attendanceMinutes: att.get(s.userId) ?? null, tasksDone: done.get(s.userId) ?? 0, visits: vis.get(s.userId) ?? 0,
    };
  });
}

// The people who owed a report on a working day and did not write one (used by the morning reminder).
export async function missingReports(db: Db, organizationId: string, workDate: string, timeZone: string) {
  const rows = await dayStatus(db, { organizationId, workDate, timeZone });
  return rows.filter((r) => r.expected && !r.report);
}

// A person's own recent days: which working days were covered and which were missed.
export async function myRecentDays(db: Db, p: { organizationId: string; userId: string; today: string; days?: number }) {
  const n = p.days ?? 14;
  const from = addDays(p.today, -(n - 1));
  const [reports, leaves, profile] = await Promise.all([
    db.dailyReport.findMany({ where: { userId: p.userId, workDate: { gte: from, lte: p.today } }, orderBy: { workDate: "desc" } }),
    db.leaveRequest.findMany({ where: { userId: p.userId, status: "APPROVED", endDate: { gte: from }, startDate: { lte: p.today } }, select: { startDate: true, endDate: true } }),
    db.employeeProfile.findUnique({ where: { userId: p.userId }, select: { joinDate: true } }),
  ]);
  const rep = new Map(reports.map((r) => [r.workDate, r]));
  const out: { workDate: string; expected: boolean; report: (typeof reports)[number] | null }[] = [];
  for (let i = 0; i < n; i++) {
    const d = addDays(p.today, -i);
    out.push({ workDate: d, expected: reportExpected({ workDate: d, joinDate: profile?.joinDate?.toISOString().slice(0, 10), leaves }), report: rep.get(d) ?? null });
  }
  return out;
}
