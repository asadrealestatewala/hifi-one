// Client support requests. A request belongs to one client and is raised by one of their portal users (or by staff on their
// behalf). Messages are either shared with the client or internal notes that the portal never reads. Every portal function takes
// the client id from the signed-in portal user, never from the address. Free of Next.js imports so it can be tested.
import type { Prisma, PrismaClient } from "@prisma/client";
import { notifyMany, usersWithPermission } from "./notifications";

export class SupportError extends Error {}
type Db = PrismaClient;

export const SUPPORT_STATUSES = ["OPEN", "IN_PROGRESS", "WAITING_CLIENT", "RESOLVED", "CLOSED"] as const;
export const SUPPORT_PRIORITIES = ["NORMAL", "HIGH", "URGENT"] as const;
export type SupportStatus = (typeof SUPPORT_STATUSES)[number];

const clean = (v: string, max: number) => v.replace(/\r\n/g, "\n").trim().slice(0, max);

async function nextNo(tx: Prisma.TransactionClient, organizationId: string) {
  const seq = await tx.numberSequence.upsert({ where: { organizationId_key: { organizationId, key: "SUPPORT" } }, create: { organizationId, key: "SUPPORT", next: 2 }, update: { next: { increment: 1 } } });
  return `SUP-${String(seq.next - 1).padStart(4, "0")}`;
}

const portalUsers = async (db: Db, clientId: string) => (await db.user.findMany({ where: { clientId, active: true }, select: { id: true } })).map((u) => u.id);

export async function createRequest(db: Db, p: { organizationId: string; clientId: string; userId: string; subject: string; body: string; priority?: string; projectId?: string | null }) {
  const subject = clean(p.subject, 160);
  const body = clean(p.body, 4000);
  if (subject.length < 4) throw new SupportError("Give the request a short subject.");
  if (body.length < 10) throw new SupportError("Describe what you need in a sentence or two.");
  const priority = (SUPPORT_PRIORITIES as readonly string[]).includes(p.priority ?? "") ? p.priority! : "NORMAL";
  if (!(await db.client.findFirst({ where: { id: p.clientId, organizationId: p.organizationId } }))) throw new SupportError("Unknown client.");
  if (p.projectId && !(await db.project.findFirst({ where: { id: p.projectId, organizationId: p.organizationId, clientId: p.clientId } }))) throw new SupportError("Choose one of your projects.");
  const req = await db.$transaction(async (tx) => {
    const number = await nextNo(tx, p.organizationId);
    return tx.supportRequest.create({ data: { organizationId: p.organizationId, number, clientId: p.clientId, createdById: p.userId, subject, priority, projectId: p.projectId ?? null, messages: { create: { authorId: p.userId, body } } } });
  });
  // Staff who handle support, and the project manager when the request is about a project
  const project = req.projectId ? await db.project.findUnique({ where: { id: req.projectId }, select: { managerId: true } }) : null;
  const people = [...new Set([...(await usersWithPermission(db, p.organizationId, "support.manage")), ...(project ? [project.managerId] : [])])];
  const client = await db.client.findUnique({ where: { id: p.clientId }, select: { name: true } });
  await notifyMany(db, people, { kind: "support.new", title: `New support request from ${client?.name ?? "a client"}`, body: `${req.number}: ${subject}`, link: `/support/${req.id}`, dedupeKey: `support-new:${req.id}` });
  return req;
}

// ----- the client's side -----

export const portalRequests = (db: Db, clientId: string) =>
  db.supportRequest.findMany({ where: { clientId }, orderBy: [{ updatedAt: "desc" }, { id: "asc" }], select: { id: true, number: true, subject: true, status: true, priority: true, updatedAt: true, createdAt: true } });

export async function portalRequest(db: Db, clientId: string, id: string) {
  const r = await db.supportRequest.findFirst({ where: { id, clientId }, include: { messages: { where: { internal: false }, orderBy: { createdAt: "asc" } } } });
  if (!r) return null;
  const authors = new Map((await db.user.findMany({ where: { id: { in: [...new Set(r.messages.map((m) => m.authorId))] } }, select: { id: true, name: true, clientId: true } })).map((u) => [u.id, u]));
  return { ...r, messages: r.messages.map((m) => ({ id: m.id, body: m.body, at: m.createdAt, author: authors.get(m.authorId)?.name ?? "Hifi team", mine: authors.get(m.authorId)?.clientId === clientId })) };
}

