"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { audit, requirePermission, requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { projectScope } from "@/lib/projects";
import { commentSharedWithClient, projectMemberAdded, projectStatusChanged, taskAssigned, taskCommented, taskMoved } from "@/lib/events";
import { TASK_STATUSES, canCompleteProject } from "@/lib/project-rules";
import { removeProjectMember, setProjectManager, setProjectMemberRole, type Handover } from "@/lib/project-manager";
import { TaskError, addComment, addSubtask, changeTaskStatus, setBlockers, setRecurrence } from "@/lib/tasks";
import { parseEstimate } from "@/lib/task-rules";
import { validLabelIds } from "@/lib/task-labels";
import { applyTemplate, parseTemplateBody } from "@/lib/project-templates";
import { BULK_LIMIT, bulkEditTasks, type BulkChange, type BulkSkip } from "@/lib/task-bulk";
import { notify } from "@/lib/notifications";

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
  managerId: z.string().optional().transform((v) => (v ? v : null)),
});

export async function createProject(formData: FormData) {
  const user = await requirePermission("projects.manage");
  // A failed form goes back to the same template choice
  const tq = formData.get("templateId") ? `&template=${encodeURIComponent(String(formData.get("templateId")))}` : "";
  const parsed = projectSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) redirect(`/projects?new=1&error=${encodeURIComponent(parsed.error.issues[0].message)}${tq}`);
  const { managerId: chosenManager, ...d } = parsed.data;
  const managerId = chosenManager ?? user.id;
  if (managerId !== user.id && !(await db.user.findFirst({ where: { id: managerId, organizationId: user.organizationId, active: true, userType: "EMPLOYEE" } }))) {
    redirect(`/projects?new=1&error=${encodeURIComponent("Choose an active staff member as project manager")}${tq}`);
  }
  if (d.budgetAmount !== null && !/^\d{1,12}(\.\d{1,2})?$/.test(d.budgetAmount)) {
    redirect(`/projects?new=1&error=${encodeURIComponent("Budget must be a positive number")}${tq}`);
  }
  if (d.clientId && !(await db.client.findFirst({ where: { id: d.clientId, organizationId: user.organizationId } }))) {
    redirect(`/projects?new=1&error=${encodeURIComponent("Unknown client")}${tq}`);
  }
  // Starting from a template: its plan is copied in, and each role is filled by the person picked for it
  const templateId = String(formData.get("templateId") ?? "");
  const template = templateId ? await db.projectTemplate.findFirst({ where: { id: templateId, organizationId: user.organizationId, archivedAt: null } }) : null;
  if (templateId && !template) redirect(`/projects?new=1&error=${encodeURIComponent("That template is no longer available")}`);
  const body = template ? parseTemplateBody(template.body) : null;
  if (body && !body.ok) redirect(`/projects?new=1&error=${encodeURIComponent(`The template needs fixing first: ${body.error}`)}${tq}`);
  const roleAssignees: Record<string, string> = {};
  if (body?.ok) for (const [i, role] of body.value.roles.entries()) { const v = String(formData.get(`role${i}`) ?? ""); if (v) roleAssignees[role] = v; }
  const today = new Date().toISOString().slice(0, 10);
  const start = d.startDate ? d.startDate.toISOString().slice(0, 10) : today;
  let applied: Awaited<ReturnType<typeof applyTemplate>> | null = null;
  const project = await db.$transaction(async (tx) => {
    const seq = await tx.numberSequence.upsert({
      where: { organizationId_key: { organizationId: user.organizationId, key: "PRJ" } },
      create: { organizationId: user.organizationId, key: "PRJ", next: 2 },
      update: { next: { increment: 1 } },
    });
    const created = await tx.project.create({
      data: {
        ...d, organizationId: user.organizationId, managerId,
        number: `PRJ-${String(seq.next - 1).padStart(4, "0")}`,
        // The manager joins as "Project manager"; whoever created it for someone else stays on the team so they can still follow it
        members: { create: managerId === user.id ? [{ userId: managerId, role: "Project manager" }] : [{ userId: managerId, role: "Project manager" }, { userId: user.id }] },
        ...(template ? { templateId: template.id, startDate: d.startDate ?? new Date(`${start}T00:00:00.000Z`) } : {}),
      },
    });
    if (template && body?.ok) applied = await applyTemplate(tx, { organizationId: user.organizationId, projectId: created.id, body: body.value, start, roleAssignees, byUserId: user.id });
    return created;
  });
  const done = applied as Awaited<ReturnType<typeof applyTemplate>> | null;
  await audit(user, { action: "project.create", entity: "Project", entityId: project.id, after: { number: project.number, name: project.name, managerId, ...(template ? { template: template.name, tasks: done?.tasks ?? 0, milestones: done?.milestones ?? 0, labelsCreated: done?.labelsCreated ?? [] } : {}) } });
  if (managerId !== user.id) await projectMemberAdded(db, { organizationId: user.organizationId, projectId: project.id, userId: managerId, byUserId: user.id, role: "Project manager" });
  if (done && body?.ok) {
    // Everyone who filled a role hears once: they are on the team, and how many tasks are theirs
    for (const [uid, role] of done.joined) await projectMemberAdded(db, { organizationId: user.organizationId, projectId: project.id, userId: uid, byUserId: user.id, role });
    for (const [uid, n] of done.assigned) if (uid !== user.id) await notify(db, uid, { kind: "task.assigned", title: `${n} task${n === 1 ? "" : "s"} assigned to you in ${project.name}`, body: project.number, link: "/me/tasks" });
  }
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

