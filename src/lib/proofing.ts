// Proofing: the team attaches the design (an image or a PDF) to a deliverable, and the client comments directly on it, with a numbered
// pin on an image or a page number on a PDF, while the version waits for their approval. The team replies and ticks comments off.
// Asking for changes can rest on the pinned comments alone. Each version keeps its own proof and comments.
// Free of Next.js imports so it can be tested against the database.
import type { PrismaClient, StoredFile } from "@prisma/client";
import { authorizeOwner, type FileActor } from "./file-access";
import { saveFile, FileError } from "./files";
import { notifyMany } from "./notifications";
import type { StorageProvider } from "./storage";
import { DeliverableError } from "./deliverables";

type Db = PrismaClient;
export const PROOF_TYPES = ["image/png", "image/jpeg", "image/webp", "application/pdf"];
const MAX_PROOF = 25 * 1024 * 1024;
export const proofKind = (contentType: string) => (contentType === "application/pdf" ? "pdf" : "image");
const versionTag = (v: number) => `v${v}`;

// The current proof of a version: the last file attached to it
export async function proofFor(db: Db, deliverableId: string, version: number): Promise<StoredFile | null> {
  return db.storedFile.findFirst({ where: { ownerType: "DELIVERABLE", ownerId: deliverableId, category: versionTag(version), deletedAt: null }, orderBy: { createdAt: "desc" } });
}

export async function attachProof(db: Db, storage: StorageProvider, p: { actor: FileActor; deliverableId: string; name: string; bytes: Buffer }) {
  const d = await db.deliverable.findFirst({ where: { id: p.deliverableId, organizationId: p.actor.organizationId } });
  if (!d) throw new DeliverableError("Deliverable not found.");
  if (d.status !== "DRAFT") throw new DeliverableError(d.status === "CHANGES_REQUESTED" ? "Start the new version first (Make the changes), then attach its file." : "This version is with the client or approved, so its file can't change.");
  let file;
  try {
    file = await saveFile(db, storage, { actor: p.actor, ownerType: "DELIVERABLE", ownerId: d.id, name: p.name, bytes: p.bytes, category: versionTag(d.version), maxBytes: MAX_PROOF });
  } catch (e) {
    if (e instanceof FileError) throw new DeliverableError(e.message);
    throw e;
  }
  if (!PROOF_TYPES.includes(file.contentType)) {
    await db.storedFile.update({ where: { id: file.id }, data: { deletedAt: new Date(), deletedById: p.actor.id } });
    throw new DeliverableError("Attach an image (PNG, JPG or WebP) or a PDF, so the client can comment on it.");
  }
  // One proof per version: an earlier file for the same draft is put away
  await db.storedFile.updateMany({ where: { ownerType: "DELIVERABLE", ownerId: d.id, category: versionTag(d.version), deletedAt: null, id: { not: file.id } }, data: { deletedAt: new Date(), deletedById: p.actor.id } });
  return file;
}

// Who may read and comment: the same rule as the proof file (project visibility for staff; own project, once sent, for the client)
async function readable(db: Db, actor: FileActor, deliverableId: string) {
  const d = await db.deliverable.findFirst({ where: { id: deliverableId, organizationId: actor.organizationId } });
  if (!d || !(await authorizeOwner(db, actor, "DELIVERABLE", d.id, "read"))) return null;
  const project = await db.project.findUniqueOrThrow({ where: { id: d.projectId }, select: { name: true, managerId: true, clientId: true } });
  return { ...d, project };
}

