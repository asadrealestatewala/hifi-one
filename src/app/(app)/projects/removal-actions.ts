"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { audit, requirePermission, type SessionUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { projectScope } from "@/lib/projects";
import { RemovalError, archiveProject, deleteProject, nameMatches, restoreProject } from "@/lib/record-removal";

// Archive, restore and permanent delete of a project. Only people with "records.delete" (Super Admin has it).
const back = (id: string, key: "error" | "removed", text: string): never => redirect(`/projects/${id}?${key}=${encodeURIComponent(text)}&tab=settings`);

const load = (user: SessionUser, projectId: string) => db.project.findFirst({ where: { id: projectId, ...projectScope(user) } });

export async function archiveProjectAction(formData: FormData): Promise<void> {
  const projectId = String(formData.get("projectId") ?? "");
  const user = await requirePermission("records.delete");
  const project = await load(user, projectId);
  if (!project) return back(projectId, "error", "Project not found.");
  try {
    await archiveProject(db, user.organizationId, project.id, user.id);
  } catch (e) {
    if (e instanceof RemovalError) return back(project.id, "error", e.message);
    throw e;
  }
  await audit(user, { action: "project.archive", entity: "Project", entityId: project.id, before: { archived: false }, after: { archived: true, number: project.number, name: project.name } });
  revalidatePath("/projects");
  back(project.id, "removed", "Project archived. It no longer shows in project lists.");
}

export async function restoreProjectAction(formData: FormData): Promise<void> {
  const projectId = String(formData.get("projectId") ?? "");
  const user = await requirePermission("records.delete");
  const project = await load(user, projectId);
  if (!project) return back(projectId, "error", "Project not found.");
  try {
    await restoreProject(db, user.organizationId, project.id);
  } catch (e) {
    if (e instanceof RemovalError) return back(project.id, "error", e.message);
    throw e;
  }
  await audit(user, { action: "project.restore", entity: "Project", entityId: project.id, before: { archived: true }, after: { archived: false } });
  revalidatePath("/projects");
  back(project.id, "removed", "Project restored to the project lists.");
}

export async function deleteProjectAction(formData: FormData): Promise<void> {
  const projectId = String(formData.get("projectId") ?? "");
  const user = await requirePermission("records.delete");
  const project = await load(user, projectId);
  if (!project) return back(projectId, "error", "Project not found.");
  if (!nameMatches(formData.get("confirmName"), project.name)) return back(project.id, "error", "The name you typed did not match, so nothing was deleted.");
  let tasks = 0;
  try {
    tasks = (await deleteProject(db, user.organizationId, project.id)).tasks;
  } catch (e) {
    if (e instanceof RemovalError) return back(project.id, "error", e.message);
    throw e;
  }
  await audit(user, {
    action: "project.delete", entity: "Project", entityId: project.id,
    before: { number: project.number, name: project.name, clientId: project.clientId, status: project.status, managerId: project.managerId, tasks },
    after: null,
  });
  revalidatePath("/projects");
  redirect(`/projects?deleted=${encodeURIComponent(`${project.number} ${project.name}`)}`);
}