// Takes someone off the team (not the manager). Their open tasks here go to another member, wait unassigned, or are deleted
// (tasks with logged time, files or a content post are kept). Finished tasks, time and history stay.
export async function removeMember(formData: FormData): Promise<void> {
  const user = await requirePermission("projects.manage");
  const projectId = String(formData.get("projectId") ?? "");
  const userId = String(formData.get("userId") ?? "");
  const project = await loadProject(projectId, user);
  if (!project) redirect("/projects");
  const h = String(formData.get("handover") ?? "unassign");
  const handover: Handover = h.startsWith("to:") ? { mode: "reassign", toUserId: h.slice(3) } : h === "delete" ? { mode: "delete" } : { mode: "unassign" };
  const r = await removeProjectMember(db, { organizationId: user.organizationId, projectId, userId, byUserId: user.id, handover });
  if (!r.ok) redirect(`/projects/${projectId}?error=${encodeURIComponent(r.error)}&tab=settings`);
  await audit(user, { action: "project.remove_member", entity: "Project", entityId: projectId, before: { userId }, after: { handover: handover.mode, toUserId: r.toUserId, reassigned: r.reassigned.length, unassigned: r.unassigned, deleted: r.deleted } });
  for (const taskId of r.reassigned) await taskAssigned(db, { organizationId: user.organizationId, taskId, toUserId: r.toUserId, byUserId: user.id });
  revalidatePath(`/projects/${projectId}`);
  revalidatePath("/projects");
  const n = (k: number) => `${k} open task${k === 1 ? "" : "s"}`;
  const parts = [
    r.reassigned.length ? `${n(r.reassigned.length)} handed over` : "",
    r.deleted ? `${n(r.deleted)} deleted` : "",
    r.unassigned ? `${n(r.unassigned)} now unassigned${handover.mode === "delete" ? " (kept because they have logged time, files or a content post)" : ""}` : "",
  ].filter(Boolean);
  redirect(`/projects/${projectId}?removed=${encodeURIComponent(`Removed from the team.${parts.length ? ` ${parts.join(", ")}.` : ""}`)}&tab=settings`);
}

