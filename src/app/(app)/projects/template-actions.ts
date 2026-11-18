"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { audit, requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";
import { projectScope } from "@/lib/projects";
import { addStarterTemplates, saveTemplate, templateFromProject } from "@/lib/project-templates";

// Project templates, managed by people with projects.manage under Projects → Templates.
export type TemplateSaveResult = { ok: true; id: string } | { ok: false; error: string };

export async function saveTemplateAction(input: { id?: string; name: string; description: string; body: unknown }): Promise<TemplateSaveResult> {
  const user = await requirePermission("projects.manage");
  const r = await saveTemplate(db, { organizationId: user.organizationId, id: input.id || undefined, name: String(input.name ?? ""), description: String(input.description ?? ""), body: input.body, byUserId: user.id });
  if (!r.ok) return r;
  await audit(user, { action: input.id ? "project_template.update" : "project_template.create", entity: "ProjectTemplate", entityId: r.value.id, after: { name: r.value.name } });
  revalidatePath("/projects");
  return { ok: true, id: r.value.id };
}

export async function addStarterTemplatesAction(): Promise<void> {
  const user = await requirePermission("projects.manage");
  const added = await addStarterTemplates(db, { organizationId: user.organizationId, byUserId: user.id });
  for (const name of added) await audit(user, { action: "project_template.create", entity: "ProjectTemplate", after: { name, starter: true } });
  revalidatePath("/projects");
  redirect(`/projects?view=templates&ok=${encodeURIComponent(added.length ? `Added ${added.join(" and ")}. Change them to fit how your team works.` : "The starter templates are already there.")}`);
}

export async function archiveTemplateAction(formData: FormData): Promise<void> {
  const user = await requirePermission("projects.manage");
  const id = String(formData.get("id") ?? "");
  const restore = formData.get("restore") === "1";
  const t = await db.projectTemplate.findFirst({ where: { id, organizationId: user.organizationId } });
  if (!t) redirect("/projects?view=templates");
  await db.projectTemplate.update({ where: { id: t.id }, data: { archivedAt: restore ? null : new Date() } });
  await audit(user, { action: restore ? "project_template.restore" : "project_template.archive", entity: "ProjectTemplate", entityId: t.id, before: { name: t.name } });
  revalidatePath("/projects");
  redirect(`/projects?view=templates&ok=${encodeURIComponent(restore ? `Restored ${t.name}.` : `Archived ${t.name}. Projects already made from it keep their tasks.`)}`);
}

// Settings → Save as template on a project page
export async function saveProjectAsTemplateAction(formData: FormData): Promise<void> {
  const user = await requirePermission("projects.manage");
  const projectId = String(formData.get("projectId") ?? "");
  const project = await db.project.findFirst({ where: { id: projectId, ...projectScope(user) }, select: { id: true, name: true } });
  if (!project) redirect("/projects");
  const body = await templateFromProject(db, { organizationId: user.organizationId, projectId: project.id });
  if (!body.ok) redirect(`/projects/${project.id}?error=${encodeURIComponent(body.error)}&tab=settings`);
  const r = await saveTemplate(db, { organizationId: user.organizationId, name: String(formData.get("name") ?? ""), description: `Made from ${project.name}.`, body: body.value, byUserId: user.id });
  if (!r.ok) redirect(`/projects/${project.id}?error=${encodeURIComponent(r.error)}&tab=settings`);
  await audit(user, { action: "project_template.create", entity: "ProjectTemplate", entityId: r.value.id, after: { name: r.value.name, fromProject: project.id } });
  revalidatePath("/projects");
  redirect(`/projects/templates/${r.value.id}?saved=1`);
}
