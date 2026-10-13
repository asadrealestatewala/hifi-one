// Subtasks, dependencies, recurrence and comments on project tasks. Callers have already checked that the person may touch the project.
import type { Prisma, PrismaClient } from "@prisma/client";
import { RECURRENCES, nextDue, openBlockers, wouldCycle, type Recurrence } from "./task-rules";

export class TaskError extends Error {}
type Db = PrismaClient;
type Tx = Prisma.TransactionClient;

async function load(db: Db | Tx, projectId: string, id: string) {
  const t = await db.task.findFirst({ where: { id, projectId } });
  if (!t) throw new TaskError("Task not found.");
  return t;
}

export async function addSubtask(db: Db, p: { projectId: string; parentId: string; title: string; assigneeId?: string | null; actorId: string }) {
  const parent = await load(db, p.projectId, p.parentId);
  if (parent.parentId) throw new TaskError("Subtasks cannot have their own subtasks.");
  if (parent.status === "DONE") throw new TaskError("Reopen the task before adding subtasks to it.");
  const title = p.title.trim().slice(0, 200);
  if (title.length < 2) throw new TaskError("Give the subtask a title.");
  if (p.assigneeId && !(await db.projectMember.findUnique({ where: { projectId_userId: { projectId: p.projectId, userId: p.assigneeId } } }))) throw new TaskError("Assign subtasks to project members.");
  return db.task.create({ data: { projectId: p.projectId, parentId: parent.id, title, assigneeId: p.assigneeId ?? null, createdById: p.actorId, priority: parent.priority, dueDate: parent.dueDate } });
}

export async function setBlockers(db: Db, p: { projectId: string; taskId: string; blockerIds: string[] }) {
  const task = await load(db, p.projectId, p.taskId);
  const ids = [...new Set(p.blockerIds)];
  if (ids.length > 10) throw new TaskError("A task can wait for at most 10 others.");
  if (ids.includes(task.id)) throw new TaskError("A task cannot wait for itself.");
  const all = await db.task.findMany({ where: { projectId: p.projectId }, select: { id: true, blockedBy: true, parentId: true } });
  const known = new Map(all.map((t) => [t.id, t]));
  if (ids.some((i) => !known.has(i))) throw new TaskError("Choose tasks from this project.");
  if (ids.some((i) => known.get(i)!.parentId === task.id || task.parentId === i)) throw new TaskError("A task and its own subtasks are already linked, so they cannot block each other.");
  if (wouldCycle(all, task.id, ids)) throw new TaskError("That would make tasks wait for each other in a loop.");
  return db.task.update({ where: { id: task.id }, data: { blockedBy: ids } });
}

export async function setRecurrence(db: Db, p: { projectId: string; taskId: string; recurrence: string | null }) {
  const task = await load(db, p.projectId, p.taskId);
  if (p.recurrence && !(RECURRENCES as readonly string[]).includes(p.recurrence)) throw new TaskError("Choose daily, weekly or monthly.");
  if (task.parentId && p.recurrence) throw new TaskError("Only top-level tasks can repeat.");
  return db.task.update({ where: { id: task.id }, data: { recurrence: p.recurrence } });
}

// Status change with the dependency rules. Returns the next occurrence when a recurring task was just completed.
export async function changeTaskStatus(db: Db, p: { projectId: string; taskId: string; status: string; actorId: string; now?: Date }) {
  return db.$transaction(async (tx) => {
    const task = await load(tx, p.projectId, p.taskId);
    if (task.status === p.status) return { task, next: null };
    if (p.status !== "TODO") {
      const blockers = task.blockedBy.length ? await tx.task.findMany({ where: { id: { in: task.blockedBy } }, select: { id: true, title: true, status: true } }) : [];
      const open = openBlockers(task.blockedBy, new Map(blockers.map((b) => [b.id, b])));
      if (open.length) throw new TaskError(`Waiting for: ${open.map((b) => b.title).join(", ")}.`);
    }
    if (p.status === "DONE") {
      const subs = await tx.task.count({ where: { parentId: task.id, status: { not: "DONE" } } });
      if (subs) throw new TaskError(`${subs} subtask${subs === 1 ? " is" : "s are"} not done yet.`);
    }
    const updated = await tx.task.update({ where: { id: task.id }, data: { status: p.status, completedAt: p.status === "DONE" ? (p.now ?? new Date()) : null } });
    let next = null;
    if (p.status === "DONE" && task.recurrence) {
      // The unique recurredFromId makes this safe if two people complete the task at the same moment
      const exists = await tx.task.findUnique({ where: { recurredFromId: task.id } });
      if (!exists) {
        next = await tx.task.create({
          data: {
            projectId: task.projectId, title: task.title, description: task.description, priority: task.priority, assigneeId: task.assigneeId, clientVisible: task.clientVisible, milestoneId: task.milestoneId,
            estimatedHours: task.estimatedHours, recurrence: task.recurrence, recurredFromId: task.id, createdById: p.actorId, dueDate: nextDue(task.dueDate, task.recurrence as Recurrence, p.now),
          },
        });
      }
    }
    return { task: updated, next };
  });
}

export async function addComment(db: Db, p: { projectId: string; taskId: string; authorId: string; body: string; internal?: boolean }) {
  await load(db, p.projectId, p.taskId);
  const body = p.body.trim();
  if (!body) throw new TaskError("Write a comment first.");
  if (body.length > 4000) throw new TaskError("The comment is too long.");
  return db.taskComment.create({ data: { taskId: p.taskId, authorId: p.authorId, body, internal: p.internal ?? true } });
}
