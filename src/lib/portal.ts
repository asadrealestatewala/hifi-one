// Client portal data access. Every function takes the client id from the signed-in portal user's
// own record, never from the URL, and filters by it, so one client can never read another's data.
// Free of Next.js imports so it can be tested directly against the database.
import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import type { PrismaClient } from "@prisma/client";
import { LedgerError } from "./ledger-math";

// Only issued documents are visible to clients (no drafts, no cancelled).
const VISIBLE_STATUSES = ["ISSUED", "PARTIALLY_PAID", "PAID", "CREDITED"];

export function portalInvoices(db: PrismaClient, clientId: string) {
  return db.invoice.findMany({
    where: { clientId, status: { in: VISIBLE_STATUSES } },
    orderBy: { issueDate: "desc" },
    select: { id: true, number: true, status: true, currency: true, issueDate: true, dueDate: true, total: true, amountPaid: true, creditedAmount: true },
  });
}

export function portalInvoice(db: PrismaClient, clientId: string, invoiceId: string) {
  return db.invoice.findFirst({
    where: { id: invoiceId, clientId, status: { in: VISIBLE_STATUSES } },
    include: { lines: true, client: true },
  });
}

// Payments this client has made, for receipts
export function portalPayments(db: PrismaClient, clientId: string) {
  return db.payment.findMany({ where: { clientId }, orderBy: { date: "desc" }, select: { id: true, number: true, date: true, amount: true, currency: true }, take: 50 });
}

// Projects of this client, with only the tasks marked client-visible. Internal notes, budgets,
// costs and non-visible tasks are never selected.
export async function portalProjects(db: PrismaClient, clientId: string) {
  const projects = await db.project.findMany({
    where: { clientId, status: { not: "CANCELLED" } },
    orderBy: { createdAt: "desc" },
    select: {
      id: true, number: true, name: true, status: true, deadline: true,
      tasks: { select: { status: true, title: true, clientVisible: true, dueDate: true } },
    },
  });
  return projects.map((p) => {
    const done = p.tasks.filter((t) => t.status === "DONE").length;
    return {
      id: p.id, number: p.number, name: p.name, status: p.status, deadline: p.deadline,
      progress: p.tasks.length ? Math.round((done / p.tasks.length) * 100) : 0,
      tasks: p.tasks.filter((t) => t.clientVisible).map((t) => ({ title: t.title, status: t.status, dueDate: t.dueDate })),
    };
  });
}

// The staff member looking after this client: the client's allocated project manager, or else the manager of the project
// being viewed. Only the name and employee number are shared, never contact details, pay or other staff data.
// For SaaS customers the dedicated support manager is their contact (else the project manager covers support).
export async function portalSupport(db: PrismaClient, clientId: string) {
  const c = await db.client.findUnique({ where: { id: clientId }, select: { organizationId: true, clientType: true, supportManagerId: true, projectManagerId: true } });
  const id = c && c.clientType === "SAAS" ? (c.supportManagerId ?? c.projectManagerId) : null;
  if (!c || !id) return null;
  const user = await db.user.findFirst({ where: { id, organizationId: c.organizationId, userType: "EMPLOYEE" }, select: { name: true, employeeProfile: { select: { employeeNo: true } } } });
  return user ? { name: user.name, employeeNo: user.employeeProfile?.employeeNo ?? null, dedicated: Boolean(c.supportManagerId) } : null;
}

export async function portalManager(db: PrismaClient, clientId: string, projectManagerId?: string | null) {
  const client = await db.client.findUnique({ where: { id: clientId }, select: { organizationId: true, projectManagerId: true } });
  const id = client?.projectManagerId ?? projectManagerId ?? null;
  if (!client || !id) return null;
  const user = await db.user.findFirst({ where: { id, organizationId: client.organizationId, userType: "EMPLOYEE" }, select: { name: true, employeeProfile: { select: { employeeNo: true } } } });
  return user ? { name: user.name, employeeNo: user.employeeProfile?.employeeNo ?? null } : null;
}

// One project of this client with its client-visible tasks and the comments shared with the client (never internal ones).
export async function portalProject(db: PrismaClient, clientId: string, projectId: string) {
  const project = await db.project.findFirst({
    where: { id: projectId, clientId, status: { not: "CANCELLED" } },
    select: { id: true, number: true, name: true, status: true, deadline: true, startDate: true, scope: true, managerId: true, tasks: { select: { id: true, status: true, title: true, clientVisible: true, dueDate: true, parentId: true } } },
  });
  if (!project) return null;
  const done = project.tasks.filter((t) => t.status === "DONE").length;
  const visible = project.tasks.filter((t) => t.clientVisible && !t.parentId);
  const comments = await db.taskComment.findMany({ where: { taskId: { in: visible.map((t) => t.id) }, internal: false }, orderBy: { createdAt: "asc" } });
  const authors = new Map((await db.user.findMany({ where: { id: { in: [...new Set(comments.map((c) => c.authorId))] } }, select: { id: true, name: true, clientId: true } })).map((u) => [u.id, u]));
  return {
    id: project.id, number: project.number, name: project.name, status: project.status, deadline: project.deadline, startDate: project.startDate, scope: project.scope,
    manager: await portalManager(db, clientId, project.managerId),
    progress: project.tasks.length ? Math.round((done / project.tasks.length) * 100) : 0,
    tasks: visible.map((t) => ({
      id: t.id, title: t.title, status: t.status, dueDate: t.dueDate,
      comments: comments.filter((c) => c.taskId === t.id).map((c) => ({ id: c.id, body: c.body, at: c.createdAt, author: authors.get(c.authorId)?.name ?? "Hifi team", mine: authors.get(c.authorId)?.clientId === clientId })),
    })),
  };
}

