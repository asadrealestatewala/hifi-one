// Change many tasks at once from the task list: assignee, due date, priority, status, or delete. Each task is checked on
// its own (the person must see the project, the project must be open, and only its manager may change details), and the
// result says which were changed and why any were skipped, so one bad row never blocks the rest.
// Free of Next.js imports so it can be tested against the database.
import type { Prisma, PrismaClient } from "@prisma/client";
import { TaskError, changeTaskStatus } from "./tasks";
import type { MilestoneAutomation } from "./project-automations";
import { TASK_STATUSES } from "./project-rules";
import { parseEstimate } from "./task-rules";
import { MAX_LABELS_PER_TASK } from "./task-labels";

type Db = PrismaClient;
type Tx = Prisma.TransactionClient;

export const BULK_LIMIT = 200;
export type BulkChange =
  | { kind: "assign"; userId: string | null }
  | { kind: "due"; date: string | null }
  | { kind: "priority"; value: string }
  | { kind: "estimate"; hours: string | null }
  | { kind: "label"; labelId: string; add: boolean }
  | { kind: "status"; value: string }
  | { kind: "delete" };
export type BulkActor = { id: string; organizationId: string; permissions: ReadonlySet<string> };
export type BulkSkip = { id: string; title: string; reason: string };
export type BulkResult = {
  changed: { id: string; projectId: string; before: Record<string, unknown> }[];
  skipped: BulkSkip[];
  deleted: number;
  kept: number; // asked to delete, but kept because of logged time, work sessions, files or a content post
  nextOccurrences: string[]; // recurring tasks completed in this batch create their next one
  milestones: MilestoneAutomation[]; // milestones completed (with any draft invoice) or reopened by this batch
};

// Deletes tasks (with their subtasks) unless something worth keeping hangs off them: logged time, work sessions,
// files or a linked content post. Those are returned in `kept` and left in place. Tasks that waited on a deleted one stop waiting.
export async function deleteTaskFamilies(tx: Tx, projectId: string, ids: string[]): Promise<{ deleted: string[]; kept: string[] }> {
  if (!ids.length) return { deleted: [], kept: [] };
  const family = await tx.task.findMany({ where: { projectId, OR: [{ id: { in: ids } }, { parentId: { in: ids } }] }, select: { id: true, parentId: true } });
  const famIds = family.map((t) => t.id);
  const [time, sessions, content, files] = await Promise.all([
    tx.timeEntry.findMany({ where: { taskId: { in: famIds } }, select: { taskId: true } }),
    tx.workSession.findMany({ where: { taskId: { in: famIds } }, select: { taskId: true } }),
    tx.contentItem.findMany({ where: { taskId: { in: famIds } }, select: { taskId: true } }),
    tx.storedFile.findMany({ where: { ownerType: "TASK", ownerId: { in: famIds } }, select: { ownerId: true } }),
  ]);
  const busy = new Set<string>([...time.map((x) => x.taskId), ...sessions.map((x) => x.taskId), ...content.map((x) => x.taskId), ...files.map((x) => x.ownerId)].filter((x): x is string => Boolean(x)));
  const rootOf = (t: { id: string; parentId: string | null }) => (t.parentId && ids.includes(t.parentId) ? t.parentId : t.id);
  const keepRoots = new Set(family.filter((t) => busy.has(t.id)).map(rootOf));
  const drop = ids.filter((id) => !keepRoots.has(id));
  const dropAll = family.filter((t) => drop.includes(rootOf(t))).map((t) => t.id);
  if (dropAll.length) {
    const waiting = await tx.task.findMany({ where: { projectId, blockedBy: { hasSome: dropAll } }, select: { id: true, blockedBy: true } });
    for (const w of waiting) await tx.task.update({ where: { id: w.id }, data: { blockedBy: w.blockedBy.filter((b) => !dropAll.includes(b)) } });
    await tx.task.deleteMany({ where: { id: { in: dropAll } } });
  }
  return { deleted: drop, kept: ids.filter((id) => keepRoots.has(id)) };
}

