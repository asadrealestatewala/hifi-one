// The daily staff report to management (HR's Required Changes, item 5): fifteen minutes after the office closes, the owners
// (Executive dashboard) get one email and one bell notice with the day: who was present, late, absent, on leave or out
// for work; tasks finished and late; issues and reviews still open; and who has not sent the daily report. The button
// opens the attendance report for the day, where the PDF and Excel are. Once per owner per day (the job runs once a day,
// and the notice has a dedupe key). Free of Next.js imports so it can be tested against the database.
import type { PrismaClient } from "@prisma/client";
import { attendanceReport } from "./attendance-report";
import { dayBounds } from "./daily-reports";
import { appUrl, firstName, sendTemplateQuietly } from "./email-template-store";
import { notifyMany, usersWithPermission } from "./notifications";
import { deadlineAt } from "./task-deadline";
import { type Calendar, getHolidays } from "./working-calendar";
import { listed } from "./weekly-digest";

type Db = PrismaClient;
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export type OwnerDay = {
  date: string; expected: number; present: number;
  late: string[]; absent: string[]; leave: string[]; out: string[];
  tasksDone: number; tasksLate: string[]; openIssues: number; reviewsWaiting: number;
  reports: { sent: number; missing: string[] };
};

export async function ownerDay(db: Db, p: { organizationId: string; date: string; calendar: Calendar; now?: Date }): Promise<OwnerDay> {
  const now = p.now ?? new Date();
  const holidays = await getHolidays(db, p.organizationId, p.date, p.date);
  const a = await attendanceReport(db, { organizationId: p.organizationId, from: p.date, to: p.date, calendar: p.calendar, holidays, now });
  const pick = (state: string) => a.people.filter((x) => x.days[0]?.state === state);
  const b = dayBounds(p.date, p.calendar.timezone);
  const live = { project: { organizationId: p.organizationId, status: { in: ["ACTIVE", "ON_HOLD"] }, archivedAt: null } };
  const expectedIds = a.people.filter((x) => ["PRESENT", "LATE", "ABSENT", "OUT"].includes(x.days[0]?.state ?? "")).map((x) => x.userId);
  const [tasksDone, openTasks, openIssues, reviewsWaiting, reports] = await Promise.all([
    db.task.count({ where: { ...live, status: "DONE", completedAt: { gte: b.gte, lt: b.lt } } }),
    db.task.findMany({ where: { ...live, status: { not: "DONE" }, assigneeId: { not: null }, dueDate: { lte: new Date(`${p.date}T00:00:00Z`) } }, select: { title: true, dueDate: true, dueTime: true, assigneeId: true }, orderBy: [{ dueDate: "asc" }, { id: "asc" }], take: 500 }),
    db.taskIssue.count({ where: { status: "OPEN", task: live } }),
    db.taskReview.count({ where: { respondedAt: null, task: { ...live, status: "REVIEW" } } }),
    db.dailyReport.findMany({ where: { organizationId: p.organizationId, workDate: p.date, userId: { in: expectedIds } }, select: { userId: true } }),
  ]);
  const sent = new Set(reports.map((r) => r.userId));
  const lateTasks = openTasks.filter((t) => { const at = deadlineAt(t.dueDate, t.dueTime, p.calendar); return at !== null && at < now; });
  const who = new Map((await db.user.findMany({ where: { id: { in: [...new Set(lateTasks.map((t) => t.assigneeId!))] } }, select: { id: true, name: true } })).map((u) => [u.id, u.name]));
  return {
    date: p.date, expected: a.totals.expected, present: a.totals.present,
    late: pick("LATE").map((x) => `${x.name} (${x.days[0].clockIn}, ${x.days[0].lateMinutes} min)`),
    absent: pick("ABSENT").map((x) => x.name), leave: pick("LEAVE").map((x) => `${x.name} (${x.days[0].note ?? "leave"})`), out: pick("OUT").map((x) => `${x.name} (${x.days[0].note ?? "out for work"})`),
    tasksDone, tasksLate: lateTasks.map((t) => `${t.title} (${who.get(t.assigneeId!) ?? "unassigned"})`), openIssues, reviewsWaiting,
    reports: { sent: sent.size, missing: a.people.filter((x) => expectedIds.includes(x.userId) && !sent.has(x.userId)).map((x) => x.name) },
  };
}

export async function sendOwnerDaily(db: Db, p: { organizationId: string; date: string; calendar: Calendar; now?: Date }): Promise<{ sent: number; skipped?: string; day?: OwnerDay }> {
  const d = await ownerDay(db, p);
  if (d.expected === 0) return { sent: 0, skipped: "Nobody was expected at work today" };
  const owners = await usersWithPermission(db, p.organizationId, "dashboard.executive");
  if (owners.length === 0) return { sent: 0, skipped: "Nobody has the Executive dashboard", day: d };
  const people = await db.user.findMany({ where: { id: { in: owners }, active: true }, select: { id: true, name: true, email: true } });
  const path = `/hr/attendance/report?date=${p.date}`;
  const label = new Date(`${p.date}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });
  const vars = {
    date: label, present: `${d.present} of ${d.expected}`,
    late: d.late.length ? `${d.late.length}: ${listed(d.late)}` : "Nobody", absent: d.absent.length ? `${d.absent.length}: ${listed(d.absent)}` : "Nobody",
    leave: d.leave.length ? listed(d.leave) : "Nobody", out: d.out.length ? listed(d.out) : "Nobody",
    tasks_done: plural(d.tasksDone, "task"), tasks_late: d.tasksLate.length ? `${d.tasksLate.length}: ${listed(d.tasksLate)}` : "None",
    issues: d.openIssues ? `${d.openIssues} open` : "None open", reviews: d.reviewsWaiting ? `${d.reviewsWaiting} waiting for a project manager` : "None waiting",
    reports: d.reports.missing.length ? `${d.reports.sent} sent; missing: ${listed(d.reports.missing)}` : `All ${d.reports.sent} sent`,
    link: `${appUrl()}${path}`,
  };
  let sent = 0;
  for (const u of people) {
    if (u.email) {
      const r = await sendTemplateQuietly(db, { organizationId: p.organizationId, key: "owner_daily_report", to: u.email, purpose: "NOREPLY", relatedType: "OwnerDaily", relatedId: `${p.organizationId}:${p.date}`, buttonUrl: vars.link, vars: { ...vars, first_name: firstName(u.name) } });
      if (r) sent++;
    }
  }
  await notifyMany(db, people.map((u) => u.id), {
    kind: "report.owner_daily", title: `Today: ${d.present} of ${d.expected} present, ${plural(d.late.length, "late arrival")}, ${d.absent.length} absent`,
    body: `${plural(d.tasksDone, "task")} done, ${d.tasksLate.length} late${d.reports.missing.length ? `, ${d.reports.missing.length} daily report${d.reports.missing.length === 1 ? "" : "s"} missing` : ""}`,
    link: path, dedupeKey: `owner-daily:${p.organizationId}:${p.date}`,
  });
  return { sent, day: d };
}
