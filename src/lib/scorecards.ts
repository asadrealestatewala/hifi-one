// End-of-day report and scorecards. At office close (18:30 company time) the end_of_day_report job writes one DayScorecard
// per employee who was expected to work that day: attendance against office hours, tasks finished and overdue, hours logged,
// sales activity against the person's daily target (field agents: businesses visited; office agents: prospects added plus
// calls logged), and whether the daily report arrived. Each row carries a 0 to 100 score whose parts are stored beside it, so
// HR can always see why. Monthly scorecards add the days up. Nothing here is hidden from the employee: /me/scorecard shows
// the same rows. Free of Next.js imports so it can be tested against the database.
import type { Prisma, PrismaClient } from "@prisma/client";
import { dayBounds, dayStatus } from "./daily-reports";
import { agentProfile } from "./field-visits";
import { DEFAULT_CALENDAR, type Calendar, calendarFrom, lateMinutes as lateBy } from "./working-calendar";

type Db = PrismaClient;

// Office hours now live in the working calendar (Company settings -> Working calendar), one place for the whole
// system. These are the built-in defaults, used when no calendar has been saved yet.
export const OFFICE = { start: DEFAULT_CALENDAR.workStart, end: DEFAULT_CALENDAR.workEnd, lunchMinutes: DEFAULT_CALENDAR.lunchMinutes, graceMinutes: DEFAULT_CALENDAR.graceMinutes } as const;
export const DEFAULT_OFFICE = calendarFrom(null, "UTC");
export const FULL_DAY_MINUTES = DEFAULT_OFFICE.fullDayMinutes;

// Score parts (out of 100). Attendance and punctuality come from the clock, the report from My Daily Report, and output from
// the target for sales agents or from the manager's rating for everyone else (a sent report without a rating yet earns half).
export const SCORE = { attendance: 30, punctuality: 10, report: 20, output: 40 } as const;
export type ScoreParts = { attendance: number; punctuality: number; report: number; output: number; outputBasis: "target" | "rating" | "report" | "none" };

