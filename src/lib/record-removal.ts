import type { Prisma, PrismaClient } from "@prisma/client";

// Archive and delete for projects and clients created by mistake or while testing.
// Delete is permanent, so it is only allowed when nothing real hangs off the record: money, time, published or planned content,
// files, client conversations. Anything like that is a "blocker"; the record can then only be archived (projects) or marked
// inactive (clients), which keeps the history. Plain working notes (tasks, milestones, updates, members) go with a deleted project.

type Db = PrismaClient | Prisma.TransactionClient;
export type Blocker = { label: string; count: number };

export class RemovalError extends Error {}

const keep = (rows: Blocker[]) => rows.filter((b) => b.count > 0);

export async function projectDeleteBlockers(db: Db, projectId: string): Promise<Blocker[]> {
  const [invoices, time, sessions, budgets, expenses, workOrders, content, clout, support, meetings, deliverables, assets, chat] = await Promise.all([
    db.invoice.count({ where: { projectId } }),
    db.timeEntry.count({ where: { projectId } }),
    db.workSession.count({ where: { projectId } }),
    db.budget.count({ where: { projectId } }),
    db.expenseVoucher.count({ where: { projectId } }),
    db.workOrder.count({ where: { projectId } }),
    db.contentItem.count({ where: { projectId } }),
    db.cloutPost.count({ where: { projectId } }),
    db.supportRequest.count({ where: { projectId } }),
    db.meeting.count({ where: { projectId } }),
    db.deliverable.count({ where: { projectId } }),
    db.projectAsset.count({ where: { projectId } }),
    db.chatMessage.count({ where: { room: { projectId } } }),
  ]);
  return keep([
    { label: "invoices", count: invoices }, { label: "time logs", count: time }, { label: "work sessions", count: sessions },
    { label: "budgets", count: budgets }, { label: "expense vouchers", count: expenses }, { label: "work orders", count: workOrders },
    { label: "content posts", count: content }, { label: "tracked influencer posts", count: clout }, { label: "support requests", count: support },
    { label: "meetings", count: meetings }, { label: "deliverables", count: deliverables }, { label: "shared files", count: assets },
    { label: "team chat messages", count: chat },
  ]);
}

export function describeBlockers(b: Blocker[]): string {
  return b.map((x) => `${x.count} ${x.count === 1 ? x.label.replace(/s$/, "").replace(/ie$/, "y") : x.label}`).join(", ");
}

// Confirmation is the exact name typed by the person (spaces at the ends ignored, case must match).
export const nameMatches = (typed: unknown, name: string) => typeof typed === "string" && typed.trim() === name.trim();

export async function archiveProject(db: Db, organizationId: string, projectId: string, byUserId: string) {
  const p = await db.project.findFirst({ where: { id: projectId, organizationId } });
  if (!p) throw new RemovalError("Project not found.");
  if (p.archivedAt) throw new RemovalError("This project is already archived.");
  if (p.status !== "COMPLETED" && p.status !== "CANCELLED") throw new RemovalError("Set the project to Completed or Cancelled before archiving it.");
  return db.project.update({ where: { id: p.id }, data: { archivedAt: new Date(), archivedById: byUserId } });
}

export async function restoreProject(db: Db, organizationId: string, projectId: string) {
  const p = await db.project.findFirst({ where: { id: projectId, organizationId } });
  if (!p) throw new RemovalError("Project not found.");
  if (!p.archivedAt) throw new RemovalError("This project is not archived.");
  return db.project.update({ where: { id: p.id }, data: { archivedAt: null, archivedById: null } });
}

// Deletes the project with its tasks, comments, milestones, updates and members. Refuses when anything in projectDeleteBlockers exists.
export async function deleteProject(db: PrismaClient, organizationId: string, projectId: string) {
  return db.$transaction(async (tx) => {
    const p = await tx.project.findFirst({ where: { id: projectId, organizationId } });
    if (!p) throw new RemovalError("Project not found.");
    const blockers = await projectDeleteBlockers(tx, p.id);
    if (blockers.length) throw new RemovalError(`This project has ${describeBlockers(blockers)}, so it can't be deleted. Archive it instead.`);
    const taskIds = (await tx.task.findMany({ where: { projectId: p.id }, select: { id: true } })).map((t) => t.id);
    await tx.chatRoom.deleteMany({ where: { projectId: p.id } }); // empty, or it would have blocked
    await tx.task.updateMany({ where: { projectId: p.id }, data: { parentId: null } });
    await tx.project.delete({ where: { id: p.id } }); // tasks, comments, milestones, updates, members and share links cascade
    return { project: p, tasks: taskIds.length };
  });
}

