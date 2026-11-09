// Employee documents: the fixed categories, HR's requests for a document, and HR's verification of what was uploaded.
// Files themselves live in files.ts (ownerType EMPLOYEE). Reading an employee's documents needs hr.view_sensitive, so
// health and identity papers are seen by HR and the employee only, never by their manager. Free of Next.js imports.
import type { PrismaClient } from "@prisma/client";

export class DocumentError extends Error {}

export const EMPLOYEE_DOC_CATEGORIES = [
  "Identity (CNIC or passport)",
  "Photograph",
  "Education certificate",
  "Experience letter",
  "Employment contract",
  "Health or medical",
  "Bank details",
  "Address proof",
  "Other",
] as const;
export type EmployeeDocCategory = (typeof EMPLOYEE_DOC_CATEGORIES)[number];
export const isEmployeeDocCategory = (c: string): c is EmployeeDocCategory => (EMPLOYEE_DOC_CATEGORIES as readonly string[]).includes(c);

export const REVIEW_STATUSES = ["PENDING", "VERIFIED", "REJECTED"] as const;
export type ReviewStatus = (typeof REVIEW_STATUSES)[number];
const OPEN = ["REQUESTED", "SUBMITTED", "REJECTED"];

type Db = PrismaClient;
const isDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`));

async function employeeOf(db: Db, organizationId: string, userId: string) {
  const p = await db.employeeProfile.findFirst({ where: { userId, organizationId, archivedAt: null }, select: { id: true, userId: true, user: { select: { name: true } } } });
  if (!p) throw new DocumentError("This person has no HR record.");
  return p;
}

// HR asks an employee for one document. One open request per category per person.
export async function requestDocument(db: Db, p: { organizationId: string; userId: string; category: string; note?: string; dueOn?: string; requestedById: string }) {
  if (!isEmployeeDocCategory(p.category)) throw new DocumentError("Choose a document type.");
  if (p.dueOn && !isDate(p.dueOn)) throw new DocumentError("Enter a valid due date.");
  const emp = await employeeOf(db, p.organizationId, p.userId);
  const open = await db.documentRequest.findFirst({ where: { organizationId: p.organizationId, userId: p.userId, category: p.category, status: { in: OPEN } } });
  if (open) throw new DocumentError(`${emp.user.name} already has an open request for ${p.category}.`);
  return db.documentRequest.create({
    data: { organizationId: p.organizationId, userId: p.userId, category: p.category, note: p.note?.trim() || null, dueOn: p.dueOn || null, requestedById: p.requestedById },
  });
}

export async function cancelDocumentRequest(db: Db, p: { organizationId: string; requestId: string; byId: string }) {
  const r = await db.documentRequest.findFirst({ where: { id: p.requestId, organizationId: p.organizationId } });
  if (!r) throw new DocumentError("Request not found.");
  if (!OPEN.includes(r.status)) throw new DocumentError("This request is already closed.");
  return db.documentRequest.update({ where: { id: r.id }, data: { status: "CANCELLED", decidedById: p.byId, decidedAt: new Date() } });
}

// Called right after an employee document is saved. The employee's own upload waits for HR review; an upload by HR on the
// employee's behalf counts as seen. With a request id, the file answers that request and the request becomes SUBMITTED.
export async function afterEmployeeUpload(db: Db, p: { fileId: string; actorId: string; organizationId: string; requestId?: string | null }) {
  const f = await db.storedFile.findFirst({ where: { id: p.fileId, organizationId: p.organizationId, ownerType: "EMPLOYEE", deletedAt: null } });
  if (!f) throw new DocumentError("File not found.");
  const self = f.ownerId === p.actorId;
  let request = null;
  if (p.requestId) {
    request = await db.documentRequest.findFirst({ where: { id: p.requestId, organizationId: p.organizationId, userId: f.ownerId } });
    if (!request) throw new DocumentError("Request not found.");
    if (!["REQUESTED", "REJECTED", "SUBMITTED"].includes(request.status)) throw new DocumentError("This request is already closed.");
  }
  const file = await db.storedFile.update({
    where: { id: f.id },
    data: { reviewStatus: self ? "PENDING" : "VERIFIED", ...(self ? {} : { reviewedById: p.actorId, reviewedAt: new Date() }), ...(request ? { category: request.category } : {}) },
  });
  if (request) {
    request = await db.documentRequest.update({
      where: { id: request.id },
      data: self
        ? { status: "SUBMITTED", fileId: file.id, submittedAt: new Date(), decidedById: null, decidedAt: null, decisionNote: null }
        : { status: "VERIFIED", fileId: file.id, submittedAt: new Date(), decidedById: p.actorId, decidedAt: new Date(), decisionNote: null },
    });
  }
  return { file, request, notifyHr: self };
}

// HR verifies or rejects an employee's document. A rejection reopens any request the file answered so the employee can
// upload again; a verification closes it.
export async function reviewEmployeeFile(db: Db, p: { organizationId: string; fileId: string; reviewerId: string; verdict: "VERIFIED" | "REJECTED"; note?: string }) {
  const f = await db.storedFile.findFirst({ where: { id: p.fileId, organizationId: p.organizationId, ownerType: "EMPLOYEE", deletedAt: null } });
  if (!f) throw new DocumentError("File not found.");
  if (f.ownerId === p.reviewerId) throw new DocumentError("You cannot review your own documents.");
  const note = p.note?.trim() || null;
  if (p.verdict === "REJECTED" && !note) throw new DocumentError("Say why the document was not accepted, so the employee knows what to upload.");
  const file = await db.storedFile.update({ where: { id: f.id }, data: { reviewStatus: p.verdict, reviewNote: note, reviewedById: p.reviewerId, reviewedAt: new Date() } });
  const request = await db.documentRequest.findFirst({ where: { fileId: f.id, organizationId: p.organizationId } });
  const updated = request
    ? await db.documentRequest.update({ where: { id: request.id }, data: { status: p.verdict, decidedById: p.reviewerId, decidedAt: new Date(), decisionNote: note } })
    : null;
  return { file, request: updated };
}

// What HR sees at a glance: documents waiting for a decision and requests nobody has answered yet.
export async function employeeDocOverview(db: Db, organizationId: string, today: string) {
  const [pendingFiles, openRequests] = await Promise.all([
    db.storedFile.findMany({ where: { organizationId, ownerType: "EMPLOYEE", deletedAt: null, reviewStatus: "PENDING" }, orderBy: { createdAt: "asc" } }),
    db.documentRequest.findMany({ where: { organizationId, status: { in: ["REQUESTED", "REJECTED"] } }, orderBy: [{ dueOn: { sort: "asc", nulls: "last" } }, { createdAt: "asc" }] }),
  ]);
  const overdue = openRequests.filter((r) => r.dueOn !== null && r.dueOn < today);
  return { pendingFiles, openRequests, overdue };
}

// The employee's own view: what HR asked for, with the latest answer and decision on each.
export const myDocumentRequests = (db: Db, organizationId: string, userId: string) =>
  db.documentRequest.findMany({ where: { organizationId, userId, status: { not: "CANCELLED" } }, orderBy: [{ status: "asc" }, { createdAt: "desc" }] });