export async function addProofComment(db: Db, p: { actor: FileActor; deliverableId: string; body: string; x?: number | null; y?: number | null; page?: number | null }) {
  const d = await readable(db, p.actor, p.deliverableId);
  if (!d) throw new DeliverableError("Not found.");
  const client = p.actor.userType === "CLIENT";
  if (client && d.status !== "PENDING") throw new DeliverableError("You can comment while this version waits for your approval.");
  if (!client && d.status === "APPROVED") throw new DeliverableError("This version is approved. Start a new deliverable for further changes.");
  const body = p.body.replace(/\r\n/g, "\n").trim();
  if (body.length < 2) throw new DeliverableError("Write your comment.");
  if (body.length > 2000) throw new DeliverableError("Keep a comment under 2,000 characters.");
  const file = await proofFor(db, d.id, d.version);
  let x: number | null = null, y: number | null = null, page: number | null = null;
  const pinned = p.x !== null && p.x !== undefined && p.y !== null && p.y !== undefined;
  if (pinned) {
    if (!file || proofKind(file.contentType) !== "image") throw new DeliverableError("Pins can only be placed on an image.");
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y) || p.x! < 0 || p.x! > 100 || p.y! < 0 || p.y! > 100) throw new DeliverableError("Place the pin on the image.");
    x = Math.round(p.x! * 100) / 100; y = Math.round(p.y! * 100) / 100;
  }
  if (p.page !== null && p.page !== undefined) {
    if (!file || proofKind(file.contentType) !== "pdf") throw new DeliverableError("Page numbers are for PDF proofs.");
    if (!Number.isInteger(p.page) || p.page < 1 || p.page > 2000) throw new DeliverableError("Enter a page number.");
    page = p.page;
  }
  const c = await db.deliverableComment.create({ data: { organizationId: d.organizationId, deliverableId: d.id, version: d.version, fileId: file?.id ?? null, authorId: p.actor.id, fromClient: client, body, x, y, page } });
  // The other side hears about it, at most once a day per version
  const day = new Date().toISOString().slice(0, 10);
  const who = (await db.user.findUnique({ where: { id: p.actor.id }, select: { name: true } }))?.name ?? "Someone";
  if (client) {
    const team = [...new Set([d.project.managerId, d.createdById, d.requestedById].filter((x): x is string => Boolean(x)))];
    await notifyMany(db, team, { kind: "deliverable.comment", title: `${who} commented on ${d.title}`, body: body.slice(0, 200), link: `/projects/${d.projectId}/deliverables/${d.id}`, dedupeKey: `proof-comment:${d.id}:${d.version}:${day}` });
  } else if (d.project.clientId && d.status === "PENDING") {
    const portal = (await db.user.findMany({ where: { clientId: d.project.clientId, active: true }, select: { id: true } })).map((u) => u.id);
    await notifyMany(db, portal, { kind: "deliverable.comment", title: `The team replied on ${d.title}`, body: body.slice(0, 200), link: `/portal/approvals/${d.id}`, dedupeKey: `proof-reply:${d.id}:${d.version}:${day}` });
  }
  return c;
}

// The team ticks a comment off when it is dealt with (or opens it again)
export async function resolveProofComment(db: Db, p: { actor: FileActor; commentId: string; resolved: boolean }) {
  if (p.actor.userType !== "EMPLOYEE") throw new DeliverableError("Not found.");
  const c = await db.deliverableComment.findFirst({ where: { id: p.commentId, organizationId: p.actor.organizationId } });
  if (!c || !(await readable(db, p.actor, c.deliverableId))) throw new DeliverableError("Not found.");
  return db.deliverableComment.update({ where: { id: c.id }, data: p.resolved ? { resolvedAt: new Date(), resolvedById: p.actor.id } : { resolvedAt: null, resolvedById: null } });
}

// Everything the proof screen shows for one version: the file, its comments in order (pins are numbered by that order), who wrote them
export async function proofBoard(db: Db, actor: FileActor, deliverableId: string, version?: number) {
  const d = await readable(db, actor, deliverableId);
  if (!d) return null;
  const v = version && version >= 1 && version <= d.version ? version : d.version;
  const shown = v; // a client never gets here while the deliverable is a draft (see the DELIVERABLE file rule)
  const [file, comments, versions] = await Promise.all([
    proofFor(db, d.id, shown),
    db.deliverableComment.findMany({ where: { deliverableId: d.id, version: shown }, orderBy: { createdAt: "asc" } }),
    db.storedFile.findMany({ where: { ownerType: "DELIVERABLE", ownerId: d.id, deletedAt: null }, select: { category: true } }),
  ]);
  const names = new Map((await db.user.findMany({ where: { id: { in: [...new Set(comments.map((c) => c.authorId))] } }, select: { id: true, name: true } })).map((u) => [u.id, u.name]));
  let pin = 0;
  return {
    deliverable: d, version: shown,
    versions: [...new Set(versions.map((f) => Number(f.category?.slice(1))).filter((n) => Number.isInteger(n)))].sort((a, b) => a - b),
    file: file ? { id: file.id, name: file.filename, kind: proofKind(file.contentType) as "image" | "pdf" } : null,
    comments: comments.map((c) => ({ id: c.id, body: c.body, author: names.get(c.authorId) ?? "Someone", fromClient: c.fromClient, at: c.createdAt, x: c.x, y: c.y, page: c.page, resolved: Boolean(c.resolvedAt), pin: c.x !== null && c.y !== null ? ++pin : null })),
  };
}

export async function openClientComments(db: Db, deliverableId: string, version: number) {
  return db.deliverableComment.count({ where: { deliverableId, version, fromClient: true, resolvedAt: null } });
}
