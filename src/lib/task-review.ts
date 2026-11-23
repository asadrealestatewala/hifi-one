// Work sent for review and the project manager's answer, each with its time (HR's Required Changes, items 3 and 10).
// - Moving a task to In review opens a TaskReview; leaving In review closes it with an outcome (see recordReviewMove,
//   called inside changeTaskStatus's transaction so the record and the status never disagree).
// - The project manager answers with Approve (task Done) or Revision needed with a comment (back to In progress, the
//   revision count goes up, the comment is added to the task).
// - The response clock: once a review has waited longer than the Working calendar's reviewResponseMinutes of office
//   time, owners and HR are told once (runReviewEscalations, every minute from src/lib/task-clock.ts).
import type { PrismaClient } from "@prisma/client";
import { notifyMany, usersWithPermission } from "./notifications";
import { appUrl, firstName, sendTemplateQuietly } from "./email-template-store";
import { changeTaskStatus, TaskError } from "./tasks";
import { localToUtc } from "./social-time";
import { getCalendar, getHolidays, holidayDates, isWorkingDate, type Calendar } from "./working-calendar";
import { spanText } from "./task-deadline";

type Db = PrismaClient;
const MIN = 60_000;
const LINK = (projectId: string, taskId: string) => `/projects/${projectId}?task=${taskId}`;

export { OUTCOME_LABEL, type ReviewOutcome } from "./task-review-record";

type Who = { projectId: string; taskId: string; actorId: string; now?: Date };

async function inReview(db: Db, p: Who) {
  const task = await db.task.findFirst({ where: { id: p.taskId, projectId: p.projectId }, select: { id: true, status: true, title: true, assigneeId: true, projectId: true } });
  if (!task) throw new TaskError("Task not found.");
  if (task.status !== "REVIEW") throw new TaskError("This task is not waiting for review.");
  return task;
}

// The project manager accepts the work: the task is Done (the usual Done rules apply: subtasks and checklist).
export async function approveTask(db: Db, p: Who & { comment?: string | null }) {
  await inReview(db, p);
  const comment = p.comment?.trim().slice(0, 2000) || null;
  const r = await changeTaskStatus(db, { ...p, status: "DONE", review: { outcome: "APPROVED", comment }, actorIsManager: true });
  if (comment) await db.taskComment.create({ data: { taskId: p.taskId, authorId: p.actorId, body: `Approved: ${comment}`, internal: true } });
  return r;
}

// The project manager sends the work back with what to change. A comment is required, so the person knows what to fix.
export async function requestRevision(db: Db, p: Who & { comment: string }) {
  const task = await inReview(db, p);
  const comment = p.comment.trim().slice(0, 2000);
  if (comment.length < 3) throw new TaskError("Write what needs to change.");
  const r = await changeTaskStatus(db, { ...p, status: "IN_PROGRESS", review: { outcome: "REVISION", comment }, actorIsManager: true });
  const updated = await db.task.update({ where: { id: task.id }, data: { revisionCount: { increment: 1 } }, select: { revisionCount: true } });
  await db.taskComment.create({ data: { taskId: p.taskId, authorId: p.actorId, body: `Revision needed: ${comment}`, internal: true } });
  return { ...r, revision: updated.revisionCount };
}

// ---------- the response clock ----------

