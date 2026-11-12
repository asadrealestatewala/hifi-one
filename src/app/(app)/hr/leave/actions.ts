"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { audit, requirePermission, type SessionUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { HrError, decideLeave } from "@/lib/hr";
import { notify } from "@/lib/notifications";

// HR or the person's manager decides. The rule itself lives in decideLeave, which is also what My leave calls,
// so a decision made here and a decision made there can never differ.
async function decide(user: SessionUser, formData: FormData, approve: boolean): Promise<void> {
  const back = String(formData.get("back") ?? "/hr/leave");
  try {
    const decided = await decideLeave(db, {
      requestId: String(formData.get("id")), approverId: user.id, approve, note: String(formData.get("note") ?? ""),
      canApproveAll: user.permissions.has("attendance.view_all"),
    });
    await audit(user, { action: approve ? "leave.approve" : "leave.reject", entity: "LeaveRequest", entityId: decided.id, after: { approve } });
    await notify(db, decided.userId, {
      kind: "leave.decision", title: approve ? "Your leave was approved" : "Your leave was not approved",
      body: `${decided.startDate} to ${decided.endDate}`, link: "/me/leave", dedupeKey: `leave-decision:${decided.id}`,
    });
  } catch (e) {
    if (e instanceof HrError) redirect(`${back}${back.includes("?") ? "&" : "?"}error=${encodeURIComponent(e.message)}`);
    throw e;
  }
  revalidatePath("/hr/leave");
  redirect(`${back}${back.includes("?") ? "&" : "?"}ok=${encodeURIComponent(approve ? "Approved." : "Rejected.")}`);
}

export async function approveLeaveRequest(formData: FormData): Promise<void> {
  const user = await requirePermission("leave.approve");
  return decide(user, formData, true);
}

export async function rejectLeaveRequest(formData: FormData): Promise<void> {
  const user = await requirePermission("leave.approve");
  return decide(user, formData, false);
}
