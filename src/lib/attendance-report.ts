// Attendance report (HR's Required Changes, items 12 and 15): for a day or a month, each person's status every day:
// Present, Late (minutes past the start time and grace), Absent, On leave, Out for work (approved site visit, field
// work or work from home), Holiday or Day off, following the Working calendar. Clock-in, clock-out and worked time come
// from the clock. Covers staff with an active HR record (as the end-of-day report does), and days before a person
// joined are left blank. Also the task side of performance for a period: tasks finished on time and late, revisions,
// and how fast a project manager answered work sent for review. Free of Next.js imports so it can be tested.
import type { PrismaClient } from "@prisma/client";
import { workedMinutes } from "./hr-rules";
import { deadlineAt } from "./task-deadline";
import { type Calendar, isWorkingDate, lateMinutes } from "./working-calendar";

type Db = PrismaClient;

export const MAX_REPORT_DAYS = 31;
export type DayState = "PRESENT" | "LATE" | "ABSENT" | "LEAVE" | "OUT" | "HOLIDAY" | "OFF" | "UPCOMING" | "NOT_JOINED";
export const STATE_LABEL: Record<DayState, string> = {
  PRESENT: "Present", LATE: "Late", ABSENT: "Absent", LEAVE: "On leave", OUT: "Out for work", HOLIDAY: "Holiday", OFF: "Day off", UPCOMING: "", NOT_JOINED: "",
};
export const STATE_SHORT: Record<DayState, string> = { PRESENT: "P", LATE: "L", ABSENT: "A", LEAVE: "LV", OUT: "OW", HOLIDAY: "H", OFF: "–", UPCOMING: "", NOT_JOINED: "" };

export type DayCell = { date: string; state: DayState; clockIn: string | null; clockOut: string | null; lateMinutes: number; workedMinutes: number; note: string | null };
export type PersonTotals = { expected: number; present: number; late: number; absent: number; leave: number; out: number; workedMinutes: number; lateMinutes: number };
export type PersonRow = { userId: string; name: string; employeeNo: string; department: string | null; days: DayCell[]; totals: PersonTotals };
export type AttendanceReport = { from: string; to: string; dates: string[]; people: PersonRow[]; totals: PersonTotals };