// Minutes of office time between two instants: only the hours between opening and closing on working days that are not
// holidays count (lunch is not taken out; it is short and its time is not fixed). Pure.
export function officeMinutesBetween(from: Date, to: Date, cal: Pick<Calendar, "timezone" | "workStart" | "workEnd" | "workDays">, holidays: readonly string[] = []): number {
  if (to <= from) return 0;
  const dayOf = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: cal.timezone });
  let total = 0;
  let day = dayOf(from);
  const last = dayOf(to);
  for (let i = 0; i < 400 && day <= last; i++) {
    if (isWorkingDate(cal, day, holidays)) {
      const open = localToUtc(day, cal.workStart, cal.timezone).getTime();
      const close = localToUtc(day, cal.workEnd, cal.timezone).getTime();
      const a = Math.max(open, from.getTime()), b = Math.min(close, to.getTime());
      if (b > a) total += (b - a) / MIN;
    }
    const d = new Date(`${day}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() + 1);
    day = d.toISOString().slice(0, 10);
  }
  return Math.floor(total);
}

// Owners (the executive dashboard) and HR hear about work that has waited too long for its project manager. Once per review.
export async function runReviewEscalations(db: Db, opts: { now?: Date; organizationId?: string } = {}): Promise<number> {
  const now = opts.now ?? new Date();
  const open = await db.taskReview.findMany({
    where: { respondedAt: null, escalatedAt: null, task: { status: "REVIEW", project: { status: { in: ["ACTIVE", "ON_HOLD"] }, archivedAt: null, ...(opts.organizationId ? { organizationId: opts.organizationId } : {}) } } },
    select: { id: true, submittedAt: true, submittedById: true, task: { select: { id: true, title: true, projectId: true, project: { select: { name: true, organizationId: true, managerId: true } } } } },
    take: 500,
  });
  const ctx = new Map<string, { cal: Calendar; holidays: string[]; told: string[] }>();
  let n = 0;
  for (const r of open) {
    const org = r.task.project.organizationId;
    if (!ctx.has(org)) {
      const cal = await getCalendar(db, org);
      const holidays = holidayDates(await getHolidays(db, org));
      const told = [...new Set([...(await usersWithPermission(db, org, "dashboard.executive")), ...(await usersWithPermission(db, org, "hr.manage"))])];
      ctx.set(org, { cal, holidays, told });
    }
    const c = ctx.get(org)!;
    const waited = officeMinutesBetween(r.submittedAt, now, c.cal, c.holidays);
    if (waited < c.cal.reviewResponseMinutes) continue;
    // Claim it first, so two servers never send it twice
    const claimed = await db.taskReview.updateMany({ where: { id: r.id, escalatedAt: null, respondedAt: null }, data: { escalatedAt: now } });
    if (claimed.count === 0) continue;
    n++;
    const names = new Map((await db.user.findMany({ where: { id: { in: [r.submittedById, r.task.project.managerId].filter(Boolean) as string[] } }, select: { id: true, name: true } })).map((u) => [u.id, u.name]));
    const manager = r.task.project.managerId ? names.get(r.task.project.managerId) ?? "The project manager" : "No project manager";
    const sender = names.get(r.submittedById) ?? "A team member";
    const wait = spanText(now.getTime() - r.submittedAt.getTime());
    const people = [...new Set([...c.told, ...(r.task.project.managerId ? [r.task.project.managerId] : [])])].filter((id) => id !== r.submittedById);
    await notifyMany(db, people, {
      kind: "task.review_waiting", title: `Waiting ${wait} for review: ${r.task.title}`, body: `${sender} sent it for review. ${manager} has not answered yet. ${r.task.project.name}`,
      link: LINK(r.task.projectId, r.task.id), dedupeKey: `review-waiting:${r.id}`,
    });
    const emails = await db.user.findMany({ where: { id: { in: people }, active: true, email: { not: null } }, select: { email: true, name: true } });
    for (const u of emails) {
      await sendTemplateQuietly(db, {
        organizationId: org, key: "task_review_waiting", to: u.email!, purpose: "NOREPLY", relatedType: "Task", relatedId: r.task.id, buttonUrl: `${appUrl()}${LINK(r.task.projectId, r.task.id)}`,
        vars: { first_name: firstName(u.name), task_title: r.task.title, project: r.task.project.name, sender, manager, waited: wait, limit: `${c.cal.reviewResponseMinutes} minutes` },
      });
    }
  }
  return n;
}

// For the task panel and reports: how long the manager took (wall clock), or how long it has waited so far.
export function responseText(r: { submittedAt: Date; respondedAt: Date | null }, now = new Date()): string {
  return r.respondedAt ? `answered in ${spanText(r.respondedAt.getTime() - r.submittedAt.getTime())}` : `waiting ${spanText(now.getTime() - r.submittedAt.getTime())}`;
}