export async function clientDeleteBlockers(db: Db, organizationId: string, clientId: string): Promise<Blocker[]> {
  const w = { clientId };
  const [projects, invoices, payments, journal, credits, quotes, subs, contracts, commissions, engagements, reviews, bonuses, resale, support, agreements, content, media, portalUsers] = await Promise.all([
    db.project.count({ where: { organizationId, clientId } }),
    db.invoice.count({ where: w }), db.payment.count({ where: w }), db.journalLine.count({ where: w }), db.creditNote.count({ where: w }),
    db.quote.count({ where: w }), db.subscription.count({ where: w }), db.contract.count({ where: w }), db.commissionEntry.count({ where: w }),
    db.engagement.count({ where: w }), db.clientReview.count({ where: w }), db.pmMonthlyBonus.count({ where: w }), db.resaleSchool.count({ where: w }),
    db.supportRequest.count({ where: w }), db.agreement.count({ where: w }), db.contentItem.count({ where: w }), db.mediaItem.count({ where: w }),
    db.user.count({ where: { clientId } }),
  ]);
  return keep([
    { label: "projects", count: projects }, { label: "invoices", count: invoices }, { label: "payments", count: payments },
    { label: "ledger entries", count: journal }, { label: "credit notes", count: credits }, { label: "quotations", count: quotes },
    { label: "subscriptions", count: subs }, { label: "contracts", count: contracts }, { label: "commission entries", count: commissions },
    { label: "engagements", count: engagements }, { label: "client reviews", count: reviews }, { label: "manager bonuses", count: bonuses },
    { label: "resold schools", count: resale }, { label: "support requests", count: support }, { label: "agreements", count: agreements },
    { label: "content posts", count: content }, { label: "media library files", count: media }, { label: "portal users", count: portalUsers },
  ]);
}

export async function setClientActive(db: Db, organizationId: string, clientId: string, active: boolean) {
  const c = await db.client.findFirst({ where: { id: clientId, organizationId } });
  if (!c) throw new RemovalError("Client not found.");
  return db.client.update({ where: { id: c.id }, data: { active } });
}

// Deletes a client that has nothing real attached. Its content settings (brand kit, hashtag sets, AI runs, connected accounts,
// review requests, unused portal invites) go with it; leads, meetings and mail threads that pointed at it keep their history unlinked.
export async function deleteClient(db: PrismaClient, organizationId: string, clientId: string) {
  return db.$transaction(async (tx) => {
    const c = await tx.client.findFirst({ where: { id: clientId, organizationId } });
    if (!c) throw new RemovalError("Client not found.");
    const blockers = await clientDeleteBlockers(tx, organizationId, c.id);
    if (blockers.length) throw new RemovalError(`This client has ${describeBlockers(blockers)}, so it can't be deleted. Mark it inactive instead.`);
    const w = { clientId: c.id };
    await tx.clientInvite.deleteMany({ where: w });
    await tx.clientReviewRequest.deleteMany({ where: w });
    await tx.clientContentProfile.deleteMany({ where: w });
    await tx.contentAiRun.deleteMany({ where: w });
    await tx.hashtagGroup.deleteMany({ where: w });
    await tx.socialConnectSession.deleteMany({ where: w });
    await tx.socialAccount.deleteMany({ where: w });
    await tx.brandKit.deleteMany({ where: w });
    await tx.lead.updateMany({ where: w, data: { clientId: null } });
    await tx.meeting.updateMany({ where: w, data: { clientId: null } });
    await tx.mailThread.updateMany({ where: w, data: { clientId: null } });
    await tx.client.delete({ where: { id: c.id } }); // campaign links and fast-lane quota cascade; site visits and solution links unlink
    return c;
  });
}
