"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { audit, requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";
import { projectScope } from "@/lib/projects";
import { UpdateError, postUpdate, setUpdateVisibility } from "@/lib/project-updates";

const s = (f: FormData, k: string) => String(f.get(k) ?? "");
const back = (projectId: string, kind: "error" | "msg", m: string) => redirect(`/projects/${projectId}?${kind}=${encodeURIComponent(m)}#updates`);

// Posts to a project's updates feed (anyone who can edit tasks on a project they belong to); only a project manager changes the phase.
export async function postUpdateAction(formData: FormData): Promise<void> {
  const user = await requirePermission("tasks.edit");
  const projectId = s(formData, "projectId");
  if (!(await db.project.findFirst({ where: { id: projectId, ...projectScope(user) }, select: { id: true } }))) return back(projectId, "error", "Project not found.");
  try {
    const u = await postUpdate(db, {
      organizationId: user.organizationId, projectId, authorId: user.id, kind: s(formData, "kind"), title: s(formData, "title"), body: s(formData, "body"),
      phase: s(formData, "phase"), visibleToClient: formData.get("visibleToClient") === "on", canSetPhase: user.permissions.has("projects.manage"),
    });
    await audit(user, { action: "project.update_posted", entity: "ProjectUpdate", entityId: u.id, after: { kind: u.kind, title: u.title, phase: u.phase, visibleToClient: u.visibleToClient } });
  } catch (e) {
    if (e instanceof UpdateError) return back(projectId, "error", e.message);
    throw e;
  }
  revalidatePath(`/projects/${projectId}`);
  back(projectId, "msg", "Update posted.");
}

export async function updateVisibilityAction(formData: FormData): Promise<void> {
  const user = await requirePermission("tasks.edit");
  const projectId = s(formData, "projectId");
  if (!(await db.project.findFirst({ where: { id: projectId, ...projectScope(user) }, select: { id: true } }))) return back(projectId, "error", "Project not found.");
  const updateId = s(formData, "id");
  const show = s(formData, "show") === "1";
  try {
    if (!(await db.projectUpdate.findFirst({ where: { id: updateId, projectId, organizationId: user.organizationId }, select: { id: true } }))) return back(projectId, "error", "Update not found.");
    await setUpdateVisibility(db, { organizationId: user.organizationId, updateId, visibleToClient: show });
    await audit(user, { action: "project.update_visibility", entity: "ProjectUpdate", entityId: updateId, after: { visibleToClient: show } });
  } catch (e) {
    if (e instanceof UpdateError) return back(projectId, "error", e.message);
    throw e;
  }
  revalidatePath(`/projects/${projectId}`);
  back(projectId, "msg", show ? "Now shown to the client." : "Hidden from the client.");
}