const DAY = 86_400_000;
export const datesBetween = (from: string, to: string) => {
  const out: string[] = [];
  for (let t = Date.parse(`${from}T00:00:00Z`), end = Date.parse(`${to}T00:00:00Z`); t <= end && out.length < 400; t += DAY) out.push(new Date(t).toISOString().slice(0, 10));
  return out;
};
const time = (d: Date, tz: string) => d.toLocaleTimeString("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hour12: false });
const zero = (): PersonTotals => ({ expected: 0, present: 0, late: 0, absent: 0, leave: 0, out: 0, workedMinutes: 0, lateMinutes: 0 });

// One person's day. Pure: precedence is the clock first (someone who came in on a holiday was present), then holiday,
// day off, approved leave, approved out-of-office work, then absent for a working day that has started.
export function dayState(p: {
  date: string; today: string; nowTime: string; calendar: Pick<Calendar, "workDays" | "workStart" | "graceMinutes" | "workEnd">; holidays: readonly string[]; holidayName?: string | null;
  joined: string | null; clockIn: string | null; leave: string | null; out: string | null;
}): { state: DayState; late: number; note: string | null } {
  if (p.joined && p.date < p.joined) return { state: "NOT_JOINED", late: 0, note: null };
  const working = isWorkingDate(p.calendar, p.date, p.holidays);
  if (p.clockIn) {
    const late = working ? lateMinutes(p.calendar, p.clockIn) : 0;
    return { state: late > 0 ? "LATE" : "PRESENT", late, note: !working ? (p.holidayName ? `Worked on ${p.holidayName}` : "Worked on a day off") : p.out };
  }
  if (p.holidays.includes(p.date)) return { state: "HOLIDAY", late: 0, note: p.holidayName ?? null };
  if (!working) return { state: "OFF", late: 0, note: null };
  if (p.leave) return { state: "LEAVE", late: 0, note: p.leave };
  if (p.out) return { state: "OUT", late: 0, note: p.out };
  if (p.date > p.today) return { state: "UPCOMING", late: 0, note: null };
  // today counts as absent only once the start time and grace have passed
  if (p.date === p.today && lateMinutes(p.calendar, p.nowTime) === 0) return { state: "UPCOMING", late: 0, note: "Not in yet" };
  return { state: "ABSENT", late: 0, note: null };
}

export async function attendanceReport(db: Db, p: {
  organizationId: string; from: string; to: string; calendar: Calendar; holidays: { date: string; name: string }[]; now?: Date; userIds?: string[]; departmentId?: string;
}): Promise<AttendanceReport> {
  const now = p.now ?? new Date();
  const tz = p.calendar.timezone;
  const today = now.toLocaleDateString("en-CA", { timeZone: tz });
  const nowTime = time(now, tz);
  const dates = datesBetween(p.from, p.to).slice(0, MAX_REPORT_DAYS);
  const to = dates[dates.length - 1] ?? p.from;
  const staff = await db.employeeProfile.findMany({
    where: { organizationId: p.organizationId, archivedAt: null, status: "ACTIVE", user: { active: true, ...(p.departmentId ? { departmentId: p.departmentId } : {}) }, ...(p.userIds ? { userId: { in: p.userIds } } : {}) },
    select: { userId: true, employeeNo: true, joinDate: true, user: { select: { name: true, department: { select: { name: true } } } } },
    orderBy: { user: { name: "asc" } },
  });
  const ids = staff.map((s) => s.userId);
  const [records, leaves, visits] = ids.length === 0 ? [[], [], []] : await Promise.all([
    db.attendanceRecord.findMany({ where: { userId: { in: ids }, workDate: { gte: p.from, lte: to } }, include: { breaks: true } }),
    db.leaveRequest.findMany({ where: { userId: { in: ids }, status: "APPROVED", startDate: { lte: to }, endDate: { gte: p.from } }, select: { userId: true, startDate: true, endDate: true, leaveType: { select: { name: true } } } }),
    db.siteVisitRequest.findMany({ where: { organizationId: p.organizationId, userId: { in: ids }, status: "APPROVED", startDate: { lte: to }, endDate: { gte: p.from } }, select: { userId: true, startDate: true, endDate: true, kind: true, location: true } }),
  ]);
  const holidayDates = p.holidays.map((h) => h.date);
  const holidayName = new Map(p.holidays.map((h) => [h.date, h.name]));
  const rec = new Map(records.map((r) => [`${r.userId}|${r.workDate}`, r]));
  const VISIT: Record<string, string> = { SITE_VISIT: "Site or client visit", FIELD_WORK: "Field work", WORK_FROM_HOME: "Work from home" };
  const all = zero();
  const people: PersonRow[] = staff.map((s) => {
    const totals = zero();
    const joined = s.joinDate ? s.joinDate.toISOString().slice(0, 10) : null;
    const days = dates.map((date): DayCell => {
      const r = rec.get(`${s.userId}|${date}`);
      const lv = leaves.find((l) => l.userId === s.userId && l.startDate <= date && date <= l.endDate);
      const vs = visits.find((v) => v.userId === s.userId && v.startDate <= date && date <= v.endDate);
      const clockIn = r ? time(r.clockIn, tz) : null;
      const st = dayState({ date, today, nowTime, calendar: p.calendar, holidays: holidayDates, holidayName: holidayName.get(date), joined, clockIn, leave: lv ? lv.leaveType.name : null, out: vs ? [VISIT[vs.kind] ?? vs.kind, vs.location].filter(Boolean).join(", ") : null });
      const worked = r ? workedMinutes(r, r.breaks, now).worked : 0;
      const expected = isWorkingDate(p.calendar, date, holidayDates) && st.state !== "NOT_JOINED" && st.state !== "UPCOMING";
      if (expected) totals.expected++;
      if (st.state === "PRESENT" || st.state === "LATE") totals.present++;
      if (st.state === "LATE") { totals.late++; totals.lateMinutes += st.late; }
      if (st.state === "ABSENT") totals.absent++;
      if (st.state === "LEAVE") totals.leave++;
      if (st.state === "OUT") totals.out++;
      totals.workedMinutes += worked;
      return { date, state: st.state, clockIn, clockOut: r?.clockOut ? time(r.clockOut, tz) : null, lateMinutes: st.late, workedMinutes: worked, note: st.note };
    });
    for (const k of Object.keys(all) as (keyof PersonTotals)[]) all[k] += totals[k];
    return { userId: s.userId, name: s.user.name, employeeNo: s.employeeNo, department: s.user.department?.name ?? null, days, totals };
  });
  return { from: p.from, to, dates, people, totals: all };
}

// ---------- task performance for a period ----------

export type TaskPerformance = { done: number; onTime: number; late: number; noDeadline: number; revisions: number; reviewsAnswered: number; avgResponseMinutes: number | null };

// Per person: tasks they finished in the period (on time or after the deadline), revisions asked on their work, and, for
// project managers, how many reviews they answered and how long that took on average (wall clock).
export async function taskPerformance(db: Db, p: { organizationId: string; from: string; to: string; calendar: Pick<Calendar, "timezone" | "workEnd">; userIds?: string[] }): Promise<Map<string, TaskPerformance>> {
  const since = new Date(`${p.from}T00:00:00Z`), until = new Date(Date.parse(`${p.to}T00:00:00Z`) + DAY);
  // a day wide either side, then filtered by the company date of completion
  const wideFrom = new Date(since.getTime() - DAY), wideTo = new Date(until.getTime() + DAY);
  const day = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: p.calendar.timezone });
  const scope = { project: { organizationId: p.organizationId } };
  const [done, reviews] = await Promise.all([
    db.task.findMany({ where: { ...scope, status: "DONE", completedAt: { gte: wideFrom, lt: wideTo }, assigneeId: p.userIds ? { in: p.userIds } : { not: null } }, select: { assigneeId: true, dueDate: true, dueTime: true, completedAt: true } }),
    db.taskReview.findMany({ where: { task: scope, respondedAt: { gte: wideFrom, lt: wideTo } }, select: { submittedById: true, submittedAt: true, respondedById: true, respondedAt: true, outcome: true, task: { select: { assigneeId: true } } } }),
  ]);
  const out = new Map<string, TaskPerformance & { responseTotal: number }>();
  const get = (id: string) => { let r = out.get(id); if (!r) { r = { done: 0, onTime: 0, late: 0, noDeadline: 0, revisions: 0, reviewsAnswered: 0, avgResponseMinutes: null, responseTotal: 0 }; out.set(id, r); } return r; };
  const inPeriod = (d: Date) => { const s = day(d); return s >= p.from && s <= p.to; };
  for (const t of done) {
    if (!t.completedAt || !inPeriod(t.completedAt)) continue;
    const r = get(t.assigneeId!);
    r.done++;
    const at = deadlineAt(t.dueDate, t.dueTime, p.calendar);
    if (!at) r.noDeadline++; else if (t.completedAt > at) r.late++; else r.onTime++;
  }
  const wanted = p.userIds ? new Set(p.userIds) : null;
  for (const v of reviews) {
    if (!v.respondedAt || !inPeriod(v.respondedAt)) continue;
    if (v.outcome === "REVISION") { const who = v.task.assigneeId ?? v.submittedById; if (!wanted || wanted.has(who)) get(who).revisions++; }
    if ((v.outcome === "APPROVED" || v.outcome === "REVISION") && v.respondedById && (!wanted || wanted.has(v.respondedById))) {
      const r = get(v.respondedById);
      r.reviewsAnswered++;
      r.responseTotal += Math.max(0, (v.respondedAt.getTime() - v.submittedAt.getTime()) / 60_000);
    }
  }
  return new Map([...out].map(([id, { responseTotal, ...r }]) => [id, { ...r, avgResponseMinutes: r.reviewsAnswered ? Math.round(responseTotal / r.reviewsAnswered) : null }]));
}
