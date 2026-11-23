"use server";

import { revalidatePath } from "next/cache";
import { audit, requirePermission, type SessionUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { projectScope } from "@/lib/projects";
import { notify } from "@/lib/notifications";
import { TaskError } from "@/lib/tasks";
import { approveTask, requestRevision } from "@/lib/task-review";
import { reportIssue, resolveIssue } from "@/lib/task-issues";

export type ReviewActionResult = { ok: true } | { ok: false; error: string };

const fail = (e: unknown): ReviewActionResult => {
  if (e instanceof TaskError) return { ok: false, error: e.message };
  throw e;
};

async function taskIn(user: SessionUser, taskId: string) {
  const task = await db.task.findUnique({ where: { id: String(taskId) }, select: { id: true, title: true, projectId: true, assigneeId: true } });
  const project = task ? await db.project.findFirst({ where: { id: task.projectId, ...projectScope(user) }, select: { id: true, managerId: true, status: true, members: { where: { userId: user.id }, select: { userId: true } } } }) : null;
  if (!task || !project) return null;
  const isManager = user.permissions.has("projects.manage") || project.managerId === user.id;
  const closed = project.status === "COMPLETED" || project.status === "CANCELLED";
  return { task, project, isManager, closed, onTeam: isManager || project.members.length > 0 || task.assigneeId === user.id };
}

// Approve: only the project manager (or projects.manage). The task becomes Done with the usual Done rules.
export async function approveTaskAction(taskId: string, comment: string): Promise<ReviewActionResult> {
  const user = await requirePermission("tasks.edit");
  const c = await taskIn(user, taskId);
  if (!c) return { ok: false, error: "Task not found." };
  if (!c.isManager) return { ok: false, error: "Only the project manager can approve work." };
  if (c.closed) return { ok: false, error: "This project is closed." };
  try {
    await approveTask(db, { projectId: c.task.projectId, taskId: c.task.id, actorId: user.id, comment: String(comment ?? "") });
  } catch (e) { return fail(e); }
  await audit(user, { action: "task.approve", entity: "Task", entityId: c.task.id, after: { status: "DONE", comment: String(comment ?? "").trim() || null } });
  if (c.task.assigneeId && c.task.assigneeId !== user.id) {
    await notify(db, c.task.assigneeId, { kind: "task.approved", title: `Approved: ${c.task.title}`, body: String(comment ?? "").trim().slice(0, 160) || `${user.name} approved your work.`, link: `/projects/${c.task.projectId}?task=${c.task.id}`, dedupeKey: `task-approved:${c.task.id}:${Date.now()}` });
  }
  revalidatePath(`/projects/${c.task.projectId}`);
  return { ok: true };
}

// Revision needed: only the project manager, with what to change. The task goes back to In progress.
export async function requestRevisionAction(taskId: string, comment: string): Promise<ReviewActionResult> {
  const user = await requirePermission("tasks.edit");
  const c = await taskIn(user, taskId);
  if (!c) return { ok: false, error: "Task not found." };
  if (!c.isManager) return { ok: false, error: "Only the project manager can ask for a revision." };
  if (c.closed) return { ok: false, error: "This project is closed." };
  let revision = 0;
  try {
    revision = (await requestRevision(db, { projectId: c.task.projectId, taskId: c.task.id, actorId: user.id, comment: String(comment ?? "") })).revision;
  } catch (e) { return fail(e); }
  await audit(user, { action: "task.revision", entity: "Task", entityId: c.task.id, after: { status: "IN_PROGRESS", revision, comment: String(comment).trim() } });
  if (c.task.assigneeId && c.task.assigneeId !== user.id) {
    await notify(db, c.task.assigneeId, { kind: "task.revision", title: `Revision needed: ${c.task.title}`, body: String(comment).trim().slice(0, 160), link: `/projects/${c.task.projectId}?task=${c.task.id}`, dedupeKey: `task-revision:${c.task.id}:${revision}` });
  }
  revalidatePath(`/projects/${c.task.projectId}`);
  return { ok: true };
}

// Anyone on the task's team (or its assignee, or a manager) can report a problem on it.
export async function reportIssueAction(taskId: string, body: string): Promise<ReviewActionResult> {
  const user = await requirePermission("tasks.edit");
  const c = await taskIn(user, taskId);
  if (!c || !c.onTeam) return { ok: false, error: "Task not found." };
  let id = "";
  try {
    id = (await reportIssue(db, { organizationId: user.organizationId, projectId: c.task.projectId, taskId: c.task.id, actorId: user.id, body: String(body ?? "") })).id;
  } catch (e) { return fail(e); }
  await audit(user, { action: "task.issue", entity: "TaskIssue", entityId: id, after: { taskId: c.task.id } });
  revalidatePath(`/projects/${c.task.projectId}`);
  return { ok: true };
}

export async function resolveIssueAction(issueId: string, resolution: string): Promise<ReviewActionResult> {
  const user = await requirePermission("tasks.edit");
  const issue = await db.taskIssue.findUnique({ where: { id: String(issueId) }, select: { id: true, taskId: true } });
  const c = issue ? await taskIn(user, issue.taskId) : null;
  if (!issue || !c) return { ok: false, error: "Issue not found." };
  try {
    await resolveIssue(db, { organizationId: user.organizationId, issueId: issue.id, actorId: user.id, canManageAll: user.permissions.has("projects.manage"), resolution: String(resolution ?? "") });
  } catch (e) { return fail(e); }
  await audit(user, { action: "task.issue_resolve", entity: "TaskIssue", entityId: issue.id, after: { resolution: String(resolution).trim().slice(0, 200) } });
  revalidatePath(`/projects/${c.task.projectId}`);
  return { ok: true };
}
