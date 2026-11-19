"use server";

import { revalidatePath } from "next/cache";
import { audit, requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";
import { taskAssigned } from "@/lib/events";
import { notify } from "@/lib/notifications";
import { planTask, type PlanMove } from "@/lib/planner";
import { TaskError } from "@/lib/tasks";

export type PlanResult = { ok: true } | { ok: false; error: string };

// The weekly planner's drag and drop (and its keyboard "Move to" menu). Rules live in planTask; this checks the permission,
// audits the move, tells the person who now holds the task, and refreshes the screens that show due dates.
export async function planTaskAction(move: PlanMove): Promise<PlanResult> {
  const user = await requirePermission("tasks.edit");
  if (!move || typeof move.taskId !== "string") return { ok: false, error: "Task not found." };
  let r;
  try {
    r = await planTask(db, { actor: user, move: { taskId: move.taskId, date: move.date ?? null, ...(move.assigneeId !== undefined ? { assigneeId: move.assigneeId } : {}) } });
  } catch (e) {
    if (e instanceof TaskError) return { ok: false, error: e.message };
    throw e;
  }
  if (!r.changed) return { ok: true };
  await audit(user, { action: "task.plan", entity: "Task", entityId: r.task.id, before: r.before, after: r.after });
  if (r.after.assigneeId !== r.before.assigneeId) {
    await taskAssigned(db, { organizationId: user.organizationId, taskId: r.task.id, toUserId: r.after.assigneeId, byUserId: user.id });
  } else if (r.after.assigneeId && r.after.assigneeId !== user.id && r.after.dueDate !== r.before.dueDate) {
    await notify(db, r.after.assigneeId, {
      kind: "task.rescheduled",
      title: r.after.dueDate ? `${user.name} moved a task to ${r.after.dueDate}` : `${user.name} took the due date off a task`,
      body: r.task.title,
      link: `/projects/${r.task.projectId}?task=${r.task.id}`,
    });
  }
  revalidatePath("/projects");
  revalidatePath(`/projects/${r.task.projectId}`);
  revalidatePath("/me/tasks");
  return { ok: true };
}
