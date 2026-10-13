"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { audit, requirePermission, requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { projectScope } from "@/lib/projects";
import { commentSharedWithClient, projectMemberAdded, projectStatusChanged, taskAssigned, taskCommented, taskMoved } from "@/lib/events";
import { TASK_STATUSES, canCompleteProject } from "@/lib/project-rules";
import { TaskError, addComment, addSubtask, changeTaskStatus, setBlockers, setRecurrence } from "@/lib/tasks";

const optDate = z.string().optional().transform((v) => (v ? new Date(v) : null));

const projectSchema = z.object({
  name: z.string().trim().min(2, "Project name is required").max(200),
  clientId: z.string().optional().transform((v) => (v ? v : null)),
  priority: z.enum(["LOW", "MEDIUM", "HIGH"]).default("MEDIUM"),
  startDate: optDate,
  deadline: optDate,
  budgetAmount: z.string().trim().optional().transform((v) => (v ? v : null)),
  currency: z.enum(["PKR", "USD", "AED", "GBP"]).default("USD"),
  scope: z.string().trim().max(2000).optional().transform((v) => (v ? v : null)),
});

export async function createProject(formData: FormData) {
  const user = await requirePermission("projects.manage");
  const parsed = projectSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) redirect(`/projects?new=1&error=${encodeURIComponent(parsed.error.issues[0].message)}`);
  const d = parsed.data;
  if (d.budgetAmount !== null && !/^\d{1,12}(\.\d{1,2})?$/.test(d.budgetAmount)) {
    redirect(`/projects?new=1&error=${encodeURIComponent("Budget must be a positive number")}`);
  }
  if (d.clientId && !(await db.client.findFirst({ where: { id: d.clientId, organizationId: user.organizationId } }))) {
    redirect(`/projects?new=1&error=${encodeURIComponent("Unknown client")}`);
  }
  const project = await db.$transaction(async (tx) => {
    const seq = await tx.numberSequence.upsert({
      where: { organizationId_key: { organizationId: user.organizationId, key: "PRJ" } },
      create: { organizationId: user.organizationId, key: "PRJ", next: 2 },
      update: { next: { increment: 1 } },
    });
    return tx.project.create({
      data: {
        ...d, organizationId: user.organizationId, managerId: user.id,
        number: `PRJ-${String(seq.next - 1).padStart(4, "0")}`,
        members: { create: { userId: user.id, role: "Project Manager" } },
      },
    });
  });
  await audit(user, { action: "project.create", entity: "Project", entityId: project.id, after: { number: project.number, name: project.name } });
  redirect(`/projects/${project.id}`);
}

async function loadProject(projectId: string, user: Awaited<ReturnType<typeof requireUser>>) {
  return db.project.findFirst({ where: { id: projectId, ...projectScope(user) } });
}

export async function addMember(formData: FormData) {
  const user = await requirePermission("projects.manage");
  const projectId = String(formData.get("projectId"));
  const userId = String(formData.get("userId"));
  const role = String(formData.get("role") ?? "").trim().slice(0, 80) || null;
  const project = await loadProject(projectId, user);
  const member = await db.user.findFirst({ where: { id: userId, organizationId: user.organizationId, active: true } });
  if (!project || !member) return;
  await db.projectMember.upsert({
    where: { projectId_userId: { projectId, userId } }, update: { role }, create: { projectId, userId, role },
  });
  await audit(user, { action: "project.add_member", entity: "Project", entityId: projectId, after: { userId, role } });
  await projectMemberAdded(db, { organizationId: user.organizationId, projectId, userId, byUserId: user.id, role });
  revalidatePath(`/projects/${projectId}`);
}