export async function updateMemberRole(formData: FormData): Promise<void> {
  const user = await requirePermission("projects.manage");
  const projectId = String(formData.get("projectId") ?? "");
  const userId = String(formData.get("userId") ?? "");
  const project = await loadProject(projectId, user);
  if (!project) redirect("/projects");
  const before = await db.projectMember.findUnique({ where: { projectId_userId: { projectId, userId } }, select: { role: true } });
  const r = await setProjectMemberRole(db, { organizationId: user.organizationId, projectId, userId, role: String(formData.get("role") ?? "") });
  if (!r.ok) redirect(`/projects/${projectId}?error=${encodeURIComponent(r.error)}&tab=settings`);
  await audit(user, { action: "project.member_role", entity: "Project", entityId: projectId, before: { userId, role: before?.role ?? null }, after: { userId, role: r.role } });
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
  const estimate = parseEstimate(formData.get("estimatedHours"));
  const task = await db.task.create({
    data: {
      projectId, title, assigneeId, createdById: user.id,
      priority: z.enum(["LOW", "MEDIUM", "HIGH"]).catch("MEDIUM").parse(formData.get("priority")),
      dueDate: dueRaw ? new Date(dueRaw) : null,
      estimatedHours: estimate.ok ? estimate.value : null,
      clientVisible: formData.get("clientVisible") === "on",
    },
  });
  await audit(user, { action: "task.create", entity: "Task", entityId: task.id, after: { title, projectId, assigneeId } });
  await taskAssigned(db, { organizationId: user.organizationId, taskId: task.id, toUserId: assigneeId, byUserId: user.id });
  revalidatePath(`/projects/${projectId}`);
  // The form sits in a side panel on the Tasks tab; close it and show the board with the new task
  redirect(`/projects/${projectId}?tab=tasks`);
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

// Hands the project to another staff member (the previous manager stays on the team).
export async function changeProjectManager(formData: FormData): Promise<void> {
  const user = await requirePermission("projects.manage");
  const projectId = String(formData.get("projectId"));
  const project = await loadProject(projectId, user);
  if (!project) return;
  const r = await setProjectManager(db, { organizationId: user.organizationId, projectId, managerId: String(formData.get("managerId") ?? ""), byUserId: user.id });
  if (!r.ok) redirect(`/projects/${projectId}?error=${encodeURIComponent(r.error)}&tab=settings`);
  if (r.changed) await audit(user, { action: "project.manager", entity: "Project", entityId: projectId, before: { managerId: r.fromId }, after: { managerId: r.toId } });
  revalidatePath(`/projects/${projectId}`);
  revalidatePath("/projects");
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
    if (!check.ok) redirect(`/projects/${projectId}?error=${encodeURIComponent(check.reason)}&tab=settings`);
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
  const labelIds = await validLabelIds(db, user.organizationId, formData.getAll("labelIds").map(String));
  const estimate = parseEstimate(formData.get("estimatedHours"));
  if (!estimate.ok) return { ok: false, error: "Write the estimate in hours, for example 2 or 1.5." };
  if (assigneeId && !(await db.projectMember.findUnique({ where: { projectId_userId: { projectId: c.task.projectId, userId: assigneeId } } }))) return { ok: false, error: "Assign tasks to project members." };
  try {
    await setBlockers(db, { projectId: c.task.projectId, taskId, blockerIds: blockers });
    await setRecurrence(db, { projectId: c.task.projectId, taskId, recurrence });
    await db.task.update({ where: { id: taskId }, data: { dueDate: due ? new Date(due) : null, estimatedHours: estimate.value, labelIds, assigneeId, description: String(formData.get("description") ?? "").trim().slice(0, 4000) || null, ...(priority.success ? { priority: priority.data } : {}), clientVisible: formData.get("clientVisible") === "on" } });
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

export type BulkActionResult = { ok: true; message: string; skipped: BulkSkip[] } | { ok: false; error: string };

// The task list's bulk bar and its inline edits (one task is a batch of one). Rules per task live in bulkEditTasks.
export async function bulkTasksAction(taskIds: string[], change: BulkChange): Promise<BulkActionResult> {
  const user = await requirePermission("tasks.edit");
  if (!Array.isArray(taskIds) || taskIds.length === 0) return { ok: false, error: "Select at least one task." };
  if (taskIds.length > BULK_LIMIT) return { ok: false, error: `Select at most ${BULK_LIMIT} tasks at a time.` };
  let r;
  try {
    r = await bulkEditTasks(db, { actor: user, taskIds: taskIds.map(String), change });
  } catch (e) {
    if (e instanceof TaskError) return { ok: false, error: e.message };
    throw e;
  }
  const after = change.kind === "assign" ? { assigneeId: change.userId } : change.kind === "due" ? { dueDate: change.date } : change.kind === "estimate" ? { estimatedHours: change.hours } : change.kind === "label" ? { labelId: change.labelId, added: change.add } : change.kind === "priority" || change.kind === "status" ? { [change.kind]: change.value } : { deleted: true };
  for (const t of r.changed) await audit(user, { action: change.kind === "delete" ? "task.delete" : `task.bulk_${change.kind}`, entity: "Task", entityId: t.id, before: t.before, after });
  if (change.kind === "assign" && change.userId && change.userId !== user.id && r.changed.length) {
    if (r.changed.length === 1) await taskAssigned(db, { organizationId: user.organizationId, taskId: r.changed[0].id, toUserId: change.userId, byUserId: user.id });
    else await notify(db, change.userId, { kind: "task.assigned", title: `${user.name} assigned ${r.changed.length} tasks to you`, body: "They are in My tasks.", link: "/me/tasks" });
  }
  if (change.kind === "status") for (const t of r.changed) await taskMoved(db, { organizationId: user.organizationId, taskId: t.id, status: change.value, byUserId: user.id });
  for (const pid of new Set(r.changed.map((t) => t.projectId))) revalidatePath(`/projects/${pid}`);
  revalidatePath("/projects");
  revalidatePath("/me/tasks");
  const n = (k: number) => `${k} task${k === 1 ? "" : "s"}`;
  const done = change.kind === "delete" ? `Deleted ${n(r.deleted)}.` : `Updated ${n(r.changed.length)}.`;
  return { ok: true, message: `${done}${r.skipped.length ? ` ${n(r.skipped.length)} not changed.` : ""}`, skipped: r.skipped };
}
