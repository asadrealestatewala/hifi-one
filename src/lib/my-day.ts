// What today asks of one person: the clock, the daily report, circulars waiting to be confirmed, tasks due and
// overdue, and the meetings still to come. The home screen and the My day page both read this, so the greeting on
// the dashboard can never say "nothing needs your attention" while the daily report is missing.
// Free of Next.js imports so it can be tested against the database.
import type { PrismaClient } from "@prisma/client";
import { REPORTS_SINCE, dayBounds } from "./daily-reports";
import { workedMinutes } from "./hr-rules";
import { type Calendar, DAY_NAMES, dayOfWeek, isWorkingDate } from "./working-calendar";
import { countdown, deadlineAt } from "./task-deadline";

type Db = PrismaClient;

export type ClockState = "NOT_STARTED" | "WORKING" | "ON_BREAK" | "FINISHED";
export type ReportState = "SENT" | "LATE" | "MISSING" | "NOT_EXPECTED";
export type DayKind = { working: boolean; reason: string | null }; // reason is filled only when today is not a working day

// One thing the person still has to do today. `tone` decides how loudly the home screen says it.
export type DayItem = { id: string; icon: string; tone: "primary" | "warning" | "danger"; text: string; sub?: string; href: string };

// The soonest deadline still ahead today, with its countdown as it was when the page loaded
export type NextDeadline = { id: string; title: string; projectId: string; left: string; tone: "green" | "orange" | "red"; at: string };

export type MyDay = {
  date: string;
  kind: DayKind;
  clock: { state: ClockState; since: Date | null; workedMinutes: number; breaks: number };
  report: ReportState;
  circulars: number;
  tasks: { dueToday: number; overdue: number; open: number; next?: NextDeadline | null };
  meetings: { id: string; title: string; at: Date | null; live: boolean }[];
  items: DayItem[];
};

// Why today is not a working day for this person, or null when it is one.
export function dayKindFor(p: { date: string; calendar: Pick<Calendar, "workDays">; holidayName?: string | null; onLeave?: string | null }): DayKind {
  if (p.onLeave) return { working: false, reason: `You are on approved leave (${p.onLeave}).` };
  if (p.holidayName) return { working: false, reason: `${p.holidayName} — a public holiday.` };
  if (!isWorkingDate(p.calendar, p.date)) return { working: false, reason: `${DAY_NAMES[dayOfWeek(p.date)]} is a weekly off.` };
  return { working: true, reason: null };
}

