"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { audit, requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";
import { DeliverableError, createDeliverable, editDeliverable, submitForApproval } from "@/lib/deliverables";
import { projectScope } from "@/lib/projects";

const s = (f: FormData, k: string) => String(f.get(k) ?? "");
const back = (projectId: string, kind: "error" | "msg", m: string) => redirect(`/projects/${projectId}?${kind}=${encodeURIComponent(m)}#deliverables`);

export async function deliverableAction(formData: FormData): Promise<void> {
  const user = await requirePermission("projects.manage");
  const projectId = s(formData, "projectId");
  // The person must also be able to see this project (record scope), not just hold the permission
  if (!(await db.project.findFirst({ where: { id: projectId, ...projectScope(user) }, select: { id: true } }))) return back(projectId, "error", "Project not found.");
  const op = s(formData, "op");
  try {
    if (op === "create") {
      const d = await createDeliverable(db, { organizationId: user.organizationId, projectId, actorId: user.id, title: s(formData, "title"), description: s(formData, "description"), link: s(formData, "link") });
      await audit(user, { action: "deliverable.create", entity: "Deliverable", entityId: d.id, after: { title: d.title } });
    } else {
      const id = s(formData, "id");
      const mine = await db.deliverable.findFirst({ where: { id, projectId, organizationId: user.organizationId }, select: { id: true } });
      if (!mine) return back(projectId, "error", "Deliverable not found.");
      if (op === "edit") {
        await editDeliverable(db, { organizationId: user.organizationId, id, title: s(formData, "title"), description: s(formData, "description"), link: s(formData, "link") });
        await audit(user, { action: "deliverable.edit", entity: "Deliverable", entityId: id });
      } else if (op === "submit") {
        await submitForApproval(db, { organizationId: user.organizationId, id, actorId: user.id });
        await audit(user, { action: "deliverable.submit", entity: "Deliverable", entityId: id });
      }
    }
  } catch (e) {
    if (e instanceof DeliverableError) return back(projectId, "error", e.message);
    throw e;
  }
  revalidatePath(`/projects/${projectId}`);
  back(projectId, "msg", op === "submit" ? "Sent to the client for approval." : "Saved.");
}