export const hhmm = (d: Date, timeZone: string) => d.toLocaleTimeString("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hour12: false });


export function scoreDay(p: { attendanceMinutes: number; lateMinutes: number; reportStatus: string; target: number | null; activity: number; rating: number | null; fullDayMinutes?: number }): { score: number; parts: ScoreParts } {
  const fullDay = p.fullDayMinutes && p.fullDayMinutes > 0 ? p.fullDayMinutes : FULL_DAY_MINUTES;
  const attendance = Math.round(Math.min(1, p.attendanceMinutes / fullDay) * SCORE.attendance);
  const punctuality = p.attendanceMinutes === 0 ? 0 : Math.max(0, SCORE.punctuality - Math.ceil(p.lateMinutes / 10) * 2);
  const report = p.reportStatus === "SENT" ? SCORE.report : p.reportStatus === "LATE" ? SCORE.report / 2 : 0;
  let output = 0;
  let outputBasis: ScoreParts["outputBasis"] = "none";
  if (p.target !== null && p.target > 0) { output = Math.round(Math.min(1, p.activity / p.target) * SCORE.output); outputBasis = "target"; }
  else if (p.rating) { output = Math.round((p.rating / 5) * SCORE.output); outputBasis = "rating"; }
  else if (p.reportStatus !== "MISSING") { output = SCORE.output / 2; outputBasis = "report"; }
  const parts = { attendance, punctuality, report, output, outputBasis };
  return { score: attendance + punctuality + report + output, parts };
}

export type DaySnapshot = Omit<Prisma.DayScorecardUncheckedCreateInput, "id" | "generatedAt"> & { name: string };

// What one company-local day looked like for everyone with an HR record. Pure read; `generateEndOfDay` stores it.
export async function snapshotDay(db: Db, p: { organizationId: string; workDate: string; timeZone: string; now?: Date; calendar?: Calendar; holidays?: readonly string[] }): Promise<DaySnapshot[]> {
  const cal = p.calendar ?? DEFAULT_OFFICE;
  const rows = await dayStatus(db, { organizationId: p.organizationId, workDate: p.workDate, timeZone: p.timeZone, now: p.now, weekend: cal.weekendDays, holidays: p.holidays });
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.userId);
  const b = dayBounds(p.workDate, p.timeZone);
  const [attendance, overdue, hours, prospects, outreach, demos, profiles] = await Promise.all([
    db.attendanceRecord.findMany({ where: { userId: { in: ids }, workDate: p.workDate }, select: { userId: true, clockIn: true, clockOut: true } }),
    db.task.groupBy({ by: ["assigneeId"], where: { assigneeId: { in: ids }, status: { not: "DONE" }, dueDate: { lt: b.lt }, project: { organizationId: p.organizationId, status: { in: ["ACTIVE", "ON_HOLD"] } } }, _count: true }),
    db.timeEntry.groupBy({ by: ["userId"], where: { organizationId: p.organizationId, userId: { in: ids }, workDate: p.workDate }, _sum: { hours: true } }),
    db.prospect.groupBy({ by: ["addedById"], where: { organizationId: p.organizationId, addedById: { in: ids }, createdAt: { gte: b.gte, lt: b.lt } }, _count: true }),
    db.prospectOutreach.groupBy({ by: ["userId"], where: { organizationId: p.organizationId, userId: { in: ids }, createdAt: { gte: b.gte, lt: b.lt } }, _count: true }),
    db.demoBooking.groupBy({ by: ["requestedById"], where: { organizationId: p.organizationId, requestedById: { in: ids }, requestedAt: { gte: b.gte, lt: b.lt } }, _count: true }),
    db.salesAgentProfile.findMany({ where: { organizationId: p.organizationId, userId: { in: ids } }, select: { userId: true } }),
  ]);
  const att = new Map(attendance.map((a) => [a.userId, a]));
  const od = new Map(overdue.map((t) => [t.assigneeId!, t._count]));
  const hrs = new Map(hours.map((h) => [h.userId, Number(h._sum.hours ?? 0)]));
  const added = new Map(prospects.map((x) => [x.addedById!, x._count]));
  const calls = new Map(outreach.map((x) => [x.userId, x._count]));
  const dem = new Map(demos.map((x) => [x.requestedById, x._count]));
  const isAgent = new Set(profiles.map((x) => x.userId));
  const out: DaySnapshot[] = [];
  for (const r of rows) {
    const a = att.get(r.userId);
    const clockIn = a ? hhmm(a.clockIn, p.timeZone) : null;
    const lateMinutes = lateBy(cal, clockIn);
    const agent = isAgent.has(r.userId) ? await agentProfile(db, p.organizationId, r.userId) : null;
    const prospectsAdded = added.get(r.userId) ?? 0;
    const calledCount = calls.get(r.userId) ?? 0;
    const activity = agent ? (agent.kind === "FIELD" ? r.visits : prospectsAdded + calledCount) : 0;
    const reportStatus = r.report ? (r.report.late ? "LATE" : "SENT") : "MISSING";
    const rating = r.report?.rating ?? null;
    const target = agent ? agent.dailyVisitTarget : null;
    const s = r.expected ? scoreDay({ attendanceMinutes: r.attendanceMinutes ?? 0, lateMinutes, reportStatus, target, activity, rating, fullDayMinutes: cal.fullDayMinutes }) : { score: 0, parts: { attendance: 0, punctuality: 0, report: 0, output: 0, outputBasis: "none" as const } };
    out.push({
      organizationId: p.organizationId, userId: r.userId, name: r.name, workDate: p.workDate, expected: r.expected,
      clockIn, clockOut: a?.clockOut ? hhmm(a.clockOut, p.timeZone) : null, attendanceMinutes: r.attendanceMinutes ?? 0, lateMinutes,
      tasksDone: r.tasksDone, tasksOverdue: od.get(r.userId) ?? 0, hoursLogged: hrs.get(r.userId) ?? 0,
      salesKind: agent?.kind ?? null, activity, target, prospectsAdded, outreach: calledCount, visits: r.visits, demosRequested: dem.get(r.userId) ?? 0,
      reportStatus, rating, score: s.score, scoreParts: s.parts,
    });
  }
  return out;
}

