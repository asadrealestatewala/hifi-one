import { audit } from "@/lib/auth";
import { db } from "@/lib/db";
import { taskMoved } from "@/lib/events";
import { TASK_STATUSES } from "@/lib/project-rules";
import { projectScope } from "@/lib/projects";
import { TaskError, changeTaskStatus } from "@/lib/tasks";
import { isResponse, json, readJson, requireMobileUser, str } from "@/lib/mobile-api";

export const dynamic = "force-dynamic";

// Change a task's status. Same rules as the website's board and My tasks list: needs tasks.edit, only your own tasks unless you
// manage the project, closed projects are refused, and waiting-for tasks / open subtasks refuse with a reason.
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const a = await requireMobileUser(req, "tasks.edit");
  if (isResponse(a)) return a;
  const { user } = a;
  const { id } = await params;
  const status = str((await readJson(req)).status, 30);
  if (!(TASK_STATUSES as readonly string[]).includes(status)) return json({ error: "Unknown status." }, 400);
  const task = await db.task.findUnique({ where: { id }, include: { project: true } });
  const project = task ? await db.project.findFirst({ where: { id: task.projectId, ...projectScope(user) } }) : null;
  if (!task || !project) return json({ error: "Task not found." }, 404);
  const isManager = user.permissions.has("projects.manage") || project.managerId === user.id;
  if (!isManager && task.assigneeId !== user.id) return json({ error: "You can only move tasks assigned to you." }, 403);
  if (project.status === "COMPLETED" || project.status === "CANCELLED") return json({ error: "This project is closed." }, 409);
  if (task.status === status) return json({ ok: true, status });
  try {
    const r = await changeTaskStatus(db, { projectId: task.projectId, taskId: id, status, actorId: user.id });
    await audit(user, { action: "task.move", entity: "Task", entityId: id, before: { status: task.status }, after: { status, nextOccurrence: r.next?.id ?? null, via: "mobile" } });
    await taskMoved(db, { organizationId: user.organizationId, taskId: id, status, byUserId: user.id });
  } catch (e) {
    if (e instanceof TaskError) return json({ error: e.message }, 409);
    throw e;
  }
  return json({ ok: true, status });
}
