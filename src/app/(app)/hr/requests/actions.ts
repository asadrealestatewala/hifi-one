"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { audit, requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";
import { REQUEST_TYPE_LABEL, RequestError, reviewRequest, type RequestType } from "@/lib/employee-requests";
import { notify } from "@/lib/notifications";

const str = (f: FormData, k: string) => String(f.get(k) ?? "").trim();

// HR takes an application up, approves it or declines it (with a reason). The employee is told each time.
export async function reviewRequestAction(formData: FormData): Promise<void> {
  const user = await requirePermission("hr.manage");
  const filter = str(formData, "returnTo");
  const to = `/hr/requests${filter.startsWith("?") && !filter.includes("//") ? filter.replace(/[&?](error|msg)=[^&]*/g, "") : ""}`;
  const go = (k: "error" | "msg", m: string): never => redirect(`${to}${to.includes("?") ? "&" : "?"}${k}=${encodeURIComponent(m)}`);
  const d = str(formData, "decision");
  const decision = d === "review" ? "IN_REVIEW" : d === "approve" ? "APPROVED" : d === "decline" ? "DECLINED" : null;
  if (!decision) go("error", "Unknown decision.");
  try {
    const r = await reviewRequest(db, { organizationId: user.organizationId, requestId: str(formData, "id"), reviewerId: user.id, decision: decision!, note: str(formData, "reason") || str(formData, "note") });
    await audit(user, { action: decision === "IN_REVIEW" ? "request.review" : decision === "APPROVED" ? "request.approve" : "request.decline", entity: "EmployeeRequest", entityId: r.id, after: { note: r.responseNote } });
    const what = `${REQUEST_TYPE_LABEL[r.type as RequestType].toLowerCase()}: ${r.subject}`;
    await notify(db, r.userId, {
      kind: "request.decision",
      title: decision === "IN_REVIEW" ? `HR is looking at your ${what}` : decision === "APPROVED" ? `Your ${what} was approved` : `Your ${what} was declined`,
      body: decision === "IN_REVIEW" ? undefined : r.responseNote ?? undefined, link: "/me/requests", dedupeKey: `request-${decision}:${r.id}`,
    });
  } catch (e) {
    if (e instanceof RequestError) go("error", e.message);
    throw e;
  }
  revalidatePath("/hr/requests");
  revalidatePath("/me/requests");
  go("msg", decision === "IN_REVIEW" ? "Marked as in review. The employee can see you are on it." : decision === "APPROVED" ? "Approved. The employee has been told." : "Declined. The employee has been told why.");
}