export async function bulkEditTasks(db: Db, p: { actor: BulkActor; taskIds: string[]; change: BulkChange }): Promise<BulkResult> {
  const ids = [...new Set(p.taskIds)].slice(0, BULK_LIMIT);
  const res: BulkResult = { changed: [], skipped: [], deleted: 0, kept: 0, nextOccurrences: [], milestones: [] };
  const c = p.change;
  if (c.kind === "priority" && !["LOW", "MEDIUM", "HIGH"].includes(c.value)) throw new TaskError("Choose a priority.");
  if (c.kind === "status" && !(TASK_STATUSES as readonly string[]).includes(c.value)) throw new TaskError("Choose a status.");
  if (c.kind === "due" && c.date && (!/^\d{4}-\d{2}-\d{2}$/.test(c.date) || Number.isNaN(Date.parse(c.date)))) throw new TaskError("Enter a valid due date.");

  const est = c.kind === "estimate" ? parseEstimate(c.hours) : null;
  if (est && !est.ok) throw new TaskError("Write the estimate in hours, for example 2 or 1.5.");
  if (c.kind === "label" && !(await db.taskLabel.findFirst({ where: { id: c.labelId, organizationId: p.actor.organizationId }, select: { id: true } }))) throw new TaskError("Label not found.");
  const viewAll = p.actor.permissions.has("projects.view_all");
  const tasks = await db.task.findMany({
    where: { id: { in: ids }, project: { organizationId: p.actor.organizationId, ...(viewAll ? {} : { OR: [{ managerId: p.actor.id }, { members: { some: { userId: p.actor.id } } }] }) } },
    select: { id: true, title: true, projectId: true, assigneeId: true, dueDate: true, priority: true, status: true, estimatedHours: true, labelIds: true, project: { select: { managerId: true, status: true } } },
  });
  const found = new Set(tasks.map((t) => t.id));
  for (const id of ids) if (!found.has(id)) res.skipped.push({ id, title: "", reason: "Task not found." });

  // Who may be assigned: a member of that task's project who is still an active employee
  const assignee = c.kind === "assign" && c.userId ? await db.user.findFirst({ where: { id: c.userId, organizationId: p.actor.organizationId, active: true, userType: "EMPLOYEE" }, select: { id: true } }) : null;
  if (c.kind === "assign" && c.userId && !assignee) throw new TaskError("Choose an active staff member.");
  const members = assignee ? await db.projectMember.findMany({ where: { userId: assignee.id, projectId: { in: [...new Set(tasks.map((t) => t.projectId))] } }, select: { projectId: true } }) : [];
  const onTeam = new Set(members.map((m) => m.projectId));
  const toDelete = new Map<string, string[]>();

  for (const t of tasks) {
    const isManager = p.actor.permissions.has("projects.manage") || t.project.managerId === p.actor.id;
    const skip = (reason: string) => res.skipped.push({ id: t.id, title: t.title, reason });
    if (t.project.status === "COMPLETED" || t.project.status === "CANCELLED") { skip("The project is closed."); continue; }
    if (c.kind === "status") {
      if (!isManager && t.assigneeId !== p.actor.id) { skip("You can only move tasks assigned to you."); continue; }
      if (t.status === c.value) continue;
      try {
        const r = await changeTaskStatus(db, { projectId: t.projectId, taskId: t.id, status: c.value, actorId: p.actor.id });
        res.changed.push({ id: t.id, projectId: t.projectId, before: { status: t.status } });
        if (r.next) res.nextOccurrences.push(r.next.id);
        if (r.milestone) res.milestones.push(r.milestone);
      } catch (e) {
        if (e instanceof TaskError) { skip(e.message); continue; }
        throw e;
      }
      continue;
    }
    if (!isManager) { skip("Only the project manager can change this task."); continue; }
    if (c.kind === "assign") {
      if (c.userId && !onTeam.has(t.projectId)) { skip("That person is not on this project's team."); continue; }
      if (t.assigneeId === c.userId) continue;
      await db.task.update({ where: { id: t.id }, data: { assigneeId: c.userId } });
      res.changed.push({ id: t.id, projectId: t.projectId, before: { assigneeId: t.assigneeId } });
    } else if (c.kind === "due") {
      const due = c.date ? new Date(`${c.date}T00:00:00.000Z`) : null;
      if ((t.dueDate?.getTime() ?? null) === (due?.getTime() ?? null)) continue;
      await db.task.update({ where: { id: t.id }, data: { dueDate: due } });
      res.changed.push({ id: t.id, projectId: t.projectId, before: { dueDate: t.dueDate?.toISOString().slice(0, 10) ?? null } });
    } else if (c.kind === "priority") {
      if (t.priority === c.value) continue;
      await db.task.update({ where: { id: t.id }, data: { priority: c.value } });
      res.changed.push({ id: t.id, projectId: t.projectId, before: { priority: t.priority } });
    } else if (c.kind === "label") {
      const has = t.labelIds.includes(c.labelId);
      if (has === c.add) continue;
      if (c.add && t.labelIds.length >= MAX_LABELS_PER_TASK) { skip(`A task can carry at most ${MAX_LABELS_PER_TASK} labels.`); continue; }
      await db.task.update({ where: { id: t.id }, data: { labelIds: c.add ? [...t.labelIds, c.labelId] : t.labelIds.filter((x) => x !== c.labelId) } });
      res.changed.push({ id: t.id, projectId: t.projectId, before: { labelIds: t.labelIds } });
    } else if (c.kind === "estimate") {
      const value = est && est.ok ? est.value : null;
      if ((t.estimatedHours?.toString() ?? null) === value || (t.estimatedHours && value && Number(t.estimatedHours) === Number(value))) continue;
      await db.task.update({ where: { id: t.id }, data: { estimatedHours: value } });
      res.changed.push({ id: t.id, projectId: t.projectId, before: { estimatedHours: t.estimatedHours?.toString() ?? null } });
    } else {
      toDelete.set(t.projectId, [...(toDelete.get(t.projectId) ?? []), t.id]);
    }
  }

  for (const [projectId, list] of toDelete) {
    const titles = new Map(tasks.map((t) => [t.id, t]));
    const r = await db.$transaction((tx) => deleteTaskFamilies(tx, projectId, list));
    res.deleted += r.deleted.length;
    res.kept += r.kept.length;
    for (const id of r.deleted) res.changed.push({ id, projectId, before: { title: titles.get(id)!.title, status: titles.get(id)!.status } });
    for (const id of r.kept) res.skipped.push({ id, title: titles.get(id)!.title, reason: "Kept because it has logged time, files or a content post." });
  }
  return res;
}
