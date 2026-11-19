"use server";

import { revalidatePath } from "next/cache";
import { audit, requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";
import { notify } from "@/lib/notifications";
import { planFollowers, scheduleTask, shiftFollowers } from "@/lib/task-schedule";
import { TaskError } from "@/lib/tasks";

export type Follower = { id: string; title: string; days: number };
export type ScheduleActionResult = { ok: true; warnings: string[]; followers: Follower[] } | { ok: false; error: string };
export type ShiftFollowersResult = { ok: true; moved: { id: string; startDate: string | null; dueDate: string | null }[] } | { ok: false; error: string };

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
  const followers = (await planFollowers(db, { projectId: r.task.projectId, taskId: r.task.id })).map((m) => ({ id: m.id, title: m.title, days: m.days }));
  if (!r.changed) return { ok: true, warnings: r.warnings, followers };
  await audit(user, { action: "task.schedule", entity: "Task", entityId: r.task.id, before: r.before, after: r.after });
  if (r.task.assigneeId && r.task.assigneeId !== user.id) {
    const span = r.after.startDate ? `${r.after.startDate} to ${r.after.dueDate ?? "no due date"}` : `due ${r.after.dueDate ?? "no date"}`;
    await notify(db, r.task.assigneeId, { kind: "task.rescheduled", title: `${user.name} changed the dates of a task`, body: `${r.task.title}: ${span}`, link: `/projects/${r.task.projectId}?task=${r.task.id}` });
  }
  revalidatePath(`/projects/${r.task.projectId}`);
  revalidatePath("/projects");
  revalidatePath("/me/tasks");
  return { ok: true, warnings: r.warnings, followers };
}

// "Move them too" after a Timeline move: pushes the tasks that wait for this one (and their own followers) to start once it is due.
// Rules live in shiftFollowers; each moved task is audited and its assignee told when someone else moved it.
export async function shiftFollowersAction(taskId: string): Promise<ShiftFollowersResult> {
  const user = await requirePermission("tasks.edit");
  if (typeof taskId !== "string") return { ok: false, error: "Task not found." };
  let r;
  try {
    r = await shiftFollowers(db, { actor: user, taskId });
  } catch (e) {
    if (e instanceof TaskError) return { ok: false, error: e.message };
    throw e;
  }
  for (const m of r.moves) {
    await audit(user, { action: "task.schedule", entity: "Task", entityId: m.id, before: m.before, after: { ...m.after, followsTask: taskId } });
    if (m.assigneeId && m.assigneeId !== user.id) {
      const span = m.after.startDate ? `${m.after.startDate} to ${m.after.dueDate ?? "no due date"}` : `due ${m.after.dueDate ?? "no date"}`;
      await notify(db, m.assigneeId, { kind: "task.rescheduled", title: `${user.name} moved a task that waits for other work`, body: `${m.title}: ${span}`, link: `/projects/${r.projectId}?task=${m.id}` });
    }
  }
  revalidatePath(`/projects/${r.projectId}`);
  revalidatePath("/projects");
  revalidatePath("/me/tasks");
  return { ok: true, moved: r.moves.map((m) => ({ id: m.id, ...m.after })) };
}
