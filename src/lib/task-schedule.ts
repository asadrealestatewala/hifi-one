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

// Tasks that wait for a moved task and now start before it is due ("followers"), with the dates that would put each one right
// after the work it waits for. A follower keeps its length: start and due shift by the same number of days. The push carries on down
// the chain (a follower's own followers move when it moves), within the project, and never pulls a task earlier. Done tasks and
// tasks with no dates are left alone. Dependencies cannot loop (tasks.ts refuses that), but a visited set guards anyway.
export type FollowerMove = { id: string; title: string; assigneeId: string | null; days: number; before: { startDate: string | null; dueDate: string | null }; after: { startDate: string | null; dueDate: string | null } };
const DAY = 86_400_000;
const addDays = (s: string | null, n: number) => (s ? ymd(new Date(Date.parse(`${s}T00:00:00Z`) + n * DAY)) : null);
const gap = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY);

export async function planFollowers(db: Db, p: { projectId: string; taskId: string }): Promise<FollowerMove[]> {
  const rows = await db.task.findMany({ where: { projectId: p.projectId, status: { not: "DONE" } }, select: { id: true, title: true, assigneeId: true, startDate: true, dueDate: true, blockedBy: true } });
  const dates = new Map(rows.map((r) => [r.id, { start: r.startDate ? ymd(r.startDate) : null, due: r.dueDate ? ymd(r.dueDate) : null }]));
  const moves = new Map<string, FollowerMove>();
  const queue = [p.taskId];
  const seen = new Set<string>();
  while (queue.length) {
    const id = queue.shift()!;
    if (seen.has(id)) continue;
    seen.add(id);
    const due = dates.get(id)?.due;
    if (!due) continue;
    for (const f of rows) {
      if (f.id === p.taskId || !f.blockedBy.includes(id)) continue;
      const cur = dates.get(f.id)!;
      const from = cur.start ?? cur.due;
      if (!from) continue;
      const days = gap(from, due);
      if (days <= 0) continue;
      const next = { start: addDays(cur.start, days), due: addDays(cur.due, days) };
      dates.set(f.id, next);
      const prev = moves.get(f.id);
      const before = prev?.before ?? { startDate: f.startDate ? ymd(f.startDate) : null, dueDate: f.dueDate ? ymd(f.dueDate) : null };
      moves.set(f.id, { id: f.id, title: f.title, assigneeId: f.assigneeId, days: (prev?.days ?? 0) + days, before, after: { startDate: next.start, dueDate: next.due } });
      seen.delete(f.id); // its own followers are checked against its new due date
      queue.push(f.id);
    }
  }
  return [...moves.values()].sort((a, b) => ((a.after.startDate ?? a.after.dueDate ?? "") < (b.after.startDate ?? b.after.dueDate ?? "") ? -1 : 1));
}

// Applies planFollowers for a task the actor may schedule (same rules as scheduleTask), in one transaction. Returns the moves made.
export async function shiftFollowers(db: Db, p: { actor: { id: string; organizationId: string; permissions: ReadonlySet<string> }; taskId: string }): Promise<{ projectId: string; moves: FollowerMove[] }> {
  const viewAll = p.actor.permissions.has("projects.view_all");
  const t = await db.task.findFirst({
    where: { id: p.taskId, project: { organizationId: p.actor.organizationId, ...(viewAll ? {} : { OR: [{ managerId: p.actor.id }, { members: { some: { userId: p.actor.id } } }] }) } },
    select: { id: true, projectId: true, project: { select: { managerId: true, status: true } } },
  });
  if (!t) throw new TaskError("Task not found.");
  if (!(p.actor.permissions.has("projects.manage") || t.project.managerId === p.actor.id)) throw new TaskError("Only the project manager can change these tasks' dates.");
  if (t.project.status === "COMPLETED" || t.project.status === "CANCELLED") throw new TaskError("This project is closed.");
  const moves = await planFollowers(db, { projectId: t.projectId, taskId: t.id });
  if (moves.length) await db.$transaction(moves.map((m) => db.task.update({ where: { id: m.id }, data: { startDate: at(m.after.startDate), dueDate: at(m.after.dueDate) } })));
  return { projectId: t.projectId, moves };
}