// Write (or rewrite) the day's rows. Rerunning replaces the rows with fresher facts, so a late report or a corrected clock-out is picked up.
export async function generateEndOfDay(db: Db, p: { organizationId: string; workDate: string; timeZone: string; now?: Date; calendar?: Calendar; holidays?: readonly string[] }) {
  const snaps = await snapshotDay(db, p);
  // A day nobody is expected to work (weekend, holiday, before the feature went live) leaves no rows behind
  const anyone = snaps.some((s) => s.expected);
  for (const s of anyone ? snaps : []) {
    const { name: _name, ...data } = s;
    void _name;
    await db.dayScorecard.upsert({ where: { userId_workDate: { userId: s.userId, workDate: s.workDate } }, create: data, update: { ...data, generatedAt: new Date() } });
  }
  const expected = snaps.filter((s) => s.expected);
  return {
    rows: anyone ? snaps : [], expected: expected.length, reported: expected.filter((s) => s.reportStatus !== "MISSING").length,
    missing: expected.filter((s) => s.reportStatus === "MISSING"), belowTarget: expected.filter((s) => s.target && (s.activity ?? 0) < s.target),
    absent: expected.filter((s) => (s.attendanceMinutes ?? 0) === 0),
  };
}

export type MonthRow = {
  userId: string; name: string; days: number; present: number; avgMinutes: number; lateDays: number; reportsSent: number; reportsLate: number; avgRating: number | null;
  tasksDone: number; hoursLogged: number; salesKind: string | null; activity: number; target: number; demosRequested: number; avgScore: number;
};

// One row per employee for a month (YYYY-MM): the expected days and what the day rows add up to.
export async function monthlyScorecards(db: Db, p: { organizationId: string; month: string; userId?: string }): Promise<MonthRow[]> {
  const rows = await db.dayScorecard.findMany({ where: { organizationId: p.organizationId, workDate: { startsWith: p.month }, expected: true, ...(p.userId ? { userId: p.userId } : {}) }, orderBy: { workDate: "asc" } });
  const names = new Map((await db.user.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.userId))] } }, select: { id: true, name: true } })).map((u) => [u.id, u.name]));
  const by = new Map<string, MonthRow & { minutes: number; ratings: number[]; scores: number[] }>();
  for (const r of rows) {
    const m = by.get(r.userId) ?? { userId: r.userId, name: names.get(r.userId) ?? "Unknown", days: 0, present: 0, avgMinutes: 0, lateDays: 0, reportsSent: 0, reportsLate: 0, avgRating: null, tasksDone: 0, hoursLogged: 0, salesKind: r.salesKind, activity: 0, target: 0, demosRequested: 0, avgScore: 0, minutes: 0, ratings: [], scores: [] };
    m.days++; if (r.attendanceMinutes > 0) m.present++; m.minutes += r.attendanceMinutes; if (r.lateMinutes > 0) m.lateDays++;
    if (r.reportStatus === "SENT") m.reportsSent++; else if (r.reportStatus === "LATE") { m.reportsSent++; m.reportsLate++; }
    if (r.rating) m.ratings.push(r.rating);
    m.tasksDone += r.tasksDone; m.hoursLogged += Number(r.hoursLogged); m.activity += r.activity; m.target += r.target ?? 0; m.demosRequested += r.demosRequested; m.scores.push(r.score);
    if (r.salesKind) m.salesKind = r.salesKind;
    by.set(r.userId, m);
  }
  return [...by.values()].map(({ minutes, ratings, scores, ...m }) => ({
    ...m, avgMinutes: m.present ? Math.round(minutes / m.present) : 0, avgRating: ratings.length ? Math.round((ratings.reduce((a, b) => a + b, 0) / ratings.length) * 10) / 10 : null,
    avgScore: scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : 0, hoursLogged: Math.round(m.hoursLogged * 100) / 100,
  })).sort((a, b) => b.avgScore - a.avgScore || a.name.localeCompare(b.name));
}

export const dayRowsFor = (db: Db, organizationId: string, workDate: string) =>
  db.dayScorecard.findMany({ where: { organizationId, workDate }, orderBy: [{ expected: "desc" }, { score: "desc" }] });
