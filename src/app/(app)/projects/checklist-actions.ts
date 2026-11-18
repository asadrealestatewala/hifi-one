"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { audit, requirePermission, type SessionUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { projectScope } from "@/lib/projects";
import { addChecklistItems, applySavedChecklist, deleteSavedChecklist, removeChecklistItem, saveChecklist, splitItems, tickChecklistItem } from "@/lib/task-checklists";

export type ChecklistActionResult = { ok: true; message?: string } | { ok: false; error: string };

// Whoever may move the task works its checklist: the project manager (or projects.manage) and the task's assignee,
// on a project that is still open.
async function workableTask(user: SessionUser, taskId: string) {
  const task = await db.task.findUnique({ where: { id: taskId }, select: { id: true, projectId: true, assigneeId: true, title: true } });
  const project = task ? await db.project.findFirst({ where: { id: task.projectId, ...projectScope(user) }, select: { id: true, managerId: true, status: true } }) : null;
  if (!task || !project) return { user, error: "Task not found." } as const;
  if (project.status === "COMPLETED" || project.status === "CANCELLED") return { user, error: "This project is closed." } as const;
  const isManager = user.permissions.has("projects.manage") || project.managerId === user.id;
  if (!isManager && task.assigneeId !== user.id) return { user, error: "Only the project manager or the person the task is assigned to can change its checklist." } as const;
  return { user, task, error: null } as const;
}

export async function addChecklistItemsAction(taskId: string, text: string): Promise<ChecklistActionResult> {
  const w = await workableTask(await requirePermission("tasks.edit"), String(taskId));
  if (w.error !== null) return { ok: false, error: w.error };
  const r = await addChecklistItems(db, { taskId: w.task.id, texts: splitItems(String(text ?? "")) });
  if (!r.ok) return r;
  await audit(w.user, { action: "task.checklist_add", entity: "Task", entityId: w.task.id, after: { added: r.value.added } });
  revalidatePath(`/projects/${w.task.projectId}`);
  return { ok: true };
}

export async function tickChecklistItemAction(taskId: string, itemId: string, done: boolean): Promise<ChecklistActionResult> {
  const w = await workableTask(await requirePermission("tasks.edit"), String(taskId));
  if (w.error !== null) return { ok: false, error: w.error };
  // Who ticked it and when is kept on the item itself
  const r = await tickChecklistItem(db, { taskId: w.task.id, itemId: String(itemId), done: Boolean(done), userId: w.user.id });
  if (!r.ok) return r;
  revalidatePath(`/projects/${w.task.projectId}`);
  return { ok: true };
}

export async function removeChecklistItemAction(taskId: string, itemId: string): Promise<ChecklistActionResult> {
  const w = await workableTask(await requirePermission("tasks.edit"), String(taskId));
  if (w.error !== null) return { ok: false, error: w.error };
  const r = await removeChecklistItem(db, { taskId: w.task.id, itemId: String(itemId) });
  if (!r.ok) return r;
  await audit(w.user, { action: "task.checklist_remove", entity: "Task", entityId: w.task.id, before: { item: r.value.text } });
  revalidatePath(`/projects/${w.task.projectId}`);
  return { ok: true };
}

export async function applySavedChecklistAction(taskId: string, templateId: string): Promise<ChecklistActionResult> {
  const w = await workableTask(await requirePermission("tasks.edit"), String(taskId));
  if (w.error !== null) return { ok: false, error: w.error };
  const r = await applySavedChecklist(db, { organizationId: w.user.organizationId, templateId: String(templateId), taskId: w.task.id });
  if (!r.ok) return r;
  await audit(w.user, { action: "task.checklist_apply", entity: "Task", entityId: w.task.id, after: { checklist: r.value.name, added: r.value.added } });
  revalidatePath(`/projects/${w.task.projectId}`);
  return { ok: true, message: r.value.added ? `Added ${r.value.added} item${r.value.added === 1 ? "" : "s"} from ${r.value.name}.` : `Everything in ${r.value.name} is already on this checklist.` };
}

// Saving and deleting the organization's shared checklists is for people who manage projects
export async function saveChecklistAction(taskId: string, name: string): Promise<ChecklistActionResult> {
  const user = await requirePermission("projects.manage");
  const task = await db.task.findFirst({ where: { id: String(taskId), project: projectScope(user) }, select: { id: true } });
  if (!task) return { ok: false, error: "Task not found." };
  const items = (await db.taskChecklistItem.findMany({ where: { taskId: task.id }, orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }], select: { text: true } })).map((i) => i.text);
  const r = await saveChecklist(db, { organizationId: user.organizationId, name: String(name ?? ""), items, byUserId: user.id });
  if (!r.ok) return r;
  await audit(user, { action: "checklist_template.create", entity: "ChecklistTemplate", entityId: r.value.id, after: { name: r.value.name, items: items.length } });
  revalidatePath("/projects");
  return { ok: true, message: `Saved as ${r.value.name}. It can now be added to any task.` };
}

export async function deleteSavedChecklistAction(formData: FormData): Promise<void> {
  const user = await requirePermission("projects.manage");
  const r = await deleteSavedChecklist(db, { organizationId: user.organizationId, id: String(formData.get("id") ?? "") });
  if (r.ok) await audit(user, { action: "checklist_template.delete", entity: "ChecklistTemplate", before: { name: r.value.name } });
  revalidatePath("/projects");
  redirect(`/projects?view=templates&ok=${encodeURIComponent(r.ok ? `Deleted the saved checklist ${r.value.name}. Tasks that already have its items keep them.` : r.error)}`);
}
