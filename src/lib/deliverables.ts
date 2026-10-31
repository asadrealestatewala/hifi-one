// Deliverables: a piece of work the client approves (a design, a document, a staging site). The team creates one inside a project,
// attaches a link, and sends it for approval; the client approves it or asks for changes with a note, which returns it to the team
// as a new version. The decision is recorded with who, when and what they said. Free of Next.js imports so it can be tested.
import type { PrismaClient } from "@prisma/client";
import { notifyMany } from "./notifications";

export class DeliverableError extends Error {}
type Db = PrismaClient;

export const DELIVERABLE_STATUSES = ["DRAFT", "PENDING", "APPROVED", "CHANGES_REQUESTED"] as const;

const clean = (v: string | null | undefined, max: number) => { const t = (v ?? "").replace(/\r\n/g, "\n").trim(); return t ? t.slice(0, max) : null; };

export function cleanLink(raw: string | null | undefined): string | null {
  const v = (raw ?? "").trim();
  if (!v) return null;
  let u: URL;
  try { u = new URL(v); } catch { throw new DeliverableError("Enter the link starting with https://."); }
  if (u.protocol !== "https:" && u.protocol !== "http:") throw new DeliverableError("Enter a web link starting with https://.");
  return u.toString().slice(0, 500);
}

const portalUsers = async (db: Db, clientId: string) => (await db.user.findMany({ where: { clientId, active: true }, select: { id: true } })).map((u) => u.id);
const team = (d: { requestedById: string | null; createdById: string }, managerId: string) => [...new Set([managerId, d.createdById, d.requestedById].filter((x): x is string => !!x))];

export async function createDeliverable(db: Db, p: { organizationId: string; projectId: string; actorId: string; title: string; description?: string | null; link?: string | null }) {
  const title = clean(p.title, 160);
  if (!title || title.length < 3) throw new DeliverableError("Give the deliverable a title.");
  const project = await db.project.findFirst({ where: { id: p.projectId, organizationId: p.organizationId }, select: { id: true, campaignId: true } });
  if (!project) throw new DeliverableError("Project not found.");
  return db.deliverable.create({ data: { organizationId: p.organizationId, projectId: project.id, campaignId: project.campaignId, title, description: clean(p.description, 2000), link: cleanLink(p.link), createdById: p.actorId } });
}

// Only a draft or a deliverable the client sent back can be edited; a version already in front of the client cannot change.
export async function editDeliverable(db: Db, p: { organizationId: string; id: string; title: string; description?: string | null; link?: string | null }) {
  const d = await db.deliverable.findFirst({ where: { id: p.id, organizationId: p.organizationId } });
  if (!d) throw new DeliverableError("Deliverable not found.");
  if (d.status === "PENDING" || d.status === "APPROVED") throw new DeliverableError("This version is with the client or approved, so it cannot be changed. Ask for changes first.");
  const title = clean(p.title, 160);
  if (!title || title.length < 3) throw new DeliverableError("Give the deliverable a title.");
  const returning = d.status === "CHANGES_REQUESTED";
  return db.deliverable.update({ where: { id: d.id }, data: { title, description: clean(p.description, 2000), link: cleanLink(p.link), ...(returning ? { status: "DRAFT", version: d.version + 1, decisionNote: null, decidedAt: null, decidedById: null } : {}) } });
}

export async function submitForApproval(db: Db, p: { organizationId: string; id: string; actorId: string }) {
  const d = await db.deliverable.findFirst({ where: { id: p.id, organizationId: p.organizationId } });
  if (!d) throw new DeliverableError("Deliverable not found.");
  if (d.status !== "DRAFT") throw new DeliverableError(d.status === "PENDING" ? "Already sent for approval." : d.status === "APPROVED" ? "Already approved." : "Edit it first: the client asked for changes.");
  if (!d.link && !d.description) throw new DeliverableError("Add a link or a description so the client can see what to approve.");
  const project = await db.project.findUnique({ where: { id: d.projectId }, select: { clientId: true, name: true } });
  if (!project?.clientId) throw new DeliverableError("This project has no client to approve it. Attach a client to the project first.");
  const u = await db.deliverable.updateMany({ where: { id: d.id, status: "DRAFT" }, data: { status: "PENDING", requestedAt: new Date(), requestedById: p.actorId } });
  if (u.count === 0) throw new DeliverableError("Already sent for approval.");
  await notifyMany(db, await portalUsers(db, project.clientId), { kind: "deliverable.pending", title: `Please review: ${d.title}`, body: `${project.name}, version ${d.version}`, link: `/portal/approvals`, dedupeKey: `deliverable:${d.id}:${d.version}` });
  return db.deliverable.findUniqueOrThrow({ where: { id: d.id } });
}

// ----- the client's side: always scoped by the signed-in client -----

export async function portalDeliverables(db: Db, clientId: string) {
  const rows = await db.deliverable.findMany({ where: { status: { not: "DRAFT" }, projectId: { in: (await db.project.findMany({ where: { clientId, status: { not: "CANCELLED" } }, select: { id: true } })).map((p) => p.id) } }, orderBy: [{ requestedAt: "desc" }, { id: "asc" }] });
  const projects = new Map((await db.project.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.projectId))] } }, select: { id: true, name: true } })).map((p) => [p.id, p.name]));
  return rows.map((r) => ({ ...r, projectName: projects.get(r.projectId) ?? "" }));
}

export async function decide(db: Db, p: { organizationId: string; clientId: string; userId: string; id: string; decision: "APPROVE" | "CHANGES"; note?: string }) {
  const note = clean(p.note, 1000);
  if (p.decision === "CHANGES" && (!note || note.length < 5)) throw new DeliverableError("Say what you would like changed.");
  const d = await db.deliverable.findFirst({ where: { id: p.id, organizationId: p.organizationId, projectId: { in: (await db.project.findMany({ where: { clientId: p.clientId, organizationId: p.organizationId }, select: { id: true } })).map((x) => x.id) } } });
  if (!d) throw new DeliverableError("Not found.");
  if (d.status !== "PENDING") throw new DeliverableError(d.status === "APPROVED" ? "Already approved." : "This is not waiting for your decision.");
  // Only the first decision counts, even if two people click at the same moment
  const u = await db.deliverable.updateMany({ where: { id: d.id, status: "PENDING" }, data: { status: p.decision === "APPROVE" ? "APPROVED" : "CHANGES_REQUESTED", decidedAt: new Date(), decidedById: p.userId, decisionNote: note } });
  if (u.count === 0) throw new DeliverableError("Someone already decided this.");
  const project = await db.project.findUniqueOrThrow({ where: { id: d.projectId }, select: { managerId: true, name: true } });
  const who = (await db.user.findUnique({ where: { id: p.userId }, select: { name: true } }))?.name ?? "The client";
  await notifyMany(db, team(d, project.managerId), { kind: p.decision === "APPROVE" ? "deliverable.approved" : "deliverable.changes", title: p.decision === "APPROVE" ? `${who} approved ${d.title}` : `${who} asked for changes to ${d.title}`, body: note ?? project.name, link: `/projects/${d.projectId}`, dedupeKey: `deliverable-decision:${d.id}:${d.version}` });
  return db.deliverable.findUniqueOrThrow({ where: { id: d.id } });
}
