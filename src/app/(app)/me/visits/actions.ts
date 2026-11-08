"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { audit, requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";
import { dateInZone } from "@/lib/hr-rules";
import { notify, notifyPermission } from "@/lib/notifications";
import { VISIT_KIND_LABEL, VisitError, cancelSiteVisit, decideSiteVisit, describeVisit, requestSiteVisit, type VisitKind } from "@/lib/site-visits";

const str = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const back = (k: "error" | "msg", m: string): never => redirect(`/me/visits?${k}=${encodeURIComponent(m)}`);
async function today(organizationId: string) {
  const p = await db.companyProfile.findFirst({ where: { organizationId, isDefault: true }, select: { timezone: true } });
  return dateInZone(new Date(), p?.timezone ?? "UTC");
}

// The employee asks for a site visit, field work or a day from home. Their manager is told; HR when there is no manager.
export async function requestSiteVisitAction(formData: FormData): Promise<void> {
  const user = await requirePermission("self.attendance");
  try {
    const r = await requestSiteVisit(db, {
      organizationId: user.organizationId, userId: user.id, kind: str(formData, "kind"), startDate: str(formData, "startDate"), endDate: str(formData, "endDate"),
      startTime: str(formData, "startTime"), endTime: str(formData, "endTime"), location: str(formData, "location"), clientId: str(formData, "clientId") || null,
      purpose: str(formData, "purpose"), today: await today(user.organizationId),
    });
    await audit(user, { action: "visit.request", entity: "SiteVisitRequest", entityId: r.id, after: { kind: r.kind, start: r.startDate, end: r.endDate, location: r.location } });
    const when = r.startDate === r.endDate ? r.startDate : `${r.startDate} to ${r.endDate}`;
    const n = { kind: "visit.request", title: `${user.name} asked for ${VISIT_KIND_LABEL[r.kind as VisitKind].toLowerCase()} on ${when}`, body: describeVisit(r), link: "/me/visits", dedupeKey: `visit:${r.id}` };
    const me = await db.user.findUnique({ where: { id: user.id }, select: { managerId: true } });
    if (me?.managerId) await notify(db, me.managerId, n);
    else await notifyPermission(db, user.organizationId, "attendance.view_all", n, user.id);
  } catch (e) {
    if (e instanceof VisitError) back("error", e.message);
    throw e;
  }
  revalidatePath("/me/visits");
  back("msg", "Request sent for approval.");
}

export async function cancelSiteVisitAction(formData: FormData): Promise<void> {
  const user = await requirePermission("self.attendance");
  try {
    const r = await cancelSiteVisit(db, { requestId: str(formData, "id"), userId: user.id, today: await today(user.organizationId) });
    await audit(user, { action: "visit.cancel", entity: "SiteVisitRequest", entityId: r.id });
  } catch (e) {
    if (e instanceof VisitError) back("error", e.message);
    throw e;
  }
  revalidatePath("/me/visits");
  back("msg", "Request cancelled.");
}

// Manager (direct reports) or HR (everyone) approves or rejects. Used on My Space and on the HR overview.
export async function decideSiteVisitAction(formData: FormData): Promise<void> {
  const user = await requirePermission("leave.approve");
  const to = str(formData, "returnTo").startsWith("/hr/") ? "/hr/visits" : "/me/visits";
  const go = (k: "error" | "msg", m: string): never => redirect(`${to}?${k}=${encodeURIComponent(m)}`);
  const approve = str(formData, "decision") === "approve";
  try {
    const r = await decideSiteVisit(db, { organizationId: user.organizationId, requestId: str(formData, "id"), approverId: user.id, approve, note: str(formData, "reason") || str(formData, "note"), canDecideAll: user.permissions.has("attendance.view_all") });
    await audit(user, { action: approve ? "visit.approve" : "visit.reject", entity: "SiteVisitRequest", entityId: r.id, after: { note: r.decisionNote } });
    const when = r.startDate === r.endDate ? r.startDate : `${r.startDate} to ${r.endDate}`;
    await notify(db, r.userId, { kind: "visit.decision", title: approve ? `Your ${VISIT_KIND_LABEL[r.kind as VisitKind].toLowerCase()} on ${when} was approved` : `Your ${VISIT_KIND_LABEL[r.kind as VisitKind].toLowerCase()} on ${when} was not approved`, body: r.decisionNote ?? undefined, link: "/me/visits", dedupeKey: `visit-decision:${r.id}` });
  } catch (e) {
    if (e instanceof VisitError) go("error", e.message);
    throw e;
  }
  revalidatePath(to);
  go("msg", approve ? "Approved." : "Rejected. The employee has been told why.");
}
