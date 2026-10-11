// Client portal data access. Every function takes the client id from the signed-in portal user's
// own record, never from the URL, and filters by it, so one client can never read another's data.
// Free of Next.js imports so it can be tested directly against the database.
import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import type { PrismaClient } from "@prisma/client";
import { LedgerError } from "./ledger-math";

// Only issued documents are visible to clients (no drafts, no cancelled).
const VISIBLE_STATUSES = ["ISSUED", "PARTIALLY_PAID", "PAID"];

export function portalInvoices(db: PrismaClient, clientId: string) {
  return db.invoice.findMany({
    where: { clientId, status: { in: VISIBLE_STATUSES } },
    orderBy: { issueDate: "desc" },
    select: { id: true, number: true, status: true, currency: true, issueDate: true, dueDate: true, total: true, amountPaid: true },
  });
}

export function portalInvoice(db: PrismaClient, clientId: string, invoiceId: string) {
  return db.invoice.findFirst({
    where: { id: invoiceId, clientId, status: { in: VISIBLE_STATUSES } },
    include: { lines: true, client: true },
  });
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

export async function inviteInfo(db: PrismaClient, token: string) {
  const inv = await db.clientInvite.findUnique({ where: { tokenHash: hash(token) }, include: { client: true } });
  if (!inv || inv.usedAt || inv.expiresAt < new Date()) return null;
  return { email: inv.email, clientName: inv.client.name };
}

export async function acceptInvite(db: PrismaClient, p: { token: string; name: string; password: string }) {
  if (p.password.length < 10) throw new LedgerError("Use a password of at least 10 characters.");
  const passwordHash = await bcrypt.hash(p.password, 12);
  return db.$transaction(async (tx) => {
    const found = await tx.clientInvite.findUnique({ where: { tokenHash: hash(p.token) }, include: { client: true } });
    if (!found) throw new LedgerError("This invitation link is not valid.");
    await tx.$queryRaw`SELECT id FROM "ClientInvite" WHERE id = ${found.id} FOR UPDATE`;
    const inv = await tx.clientInvite.findUniqueOrThrow({ where: { id: found.id } });
    if (inv.usedAt || inv.expiresAt < new Date()) throw new LedgerError("This invitation was already used or has expired.");
    const role = await tx.role.findFirst({ where: { organizationId: found.client.organizationId, key: "CLIENT" } });
    const user = await tx.user.create({
      data: {
        organizationId: found.client.organizationId, email: inv.email, name: p.name.trim(), passwordHash,
        userType: "CLIENT", clientId: inv.clientId,
        roles: role ? { create: { roleId: role.id } } : undefined,
      },
    });
    await tx.clientInvite.update({ where: { id: inv.id }, data: { usedAt: new Date() } });
    return user;
  });
}
