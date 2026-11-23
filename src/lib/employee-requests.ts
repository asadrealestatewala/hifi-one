// Applications from an employee to HR that no other form covers: certificates, an advance or loan, a resignation, a grievance,
// equipment, or anything else. The employee writes it (optionally with a file), HR takes it up and then approves or declines
// with a note, and each side is notified. Leave, documents, site visits and daily reports have their own screens and are not
// duplicated here. HR (hr.manage) reads every application. The employee's line manager is also told and can read it and
// leave a comment for HR (HR's Required Changes, item 6), unless the employee ticks "Private, HR only". A grievance may
// concern the manager, so it is always HR only. Only HR answers.
// Free of Next.js imports so it can be tested against the database.
import type { PrismaClient } from "@prisma/client";

export class RequestError extends Error {}
type Db = PrismaClient;

export const REQUEST_TYPES = ["SALARY_CERTIFICATE", "EXPERIENCE_LETTER", "ADVANCE", "RESIGNATION", "GRIEVANCE", "EQUIPMENT", "OTHER"] as const;
export type RequestType = (typeof REQUEST_TYPES)[number];
export const REQUEST_TYPE_LABEL: Record<RequestType, string> = {
  SALARY_CERTIFICATE: "Salary certificate", EXPERIENCE_LETTER: "Experience or employment letter", ADVANCE: "Salary advance or loan",
  RESIGNATION: "Resignation", GRIEVANCE: "Complaint or grievance", EQUIPMENT: "Equipment or tools", OTHER: "Other application",
};
export const isRequestType = (t: string): t is RequestType => (REQUEST_TYPES as readonly string[]).includes(t);

export const REQUEST_STATUSES = ["SUBMITTED", "IN_REVIEW", "APPROVED", "DECLINED", "CANCELLED"] as const;
export type RequestStatus = (typeof REQUEST_STATUSES)[number];
export const OPEN_STATUSES: readonly RequestStatus[] = ["SUBMITTED", "IN_REVIEW"];
export const isOpen = (status: string) => (OPEN_STATUSES as readonly string[]).includes(status);

const MAX_SUBJECT = 120;
const MAX_BODY = 4000;

// The employee writes the application. Validation only; the caller stores any attachment against the returned id.
export async function submitRequest(db: Db, p: { organizationId: string; userId: string; type: string; subject: string; body: string; hrOnly?: boolean }) {
  if (!isRequestType(p.type)) throw new RequestError("Choose what the application is about.");
  const subject = p.subject.trim();
  const body = p.body.trim();
  if (subject.length < 3) throw new RequestError("Give the application a short subject.");
  if (subject.length > MAX_SUBJECT) throw new RequestError(`The subject can be at most ${MAX_SUBJECT} characters.`);
  if (body.length < 10) throw new RequestError("Write the application itself: what you are asking for and why.");
  if (body.length > MAX_BODY) throw new RequestError(`The application can be at most ${MAX_BODY} characters.`);
  const profile = await db.employeeProfile.findFirst({ where: { userId: p.userId, organizationId: p.organizationId }, select: { id: true, user: { select: { managerId: true } } } });
  if (!profile) throw new RequestError("Your HR record has not been created yet, so HR cannot take applications from you. Ask HR to add you to the staff directory.");
  const open = await db.employeeRequest.count({ where: { userId: p.userId, status: { in: [...OPEN_STATUSES] } } });
  if (open >= 10) throw new RequestError("You already have ten open applications. Wait for HR to answer some before sending more.");
  const hrOnly = p.type === "GRIEVANCE" || !!p.hrOnly;
  let managerId: string | null = null;
  const m = profile.user.managerId;
  if (!hrOnly && m && m !== p.userId) {
    managerId = (await db.user.findFirst({ where: { id: m, organizationId: p.organizationId, active: true, userType: "EMPLOYEE" }, select: { id: true } }))?.id ?? null;
  }
  return db.employeeRequest.create({ data: { organizationId: p.organizationId, userId: p.userId, type: p.type, subject, body, hrOnly, managerId } });
}

// The employee withdraws an application HR has not answered yet.
export async function cancelRequest(db: Db, p: { requestId: string; userId: string }) {
  const r = await db.employeeRequest.findFirst({ where: { id: p.requestId, userId: p.userId } });
  if (!r) throw new RequestError("Application not found.");
  if (!isOpen(r.status)) throw new RequestError("This application has already been answered and cannot be withdrawn.");
  return db.employeeRequest.update({ where: { id: r.id }, data: { status: "CANCELLED" } });
}