// The to-do list, in the order a person would work through it. Pure, so the rules are testable on their own.
export function dayItems(d: Omit<MyDay, "items">, opts: { canAttendance: boolean; canReport: boolean }): DayItem[] {
  const items: DayItem[] = [];
  if (d.kind.working && opts.canAttendance && d.clock.state === "NOT_STARTED") {
    items.push({ id: "clock-in", icon: "clock", tone: "warning", text: "Clock in for today", sub: "Your attendance starts when you do", href: "/me/attendance" });
  }
  if (d.kind.working && opts.canAttendance && d.clock.state === "ON_BREAK") {
    items.push({ id: "break", icon: "clock", tone: "primary", text: "You are on a break", sub: "End the break when you are back", href: "/me/attendance" });
  }
  if (d.kind.working && opts.canAttendance && d.clock.state === "WORKING") {
    items.push({ id: "clock-out", icon: "clock", tone: "primary", text: "Clock out before you leave", sub: "A session left open has to be corrected by HR", href: "/me/attendance" });
  }
  if (opts.canReport && d.report === "MISSING" && d.kind.working) {
    items.push({ id: "report", icon: "file", tone: "warning", text: "Write today's daily report", sub: "A few lines: what you did, anything blocking you", href: "/me/report" });
  }
  if (d.circulars > 0) {
    items.push({ id: "circulars", icon: "bell", tone: "primary", text: `${d.circulars} circular${d.circulars === 1 ? "" : "s"} to confirm you have read`, href: "/me/circulars" });
  }
  if (d.tasks.overdue > 0) {
    items.push({ id: "tasks-overdue", icon: "check", tone: "danger", text: `${d.tasks.overdue} of your tasks ${d.tasks.overdue === 1 ? "is" : "are"} overdue`, href: "/me/tasks" });
  }
  if (d.tasks.next) {
    const n = d.tasks.next;
    items.push({ id: "next-deadline", icon: "clock", tone: n.tone === "green" ? "primary" : n.tone === "orange" ? "warning" : "danger", text: `Next deadline: ${n.title}`, sub: `${n.left} · due ${n.at}`, href: `/projects/${n.projectId}?task=${n.id}` });
  }
  if (d.tasks.dueToday > 0) {
    items.push({ id: "tasks-today", icon: "check", tone: "primary", text: `${d.tasks.dueToday} task${d.tasks.dueToday === 1 ? "" : "s"} due today`, href: "/me/tasks" });
  }
  for (const m of d.meetings) {
    items.push({ id: `meeting-${m.id}`, icon: "video", tone: m.live ? "warning" : "primary", text: m.live ? `${m.title} is live now` : m.title, sub: m.live ? undefined : m.at?.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" }), href: `/meetings/${m.id}` });
  }
  return items;
}

export async function loadMyDay(
  db: Db,
  p: { organizationId: string; userId: string; permissions: ReadonlySet<string>; date: string; timeZone: string; calendar: Calendar; holidayName?: string | null; now?: Date },
): Promise<MyDay> {
  const now = p.now ?? new Date();
  const has = (k: string) => p.permissions.has(k);
  const bounds = dayBounds(p.date, p.timeZone);
  const [attendance, report, leave, circulars, overdue, dueToday, open, meetings] = await Promise.all([
    db.attendanceRecord.findFirst({ where: { userId: p.userId, workDate: p.date }, include: { breaks: true } }),
    db.dailyReport.findUnique({ where: { userId_workDate: { userId: p.userId, workDate: p.date } }, select: { late: true } }),
    db.leaveRequest.findFirst({ where: { userId: p.userId, status: "APPROVED", startDate: { lte: p.date }, endDate: { gte: p.date } }, select: { leaveType: { select: { name: true } } } }),
    db.circularRecipient.count({ where: { userId: p.userId, ackAt: null, circular: { organizationId: p.organizationId } } }),
    db.task.count({ where: { assigneeId: p.userId, status: { not: "DONE" }, dueDate: { lt: bounds.gte }, project: { organizationId: p.organizationId, status: { not: "CANCELLED" }, archivedAt: null } } }),
    db.task.count({ where: { assigneeId: p.userId, status: { not: "DONE" }, dueDate: { gte: bounds.gte, lt: bounds.lt }, project: { organizationId: p.organizationId, status: { not: "CANCELLED" }, archivedAt: null } } }),
    db.task.count({ where: { assigneeId: p.userId, status: { not: "DONE" }, project: { organizationId: p.organizationId, status: { not: "CANCELLED" }, archivedAt: null } } }),
    has("meetings.use")
      ? db.meeting.findMany({
          where: { organizationId: p.organizationId, purpose: { not: "CALL" }, status: { in: ["SCHEDULED", "LIVE"] }, scheduledAt: { gte: bounds.gte, lt: bounds.lt }, OR: [{ hostId: p.userId }, { participants: { some: { userId: p.userId } } }] },
          orderBy: { scheduledAt: "asc" }, take: 3, select: { id: true, title: true, status: true, scheduledAt: true },
        })
      : [],
  ]);
  const todays = dueToday > 0
    ? await db.task.findMany({ where: { assigneeId: p.userId, status: { not: "DONE" }, dueDate: { gte: new Date(`${p.date}T00:00:00.000Z`), lt: new Date(new Date(`${p.date}T00:00:00.000Z`).getTime() + 86_400_000) }, project: { organizationId: p.organizationId, status: { not: "CANCELLED" }, archivedAt: null } }, select: { id: true, title: true, projectId: true, dueDate: true, dueTime: true, assignedAt: true, createdAt: true }, take: 200 })
    : [];
  const ahead = todays.map((t) => ({ t, at: deadlineAt(t.dueDate, t.dueTime, p.calendar)! })).filter((x) => x.at > now).sort((a, b) => a.at.getTime() - b.at.getTime())[0];
  const nextCount = ahead ? countdown(ahead.at, now, ahead.t.assignedAt ?? ahead.t.createdAt) : null;
  const next: NextDeadline | null = ahead && nextCount && nextCount.tone !== "overdue"
    ? { id: ahead.t.id, title: ahead.t.title, projectId: ahead.t.projectId, left: nextCount.text, tone: nextCount.tone, at: ahead.at.toLocaleTimeString("en-US", { timeZone: p.calendar.timezone, hour: "numeric", minute: "2-digit" }) }
    : null;
  const kind = dayKindFor({ date: p.date, calendar: p.calendar, holidayName: p.holidayName, onLeave: leave?.leaveType.name ?? null });
  const openBreak = attendance?.breaks.some((b) => !b.endAt) ?? false;
  const worked = attendance ? workedMinutes(attendance, attendance.breaks, now) : null;
  const state: ClockState = !attendance ? "NOT_STARTED" : attendance.clockOut ? "FINISHED" : openBreak ? "ON_BREAK" : "WORKING";
  const reportState: ReportState = report ? (report.late ? "LATE" : "SENT") : !kind.working || p.date < REPORTS_SINCE ? "NOT_EXPECTED" : "MISSING";
  const base: Omit<MyDay, "items"> = {
    date: p.date, kind,
    clock: { state, since: attendance?.clockIn ?? null, workedMinutes: worked?.worked ?? 0, breaks: worked?.breaks ?? 0 },
    report: reportState, circulars,
    tasks: { dueToday, overdue, open, next },
    meetings: meetings.map((m) => ({ id: m.id, title: m.title, at: m.scheduledAt, live: m.status === "LIVE" })),
  };
  return { ...base, items: dayItems(base, { canAttendance: has("self.attendance"), canReport: has("self.attendance") }) };
}
