"use server";

import { revalidatePath } from "next/cache";
import { audit, requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";
import { notify } from "@/lib/notifications";
import { scheduleTask } from "@/lib/task-schedule";
import { TaskError } from "@/lib/tasks";

export type ScheduleActionResult = { ok: true; warnings: string[] } | { ok: false; error: string };

// The project Timeline's drag (move a bar, or pull its start or end) and its arrow keys. Rules live in scheduleTask; this checks the
// permission, audits, tells the assignee when someone else changes their dates, and refreshes the screens that show them.
export async function scheduleTaskAction(taskId: string, start: string | null, due: string | null): Promise<ScheduleActionResult> {
  const user = await requirePermission("tasks.edit");
  if (typeof taskId !== "string") return { ok: false, error: "Task not found." };
  let r;
  try {
    r = await scheduleTask(db, { actor: user, taskId, start: start || null, due: due || null });
  } catch (e) {
    if (e instanceof TaskError) return { ok: false, error: e.message };
    throw e;
  }
  if (!r.changed) return { ok: true, warnings: r.warnings };
  await audit(user, { action: "task.schedule", entity: "Task", entityId: r.task.id, before: r.before, after: r.after });
  if (r.task.assigneeId && r.task.assigneeId !== user.id) {
    const span = r.after.startDate ? `${r.after.startDate} to ${r.after.dueDate ?? "no due date"}` : `due ${r.after.dueDate ?? "no date"}`;
    await notify(db, r.task.assigneeId, { kind: "task.rescheduled", title: `${user.name} changed the dates of a task`, body: `${r.task.title}: ${span}`, link: `/projects/${r.task.projectId}?task=${r.task.id}` });
  }
  revalidatePath(`/projects/${r.task.projectId}`);
  revalidatePath("/projects");
  revalidatePath("/me/tasks");
  return { ok: true, warnings: r.warnings };
}