export async function clientReply(db: Db, p: { organizationId: string; clientId: string; userId: string; requestId: string; body: string }) {
  const body = clean(p.body, 4000);
  if (!body) throw new SupportError("Write a message first.");
  const r = await db.supportRequest.findFirst({ where: { id: p.requestId, clientId: p.clientId, organizationId: p.organizationId } });
  if (!r) throw new SupportError("Request not found.");
  if (r.status === "CLOSED") throw new SupportError("This request is closed. Please open a new one.");
  const m = await db.supportMessage.create({ data: { requestId: r.id, authorId: p.userId, body } });
  // A reply from the client reopens a resolved request and ends the wait
  const status = r.status === "RESOLVED" || r.status === "WAITING_CLIENT" ? "OPEN" : r.status;
  await db.supportRequest.update({ where: { id: r.id }, data: { status, resolvedAt: status === "OPEN" ? null : r.resolvedAt } });
  const people = [...new Set([r.assigneeId, ...(r.assigneeId ? [] : await usersWithPermission(db, p.organizationId, "support.manage"))].filter((x): x is string => !!x))];
  await notifyMany(db, people, { kind: "support.client_reply", title: `${r.number}: the client replied`, body: body.slice(0, 140), link: `/support/${r.id}`, dedupeKey: `support-msg:${m.id}` });
  return m;
}

// ----- the team's side -----

export async function staffReply(db: Db, p: { organizationId: string; authorId: string; requestId: string; body: string; internal?: boolean; status?: string }) {
  const body = clean(p.body, 4000);
  if (!body) throw new SupportError("Write a message first.");
  const r = await db.supportRequest.findFirst({ where: { id: p.requestId, organizationId: p.organizationId } });
  if (!r) throw new SupportError("Request not found.");
  if (p.status && !(SUPPORT_STATUSES as readonly string[]).includes(p.status)) throw new SupportError("Choose a status.");
  const m = await db.supportMessage.create({ data: { requestId: r.id, authorId: p.authorId, body, internal: Boolean(p.internal) } });
  // The first answer picks the request up; the person replying can set the new status in the same step
  const status = p.status ?? (r.status === "OPEN" && !p.internal ? "IN_PROGRESS" : r.status);
  await db.supportRequest.update({ where: { id: r.id }, data: { status, assigneeId: r.assigneeId ?? p.authorId, resolvedAt: status === "RESOLVED" ? new Date() : status === r.status ? r.resolvedAt : null } });
  if (!p.internal) {
    await notifyMany(db, await portalUsers(db, r.clientId), { kind: "support.reply", title: `${r.number}: the team replied`, body: body.slice(0, 140), link: `/portal/support/${r.id}`, dedupeKey: `support-msg:${m.id}` });
  }
  return m;
}

export async function setSupportStatus(db: Db, p: { organizationId: string; requestId: string; status: string; actorId: string }) {
  if (!(SUPPORT_STATUSES as readonly string[]).includes(p.status)) throw new SupportError("Choose a status.");
  const r = await db.supportRequest.findFirst({ where: { id: p.requestId, organizationId: p.organizationId } });
  if (!r) throw new SupportError("Request not found.");
  if (r.status === p.status) return r;
  const u = await db.supportRequest.update({ where: { id: r.id }, data: { status: p.status, resolvedAt: p.status === "RESOLVED" ? new Date() : null } });
  if (p.status === "RESOLVED" || p.status === "CLOSED") {
    await notifyMany(db, await portalUsers(db, r.clientId), { kind: "support.resolved", title: `${r.number} was ${p.status === "RESOLVED" ? "resolved" : "closed"}`, body: r.subject, link: `/portal/support/${r.id}`, dedupeKey: `support-status:${r.id}:${p.status}` });
  }
  return u;
}

export async function assignRequest(db: Db, p: { organizationId: string; requestId: string; assigneeId: string | null; actorId: string; priority?: string }) {
  const r = await db.supportRequest.findFirst({ where: { id: p.requestId, organizationId: p.organizationId } });
  if (!r) throw new SupportError("Request not found.");
  if (p.assigneeId && !(await db.user.findFirst({ where: { id: p.assigneeId, organizationId: p.organizationId, userType: "EMPLOYEE", active: true } }))) throw new SupportError("Choose an active staff member.");
  if (p.priority && !(SUPPORT_PRIORITIES as readonly string[]).includes(p.priority)) throw new SupportError("Choose a priority.");
  await db.supportRequest.update({ where: { id: r.id }, data: { assigneeId: p.assigneeId, ...(p.priority ? { priority: p.priority } : {}) } });
  if (p.assigneeId && p.assigneeId !== r.assigneeId && p.assigneeId !== p.actorId) {
    await notifyMany(db, [p.assigneeId], { kind: "support.assigned", title: `Support request assigned to you: ${r.number}`, body: r.subject, link: `/support/${r.id}`, dedupeKey: `support-assigned:${r.id}:${p.assigneeId}` });
  }
}
