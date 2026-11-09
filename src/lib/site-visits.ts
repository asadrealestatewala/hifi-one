// Site visits, field work and work-from-home requests: an employee asks, the manager or HR decides, and approved days
// show on the calendar and beside attendance so nobody is read as absent while out for work. Free of Next.js imports.
import type { PrismaClient } from "@prisma/client";
import { isDateString, rangesOverlap } from "./hr-rules";

export class VisitError extends Error {}
type Db = PrismaClient;

export const VISIT_KINDS = ["SITE_VISIT", "FIELD_WORK", "WORK_FROM_HOME"] as const;
export type VisitKind = (typeof VISIT_KINDS)[number];
export const VISIT_KIND_LABEL: Record<VisitKind, string> = { SITE_VISIT: "Site or client visit", FIELD_WORK: "Field work", WORK_FROM_HOME: "Work from home" };
export const isVisitKind = (k: string): k is VisitKind => (VISIT_KINDS as readonly string[]).includes(k);
const MAX_DAYS_BACK = 7; // a visit that already happened can still be recorded for a week
const MAX_SPAN = 31;
const isTime = (t: string) => /^([01]\d|2[0-3]):[0-5]\d$/.test(t);
const addDays = (s: string, n: number) => new Date(Date.parse(`${s}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

export async function requestSiteVisit(
  db: Db,
  p: { organizationId: string; userId: string; kind: string; startDate: string; endDate?: string; startTime?: string; endTime?: string; location?: string; clientId?: string | null; purpose: string; today: string },
) {
  if (!isVisitKind(p.kind)) throw new VisitError("Choose what kind of request this is.");
  const endDate = p.endDate?.trim() || p.startDate;
  if (!isDateString(p.startDate) || !isDateString(endDate)) throw new VisitError("Enter valid dates.");
  if (endDate < p.startDate) throw new VisitError("The end date cannot be before the start date.");
  if (p.startDate < addDays(p.today, -MAX_DAYS_BACK)) throw new VisitError(`Requests can go back at most ${MAX_DAYS_BACK} days.`);
  if ((Date.parse(endDate) - Date.parse(p.startDate)) / 86_400_000 >= MAX_SPAN) throw new VisitError(`One request covers at most ${MAX_SPAN} days.`);
  const startTime = p.startTime?.trim() || null;
  const endTime = p.endTime?.trim() || null;
  if ((startTime && !isTime(startTime)) || (endTime && !isTime(endTime))) throw new VisitError("Enter times as HH:MM.");
  if (startTime && endTime && p.startDate === endDate && endTime <= startTime) throw new VisitError("The end time must be after the start time.");
  const location = p.location?.trim() || null;
  if (p.kind !== "WORK_FROM_HOME" && !location) throw new VisitError("Say where you are going.");
  const purpose = p.purpose.trim();
  if (purpose.length < 5) throw new VisitError("Say why, in a few words.");
  let clientId: string | null = null;
  if (p.clientId) {
    const c = await db.client.findFirst({ where: { id: p.clientId, organizationId: p.organizationId }, select: { id: true } });
    if (!c) throw new VisitError("Unknown client.");
    clientId = c.id;
  }
  const range = { start: p.startDate, end: endDate };
  const [visits, leaves] = await Promise.all([
    db.siteVisitRequest.findMany({ where: { userId: p.userId, status: { in: ["PENDING", "APPROVED"] }, endDate: { gte: p.startDate }, startDate: { lte: endDate } } }),
    db.leaveRequest.findMany({ where: { userId: p.userId, status: "APPROVED", endDate: { gte: p.startDate }, startDate: { lte: endDate } } }),
  ]);
  // Two part-day visits on the same day are fine; whole days may not overlap each other or approved leave
  const wholeDay = !(startTime && endTime);
  if (visits.some((v) => rangesOverlap({ start: v.startDate, end: v.endDate }, range) && (wholeDay || !(v.startTime && v.endTime) || (v.startDate === p.startDate && v.startTime! < endTime! && startTime! < v.endTime!)))) {
    throw new VisitError("This overlaps with another request of yours.");
  }
  if (leaves.some((l) => rangesOverlap({ start: l.startDate, end: l.endDate }, range))) throw new VisitError("You are on approved leave on those days.");
  return db.siteVisitRequest.create({
    data: { organizationId: p.organizationId, userId: p.userId, kind: p.kind, startDate: p.startDate, endDate, startTime, endTime, location, clientId, purpose },
  });
}

// The person's manager, or HR (canDecideAll), approves or rejects. Never your own request.
export async function decideSiteVisit(db: Db, p: { organizationId: string; requestId: string; approverId: string; approve: boolean; note?: string; canDecideAll: boolean }) {
  const r = await db.siteVisitRequest.findFirst({ where: { id: p.requestId, organizationId: p.organizationId } });
  if (!r) throw new VisitError("Request not found.");
  if (r.status !== "PENDING") throw new VisitError("This request has already been decided.");
  if (r.userId === p.approverId) throw new VisitError("You cannot approve your own request.");
  if (!p.canDecideAll) {
    const u = await db.user.findUnique({ where: { id: r.userId }, select: { managerId: true } });
    if (u?.managerId !== p.approverId) throw new VisitError("Only the employee's manager or HR can decide this request.");
  }
  const note = p.note?.trim() || null;
  if (!p.approve && !note) throw new VisitError("Say why it was not approved.");
  return db.siteVisitRequest.update({ where: { id: r.id }, data: { status: p.approve ? "APPROVED" : "REJECTED", approverId: p.approverId, decidedAt: new Date(), decisionNote: note } });
}

export async function cancelSiteVisit(db: Db, p: { requestId: string; userId: string; today: string }) {
  const r = await db.siteVisitRequest.findFirst({ where: { id: p.requestId, userId: p.userId } });
  if (!r) throw new VisitError("Request not found.");
  if (r.status === "PENDING" || (r.status === "APPROVED" && r.startDate >= p.today)) {
    return db.siteVisitRequest.update({ where: { id: r.id }, data: { status: "CANCELLED" } });
  }
  throw new VisitError("This request can no longer be cancelled.");
}

// Approved requests covering one day, for attendance and daily-report screens (who is out for work today).
export const visitsOn = (db: Db, organizationId: string, workDate: string) =>
  db.siteVisitRequest.findMany({ where: { organizationId, status: "APPROVED", startDate: { lte: workDate }, endDate: { gte: workDate } }, orderBy: { startTime: { sort: "asc", nulls: "first" } }, include: { client: { select: { name: true } } } });

// What an approver may decide: everything pending for HR, direct reports for a manager.
export async function pendingForApprover(db: Db, organizationId: string, approverId: string, canDecideAll: boolean) {
  const rows = await db.siteVisitRequest.findMany({ where: { organizationId, status: "PENDING", userId: { not: approverId } }, orderBy: [{ startDate: "asc" }, { createdAt: "asc" }], include: { client: { select: { name: true } } } });
  if (canDecideAll) return rows;
  const reports = new Set((await db.user.findMany({ where: { managerId: approverId }, select: { id: true } })).map((u) => u.id));
  return rows.filter((r) => reports.has(r.userId));
}

export const describeVisit = (v: { kind: string; location: string | null; client?: { name: string } | null; startTime: string | null; endTime: string | null }) =>
  [VISIT_KIND_LABEL[v.kind as VisitKind] ?? v.kind, v.client?.name, v.location, v.startTime && v.endTime ? `${v.startTime}–${v.endTime}` : null].filter(Boolean).join(" · ");