export async function createTask(formData: FormData) {
  const user = await requirePermission("projects.manage");
  const projectId = String(formData.get("projectId"));
  const title = String(formData.get("title") ?? "").trim().slice(0, 200);
  const assigneeId = String(formData.get("assigneeId") ?? "") || null;
  const dueRaw = String(formData.get("dueDate") ?? "");
  const project = await loadProject(projectId, user);
  if (!project || title.length < 2) return;
  if (assigneeId && !(await db.projectMember.findUnique({ where: { projectId_userId: { projectId, userId: assigneeId } } }))) return;
  const task = await db.task.create({
    data: {
      projectId, title, assigneeId, createdById: user.id,
      priority: z.enum(["LOW", "MEDIUM", "HIGH"]).catch("MEDIUM").parse(formData.get("priority")),
      dueDate: dueRaw ? new Date(dueRaw) : null,
      clientVisible: formData.get("clientVisible") === "on",
    },
  });
  await audit(user, { action: "task.create", entity: "Task", entityId: task.id, after: { title, projectId, assigneeId } });
  await taskAssigned(db, { organizationId: user.organizationId, taskId: task.id, toUserId: assigneeId, byUserId: user.id });
  revalidatePath(`/projects/${projectId}`);
}

export type MoveResult = { ok: true } | { ok: false; error: string };

// Persisted by the board (drag and drop) and the status menu. Managers can move any task;
// other members can move only tasks assigned to them.
export async function moveTask(taskId: string, status: string): Promise<MoveResult> {
  const user = await requirePermission("tasks.edit");
  if (!(TASK_STATUSES as readonly string[]).includes(status)) return { ok: false, error: "Unknown status." };
  const task = await db.task.findUnique({ where: { id: taskId }, include: { project: true } });
  if (!task) return { ok: false, error: "Task not found." };
  const project = await loadProject(task.projectId, user);
  if (!project) return { ok: false, error: "Task not found." };
  const isManager = user.permissions.has("projects.manage") || project.managerId === user.id;
  if (!isManager && task.assigneeId !== user.id) return { ok: false, error: "You can only move tasks assigned to you." };
  if (project.status === "COMPLETED" || project.status === "CANCELLED") return { ok: false, error: "This project is closed." };
  if (task.status === status) return { ok: true };
  try {
    const r = await changeTaskStatus(db, { projectId: task.projectId, taskId, status, actorId: user.id });
    await audit(user, { action: "task.move", entity: "Task", entityId: taskId, before: { status: task.status }, after: { status, nextOccurrence: r.next?.id ?? null } });
    await taskMoved(db, { organizationId: user.organizationId, taskId, status, byUserId: user.id });
  } catch (e) {
    if (e instanceof TaskError) return { ok: false, error: e.message };
    throw e;
  }
  revalidatePath(`/projects/${task.projectId}`);
  return { ok: true };
}

export async function setProjectStatus(formData: FormData) {
  const user = await requirePermission("projects.manage");
  const projectId = String(formData.get("projectId"));
  const status = z.enum(["ACTIVE", "ON_HOLD", "COMPLETED", "CANCELLED"]).safeParse(formData.get("status"));
  const project = await loadProject(projectId, user);
  if (!status.success || !project) return;
  if (status.data === "COMPLETED") {
    const tasks = await db.task.findMany({ where: { projectId }, select: { status: true } });
    const check = canCompleteProject(tasks);
    if (!check.ok) redirect(`/projects/${projectId}?error=${encodeURIComponent(check.reason)}`);
  }
  await db.project.update({ where: { id: projectId }, data: { status: status.data } });
  await audit(user, { action: "project.status", entity: "Project", entityId: projectId, before: { status: project.status }, after: { status: status.data } });
  if (status.data !== project.status) await projectStatusChanged(db, { organizationId: user.organizationId, projectId, status: status.data, byUserId: user.id });
  revalidatePath(`/projects/${projectId}`);
}


export type TaskActionResult = { ok: boolean; error?: string };

// The task detail panel: who may change a task's structure (subtasks, blockers, repeat, details) is the project manager or anyone with project management rights.
async function manageTask(user: Awaited<ReturnType<typeof requireUser>>, taskId: string) {
  const task = await db.task.findUnique({ where: { id: taskId } });
  const project = task ? await loadProject(task.projectId, user) : null;
  if (!task || !project) return null;
  const isManager = user.permissions.has("projects.manage") || project.managerId === user.id;
  const closed = project.status === "COMPLETED" || project.status === "CANCELLED";
  return { user, task, project, isManager, closed };
}