// HR takes an application up (IN_REVIEW, so the employee sees it is being looked at) or answers it. Declining needs a note so the
// employee is told why; approving may carry one (where to collect the certificate, the agreed amount). Never your own application.
export async function reviewRequest(db: Db, p: { organizationId: string; requestId: string; reviewerId: string; decision: "IN_REVIEW" | "APPROVED" | "DECLINED"; note?: string }) {
  const r = await db.employeeRequest.findFirst({ where: { id: p.requestId, organizationId: p.organizationId } });
  if (!r) throw new RequestError("Application not found.");
  if (r.userId === p.reviewerId) throw new RequestError("You cannot answer your own application; another HR person must.");
  if (!isOpen(r.status)) throw new RequestError("This application has already been answered.");
  if (p.decision === "IN_REVIEW" && r.status === "IN_REVIEW") throw new RequestError("This application is already being reviewed.");
  const note = p.note?.trim() || null;
  if (p.decision === "DECLINED" && !note) throw new RequestError("Say why the application was declined; the employee is told.");
  if (note && note.length > 2000) throw new RequestError("The note can be at most 2000 characters.");
  return db.employeeRequest.update({
    where: { id: r.id },
    data: { status: p.decision, handledById: p.reviewerId, handledAt: p.decision === "IN_REVIEW" ? null : new Date(), responseNote: p.decision === "IN_REVIEW" ? r.responseNote : note },
  });
}

// The manager it was shared with adds (or changes) a comment for HR while the application is open. HR sees it beside the
// application; the employee does not. Never on an HR-only application, and never by anyone else.
export async function noteAsManager(db: Db, p: { organizationId: string; requestId: string; managerId: string; note: string }) {
  const r = await db.employeeRequest.findFirst({ where: { id: p.requestId, organizationId: p.organizationId, managerId: p.managerId, hrOnly: false } });
  if (!r) throw new RequestError("Application not found.");
  if (!isOpen(r.status)) throw new RequestError("HR has already answered this application.");
  const note = p.note.trim();
  if (note.length < 2) throw new RequestError("Write your comment for HR.");
  if (note.length > 2000) throw new RequestError("The comment can be at most 2000 characters.");
  return db.employeeRequest.update({ where: { id: r.id }, data: { managerNote: note, managerNotedAt: new Date() } });
}

// A manager's list: only the applications shared with them (never HR only), open first, then the last answered ones.
export async function requestsForManager(db: Db, organizationId: string, managerId: string) {
  const where = { organizationId, managerId, hrOnly: false };
  const [open, answered] = await Promise.all([
    db.employeeRequest.findMany({ where: { ...where, status: { in: [...OPEN_STATUSES] } }, orderBy: { createdAt: "asc" } }),
    db.employeeRequest.findMany({ where: { ...where, status: { notIn: [...OPEN_STATUSES] } }, orderBy: { updatedAt: "desc" }, take: 10 }),
  ]);
  return { open, answered };
}

export const myRequests = (db: Db, userId: string, take = 50) =>
  db.employeeRequest.findMany({ where: { userId }, orderBy: { createdAt: "desc" }, take });

// HR's list: open applications first (oldest first, so nothing waits unnoticed), then the answered ones newest first.
export async function requestsForHr(db: Db, organizationId: string, p: { status?: string; type?: string; take?: number } = {}) {
  const where = {
    organizationId,
    ...(p.status === "OPEN" ? { status: { in: [...OPEN_STATUSES] } } : p.status && (REQUEST_STATUSES as readonly string[]).includes(p.status) ? { status: p.status } : {}),
    ...(p.type && isRequestType(p.type) ? { type: p.type } : {}),
  };
  const rows = await db.employeeRequest.findMany({ where, orderBy: { createdAt: "desc" }, take: p.take ?? 200 });
  return [...rows.filter((r) => isOpen(r.status)).sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime()), ...rows.filter((r) => !isOpen(r.status))];
}

export async function requestCounts(db: Db, organizationId: string) {
  const rows = await db.employeeRequest.groupBy({ by: ["status"], where: { organizationId }, _count: true });
  const by = new Map(rows.map((r) => [r.status, r._count]));
  const n = (s: string) => by.get(s) ?? 0;
  return { open: n("SUBMITTED") + n("IN_REVIEW"), submitted: n("SUBMITTED"), inReview: n("IN_REVIEW"), approved: n("APPROVED"), declined: n("DECLINED"), cancelled: n("CANCELLED"), all: rows.reduce((s, r) => s + r._count, 0) };
}

// Files attached to a set of applications, for lists. Access was already decided by the caller (the employee's own, or HR).
export const attachmentsFor = (db: Db, organizationId: string, requestIds: string[]) =>
  requestIds.length === 0
    ? Promise.resolve([])
    : db.storedFile.findMany({ where: { organizationId, ownerType: "EMPLOYEE_REQUEST", ownerId: { in: requestIds }, deletedAt: null }, orderBy: { createdAt: "asc" }, select: { id: true, ownerId: true, filename: true, size: true, scanStatus: true } });
