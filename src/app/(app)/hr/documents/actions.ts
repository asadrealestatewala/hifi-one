"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { audit, requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";
import { DocumentError, cancelDocumentRequest, requestDocument, reviewEmployeeFile } from "@/lib/employee-docs";
import { notify } from "@/lib/notifications";

const safeReturn = (p: string) => (p.startsWith("/") && !p.startsWith("//") && !p.includes("\\") ? p : "/hr/documents");
const back = (to: string, k: "error" | "msg", m: string): never => redirect(`${to}${to.includes("?") ? "&" : "?"}${k}=${encodeURIComponent(m)}`);
const str = (f: FormData, k: string) => String(f.get(k) ?? "").trim();

// HR asks an employee for a document. The employee is told in-app and sees it on My Documents.
export async function requestDocumentAction(formData: FormData): Promise<void> {
  const user = await requirePermission("hr.manage");
  const to = safeReturn(str(formData, "returnTo") || "/hr/documents");
  try {
    const r = await requestDocument(db, { organizationId: user.organizationId, userId: str(formData, "userId"), category: str(formData, "category"), note: str(formData, "note"), dueOn: str(formData, "dueOn"), requestedById: user.id });
    await audit(user, { action: "document.request", entity: "DocumentRequest", entityId: r.id, after: { userId: r.userId, category: r.category, dueOn: r.dueOn } });
    await notify(db, r.userId, { kind: "document.requested", title: `HR asked for your ${r.category}`, body: [r.note, r.dueOn ? `Needed by ${r.dueOn}` : ""].filter(Boolean).join(" · ") || undefined, link: "/me/documents", dedupeKey: `doc-request:${r.id}` });
  } catch (e) {
    if (e instanceof DocumentError) back(to, "error", e.message);
    throw e;
  }
  revalidatePath(to);
  back(to, "msg", "Request sent. The employee has been told.");
}

export async function cancelDocumentRequestAction(formData: FormData): Promise<void> {
  const user = await requirePermission("hr.manage");
  const to = safeReturn(str(formData, "returnTo") || "/hr/documents");
  try {
    const r = await cancelDocumentRequest(db, { organizationId: user.organizationId, requestId: str(formData, "requestId"), byId: user.id });
    await audit(user, { action: "document.request_cancel", entity: "DocumentRequest", entityId: r.id });
  } catch (e) {
    if (e instanceof DocumentError) back(to, "error", e.message);
    throw e;
  }
  revalidatePath(to);
  back(to, "msg", "Request withdrawn.");
}

// Verify or reject an uploaded employee document. Reading these files already needs hr.view_sensitive; deciding needs hr.manage too.
export async function reviewDocumentAction(formData: FormData): Promise<void> {
  const user = await requirePermission("hr.manage");
  const to = safeReturn(str(formData, "returnTo") || "/hr/documents");
  if (!user.permissions.has("hr.view_sensitive")) back(to, "error", "Only HR staff who may see employee documents can review them.");
  const verdict = str(formData, "verdict") === "reject" ? "REJECTED" : "VERIFIED";
  try {
    const r = await reviewEmployeeFile(db, { organizationId: user.organizationId, fileId: str(formData, "fileId"), reviewerId: user.id, verdict, note: str(formData, "reason") || str(formData, "note") });
    await audit(user, { action: verdict === "VERIFIED" ? "document.verify" : "document.reject", entity: "StoredFile", entityId: r.file.id, after: { category: r.file.category, requestId: r.request?.id ?? null } });
    await notify(db, r.file.ownerId, {
      kind: "document.reviewed", title: verdict === "VERIFIED" ? `Your ${r.file.category ?? "document"} was verified` : `Your ${r.file.category ?? "document"} was not accepted`,
      body: r.file.reviewNote ?? undefined, link: "/me/documents", dedupeKey: `doc-review:${r.file.id}:${r.file.reviewedAt?.getTime()}`,
    });
  } catch (e) {
    if (e instanceof DocumentError) back(to, "error", e.message);
    throw e;
  }
  revalidatePath(to);
  back(to, "msg", verdict === "VERIFIED" ? "Document verified." : "Document rejected. The employee has been asked to upload again.");
}
