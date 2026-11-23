"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { audit, requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";
import { REQUEST_TYPE_LABEL, RequestError, noteAsManager, type RequestType } from "@/lib/employee-requests";
import { notifyPermission } from "@/lib/notifications";

const str = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const back = (k: "error" | "msg", m: string): never => redirect(`/me/team?${k}=${encodeURIComponent(m)}#requests`);

// A manager comments for HR on an application one of their team shared with them. HR is told; HR still decides.
export async function noteRequestAction(formData: FormData): Promise<void> {
  const user = await requirePermission("leave.approve");
  try {
    const r = await noteAsManager(db, { organizationId: user.organizationId, requestId: str(formData, "id"), managerId: user.id, note: str(formData, "note") });
    await audit(user, { action: "request.manager_note", entity: "EmployeeRequest", entityId: r.id, after: { note: r.managerNote } });
    const who = (await db.user.findUnique({ where: { id: r.userId }, select: { name: true } }))?.name ?? "An employee";
    await notifyPermission(db, user.organizationId, "hr.manage", {
      kind: "request.manager_note", title: `${user.name} commented on ${who}'s ${REQUEST_TYPE_LABEL[r.type as RequestType].toLowerCase()}`, body: r.managerNote ?? undefined, link: `/hr/requests?focus=${r.id}`, dedupeKey: `request-note:${r.id}:${r.managerNotedAt?.getTime()}`,
    }, user.id);
  } catch (e) {
    if (e instanceof RequestError) back("error", e.message);
    throw e;
  }
  revalidatePath("/me/team");
  revalidatePath("/hr/requests");
  back("msg", "Comment saved. HR can see it beside the application.");
}
