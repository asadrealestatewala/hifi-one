// A task's dates: when work starts and when it is due. Set by dragging a bar on the project Timeline (move it, or pull either end)
// and by the Start date and Due date fields in the task panel. Only the project's manager (or projects.manage) may change them, on an
// open project, for a task that is not done. A start after the due date is refused. Work the task waits for that is due after the new
// start, or a due date past the project deadline, is allowed but returned as warnings so the manager sees the clash at once.
// Free of Next.js imports so it can be tested against the database.
import type { PrismaClient } from "@prisma/client";
import { TaskError } from "./tasks";

type Db = PrismaClient;
const ymd = (d: Date) => d.toISOString().slice(0, 10);
const isDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`)) && ymd(new Date(`${s}T00:00:00Z`)) === s;
const at = (s: string | null) => (s ? new Date(`${s}T00:00:00.000Z`) : null);

// Checks the pair of dates on their own; returns the error to show, or null.
export function scheduleError(start: string | null, due: string | null): string | null {
  if (start !== null && !isDate(start)) return "Enter a valid start date.";
  if (due !== null && !isDate(due)) return "Enter a valid due date.";
  if (start && due && start > due) return "The start date can't be after the due date.";
  return null;
}

export type ScheduleResult = {
  task: { id: string; title: string; projectId: string; assigneeId: string | null };
  before: { startDate: string | null; dueDate: string | null };
  after: { startDate: string | null; dueDate: string | null };
  changed: boolean;
  warnings: string[];
};

// Plain-language clashes for a schedule: blockers still open and due after the start, and a due date past the deadline.
export async function scheduleWarnings(db: Db, p: { projectId: string; blockedBy: string[]; start: string | null; due: string | null; deadline: Date | null }): Promise<string[]> {
  const out: string[] = [];
  if (p.blockedBy.length) {
    const from = p.start ?? p.due;
    if (from) {
      const late = await db.task.findMany({ where: { id: { in: p.blockedBy }, projectId: p.projectId, status: { not: "DONE" }, dueDate: { gt: at(from)! } }, select: { title: true, dueDate: true }, orderBy: { dueDate: "asc" } });
      for (const b of late) out.push(`It waits for "${b.title}", which is due ${ymd(b.dueDate!)}, after this task ${p.start ? "starts" : "is due"}.`);
    }
  }
  if (p.due && p.deadline && p.due > ymd(p.deadline)) out.push(`The due date is after the project deadline (${ymd(p.deadline)}).`);
  return out;
}

export async function scheduleTask(db: Db, p: { actor: { id: string; organizationId: string; permissions: ReadonlySet<string> }; taskId: string; start: string | null; due: string | null }): Promise<ScheduleResult> {
  const err = scheduleError(p.start, p.due);
  if (err) throw new TaskError(err);
  const viewAll = p.actor.permissions.has("projects.view_all");
  const t = await db.task.findFirst({
    where: { id: p.taskId, project: { organizationId: p.actor.organizationId, ...(viewAll ? {} : { OR: [{ managerId: p.actor.id }, { members: { some: { userId: p.actor.id } } }] }) } },
    select: { id: true, title: true, projectId: true, assigneeId: true, status: true, startDate: true, dueDate: true, blockedBy: true, project: { select: { managerId: true, status: true, deadline: true } } },
  });
  if (!t) throw new TaskError("Task not found.");
  if (!(p.actor.permissions.has("projects.manage") || t.project.managerId === p.actor.id)) throw new TaskError("Only the project manager can change this task's dates.");
  if (t.project.status === "COMPLETED" || t.project.status === "CANCELLED") throw new TaskError("This project is closed.");
  if (t.status === "DONE") throw new TaskError("This task is done. Reopen it before changing its dates.");
  const before = { startDate: t.startDate ? ymd(t.startDate) : null, dueDate: t.dueDate ? ymd(t.dueDate) : null };
  const after = { startDate: p.start, dueDate: p.due };
  const changed = before.startDate !== after.startDate || before.dueDate !== after.dueDate;
  if (changed) await db.task.update({ where: { id: t.id }, data: { startDate: at(p.start), dueDate: at(p.due) } });
  const warnings = await scheduleWarnings(db, { projectId: t.projectId, blockedBy: t.blockedBy, start: p.start, due: p.due, deadline: t.project.deadline });
  return { task: { id: t.id, title: t.title, projectId: t.projectId, assigneeId: t.assigneeId }, before, after, changed, warnings };
}