// A client comment on a task. The task must be in one of this client's projects and marked client-visible; the comment is
// shared (not internal), so staff see it marked as from the client.
export async function portalAddComment(db: PrismaClient, p: { clientId: string; userId: string; taskId: string; body: string }) {
  const body = p.body.trim();
  if (!body) throw new LedgerError("Write a message first.");
  if (body.length > 2000) throw new LedgerError("The message is too long.");
  const task = await db.task.findFirst({ where: { id: p.taskId, clientVisible: true, project: { clientId: p.clientId, status: { not: "CANCELLED" } } }, select: { id: true } });
  if (!task) throw new LedgerError("Task not found.");
  return db.taskComment.create({ data: { taskId: task.id, authorId: p.userId, body, internal: false } });
}

const hash = (token: string) => crypto.createHash("sha256").update(token).digest("hex");

export async function createInvite(db: PrismaClient, p: { organizationId: string; clientId: string; email: string; createdById: string }) {
  const client = await db.client.findFirst({ where: { id: p.clientId, organizationId: p.organizationId } });
  if (!client) throw new LedgerError("Unknown client.");
  const email = p.email.trim().toLowerCase();
  if (await db.user.findUnique({ where: { email } })) throw new LedgerError("A user with this email already exists.");
  const token = crypto.randomBytes(32).toString("base64url");
  await db.clientInvite.create({
    data: { clientId: client.id, email, tokenHash: hash(token), expiresAt: new Date(Date.now() + 7 * 86400000), createdById: p.createdById },
  });
  return token; // returned once; only its hash is stored
}

export async function createVendorInvite(db: PrismaClient, p: { organizationId: string; vendorId: string; email: string; createdById: string }) {
  const vendor = await db.vendor.findFirst({ where: { id: p.vendorId, organizationId: p.organizationId } });
  if (!vendor) throw new LedgerError("Unknown vendor.");
  if (vendor.status === "SUSPENDED") throw new LedgerError("This vendor is suspended.");
  const email = p.email.trim().toLowerCase();
  if (await db.user.findUnique({ where: { email } })) throw new LedgerError("A user with this email already exists.");
  const token = crypto.randomBytes(32).toString("base64url");
  await db.clientInvite.create({
    data: { vendorId: vendor.id, email, tokenHash: hash(token), expiresAt: new Date(Date.now() + 7 * 86400000), createdById: p.createdById },
  });
  return token;
}

export async function inviteInfo(db: PrismaClient, token: string) {
  const inv = await db.clientInvite.findUnique({ where: { tokenHash: hash(token) }, include: { client: true, vendor: true } });
  if (!inv || inv.usedAt || inv.expiresAt < new Date()) return null;
  return { email: inv.email, clientName: inv.client?.name ?? inv.vendor?.name ?? "" };
}

export async function acceptInvite(db: PrismaClient, p: { token: string; name: string; password: string }) {
  if (p.password.length < 10) throw new LedgerError("Use a password of at least 10 characters.");
  const passwordHash = await bcrypt.hash(p.password, 12);
  return db.$transaction(async (tx) => {
    const found = await tx.clientInvite.findUnique({ where: { tokenHash: hash(p.token) }, include: { client: true, vendor: true } });
    if (!found) throw new LedgerError("This invitation link is not valid.");
    await tx.$queryRaw`SELECT id FROM "ClientInvite" WHERE id = ${found.id} FOR UPDATE`;
    const inv = await tx.clientInvite.findUniqueOrThrow({ where: { id: found.id } });
    if (inv.usedAt || inv.expiresAt < new Date()) throw new LedgerError("This invitation was already used or has expired.");
    const owner = found.client ?? found.vendor;
    if (!owner) throw new LedgerError("This invitation link is not valid.");
    const isVendor = Boolean(found.vendor);
    const role = await tx.role.findFirst({ where: { organizationId: owner.organizationId, key: isVendor ? "VENDOR" : "CLIENT" } });
    const user = await tx.user.create({
      data: {
        organizationId: owner.organizationId, email: inv.email, name: p.name.trim(), passwordHash,
        userType: isVendor ? "VENDOR" : "CLIENT", clientId: isVendor ? null : inv.clientId, vendorId: isVendor ? inv.vendorId : null,
        roles: role ? { create: { roleId: role.id } } : undefined,
      },
    });
    await tx.clientInvite.update({ where: { id: inv.id }, data: { usedAt: new Date() } });
    return user;
  });
}