export async function addSubtaskAction(taskId: string, title: string): Promise<TaskActionResult> {
  const user = await requirePermission("tasks.edit");
  const c = await manageTask(user, taskId);
  if (!c) return { ok: false, error: "Task not found." };
  if (!c.isManager && c.task.assigneeId !== c.user.id) return { ok: false, error: "Only the project manager or the assignee can add subtasks." };
  if (c.closed) return { ok: false, error: "This project is closed." };
  try {
    const t = await addSubtask(db, { projectId: c.task.projectId, parentId: taskId, title, assigneeId: c.task.assigneeId, actorId: c.user.id });
    await audit(c.user, { action: "task.subtask", entity: "Task", entityId: t.id, after: { parent: taskId, title: t.title } });
  } catch (e) {
    if (e instanceof TaskError) return { ok: false, error: e.message };
    throw e;
  }
  revalidatePath(`/projects/${c.task.projectId}`);
  return { ok: true };
}

export async function saveTaskDetailAction(taskId: string, formData: FormData): Promise<TaskActionResult> {
  const user = await requirePermission("tasks.edit");
  const c = await manageTask(user, taskId);
  if (!c) return { ok: false, error: "Task not found." };
  if (!c.isManager) return { ok: false, error: "Only the project manager can change task details." };
  if (c.closed) return { ok: false, error: "This project is closed." };
  const blockers = formData.getAll("blockedBy").map(String);
  const recurrence = String(formData.get("recurrence") ?? "") || null;
  const due = String(formData.get("dueDate") ?? "");
  const assigneeId = String(formData.get("assigneeId") ?? "") || null;
  const priority = z.enum(["LOW", "MEDIUM", "HIGH"]).safeParse(formData.get("priority"));
  if (due && Number.isNaN(Date.parse(due))) return { ok: false, error: "Enter a valid due date." };
  if (assigneeId && !(await db.projectMember.findUnique({ where: { projectId_userId: { projectId: c.task.projectId, userId: assigneeId } } }))) return { ok: false, error: "Assign tasks to project members." };
  try {
    await setBlockers(db, { projectId: c.task.projectId, taskId, blockerIds: blockers });
    await setRecurrence(db, { projectId: c.task.projectId, taskId, recurrence });
    await db.task.update({ where: { id: taskId }, data: { dueDate: due ? new Date(due) : null, assigneeId, description: String(formData.get("description") ?? "").trim().slice(0, 4000) || null, ...(priority.success ? { priority: priority.data } : {}), clientVisible: formData.get("clientVisible") === "on" } });
    await audit(c.user, { action: "task.update", entity: "Task", entityId: taskId, after: { blockers: blockers.length, recurrence, assigneeId } });
    if (assigneeId !== c.task.assigneeId) await taskAssigned(db, { organizationId: c.user.organizationId, taskId, toUserId: assigneeId, byUserId: c.user.id });
  } catch (e) {
    if (e instanceof TaskError) return { ok: false, error: e.message };
    throw e;
  }
  revalidatePath(`/projects/${c.task.projectId}`);
  return { ok: true };
}

export async function addTaskCommentAction(taskId: string, body: string, shareWithClient = false): Promise<TaskActionResult> {
  const user = await requirePermission("tasks.edit");
  const c = await manageTask(user, taskId);
  if (!c) return { ok: false, error: "Task not found." };
  try {
    const share = shareWithClient && c.task.clientVisible && Boolean(c.project.clientId);
    const comment = await addComment(db, { projectId: c.task.projectId, taskId, authorId: c.user.id, body, internal: !share });
    await audit(c.user, { action: "task.comment", entity: "Task", entityId: taskId });
    await taskCommented(db, { organizationId: c.user.organizationId, taskId, commentId: comment.id, authorId: c.user.id, body });
    if (share) await commentSharedWithClient(db, { organizationId: c.user.organizationId, taskId, commentId: comment.id, authorId: c.user.id });
  } catch (e) {
    if (e instanceof TaskError) return { ok: false, error: e.message };
    throw e;
  }
  revalidatePath(`/projects/${c.task.projectId}`);
  return { ok: true };
}
