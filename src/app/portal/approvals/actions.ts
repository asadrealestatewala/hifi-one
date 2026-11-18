"use server";

import { redirect } from "next/navigation";
import { audit, requireClientUser, toFileActor } from "@/lib/auth";
import { db } from "@/lib/db";
import { DeliverableError, decide } from "@/lib/deliverables";
import { addProofComment } from "@/lib/proofing";

const back = (id: string | null, q: string) => `/portal/approvals${id ? `/${encodeURIComponent(id)}` : ""}?${q}`;

// Approve, or ask for changes (a note, or comments already placed on the design). From the list or from the proof page.
export async function decideAction(formData: FormData): Promise<void> {
  const user = await requireClientUser();
  const id = String(formData.get("id") ?? "");
  const from = formData.get("from") === "proof" ? id : null;
  const decision = formData.get("decision") === "approve" ? "APPROVE" : "CHANGES";
  try {
    await decide(db, { organizationId: user.organizationId, clientId: user.clientId, userId: user.id, id, decision, note: String(formData.get("note") ?? "") });
    await audit(user, { action: `portal.deliverable_${decision.toLowerCase()}`, entity: "Deliverable", entityId: id });
  } catch (e) {
    if (e instanceof DeliverableError) redirect(back(from, `error=${encodeURIComponent(e.message)}`));
    throw e;
  }
  redirect(back(null, `done=${decision === "APPROVE" ? "approved" : "changes"}`));
}

// A comment on the design: a pin on an image, or a page of a PDF
export async function proofCommentAction(formData: FormData): Promise<void> {
  const user = await requireClientUser();
  const id = String(formData.get("deliverableId") ?? "");
  const num = (k: string) => { const v = String(formData.get(k) ?? "").trim(); return v === "" ? null : Number(v); };
  try {
    const c = await addProofComment(db, { actor: toFileActor(user), deliverableId: id, body: String(formData.get("body") ?? ""), x: num("x"), y: num("y"), page: num("page") });
    await audit(user, { action: "portal.proof_comment", entity: "Deliverable", entityId: id, after: { commentId: c.id } });
  } catch (e) {
    if (e instanceof DeliverableError) redirect(back(id, `error=${encodeURIComponent(e.message)}`));
    throw e;
  }
  redirect(back(id, "commented=1"));
}
