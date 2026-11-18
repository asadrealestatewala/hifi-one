"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { audit, requirePermission, toFileActor } from "@/lib/auth";
import { db } from "@/lib/db";
import { DeliverableError, createDeliverable, editDeliverable, submitForApproval } from "@/lib/deliverables";
import { projectScope } from "@/lib/projects";
import { addProofComment, attachProof, resolveProofComment } from "@/lib/proofing";
import { defaultStorage } from "@/lib/storage";

const s = (f: FormData, k: string) => String(f.get(k) ?? "");
const back = (projectId: string, kind: "error" | "msg", m: string) => redirect(`/projects/${projectId}?${kind}=${encodeURIComponent(m)}&tab=deliverables#deliverables`);

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

// Proofing: attach the design to a draft, comment on it, tick comments off
const proofBack = (projectId: string, id: string, q: string) => redirect(`/projects/${encodeURIComponent(projectId)}/deliverables/${encodeURIComponent(id)}?${q}`);

export async function attachProofAction(formData: FormData): Promise<void> {
  const user = await requirePermission("projects.view");
  const projectId = s(formData, "projectId"), id = s(formData, "deliverableId");
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return proofBack(projectId, id, `error=${encodeURIComponent("Choose the design file to attach.")}`);
  try {
    const f = await attachProof(db, defaultStorage(), { actor: toFileActor(user), deliverableId: id, name: file.name, bytes: Buffer.from(await file.arrayBuffer()) });
    await audit(user, { action: "deliverable.proof", entity: "Deliverable", entityId: id, after: { fileId: f.id, name: f.filename } });
  } catch (e) {
    if (e instanceof DeliverableError) return proofBack(projectId, id, `error=${encodeURIComponent(e.message)}`);
    throw e;
  }
  revalidatePath(`/projects/${projectId}`);
  proofBack(projectId, id, "ok=attached");
}

export async function staffProofCommentAction(formData: FormData): Promise<void> {
  const user = await requirePermission("projects.view");
  const projectId = s(formData, "projectId"), id = s(formData, "deliverableId");
  const num = (k: string) => { const v = s(formData, k).trim(); return v === "" ? null : Number(v); };
  try {
    const c = await addProofComment(db, { actor: toFileActor(user), deliverableId: id, body: s(formData, "body"), x: num("x"), y: num("y"), page: num("page") });
    await audit(user, { action: "deliverable.proof_comment", entity: "Deliverable", entityId: id, after: { commentId: c.id } });
  } catch (e) {
    if (e instanceof DeliverableError) return proofBack(projectId, id, `error=${encodeURIComponent(e.message)}`);
    throw e;
  }
  proofBack(projectId, id, "ok=commented");
}

export async function resolveProofCommentAction(formData: FormData): Promise<void> {
  const user = await requirePermission("projects.view");
  const projectId = s(formData, "projectId"), id = s(formData, "deliverableId");
  try {
    await resolveProofComment(db, { actor: toFileActor(user), commentId: s(formData, "commentId"), resolved: s(formData, "resolved") === "1" });
    await audit(user, { action: "deliverable.proof_resolve", entity: "Deliverable", entityId: id, after: { commentId: s(formData, "commentId"), resolved: s(formData, "resolved") === "1" } });
  } catch (e) {
    if (e instanceof DeliverableError) return proofBack(projectId, id, `error=${encodeURIComponent(e.message)}`);
    throw e;
  }
  proofBack(projectId, id, "ok=saved");
}
