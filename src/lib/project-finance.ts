// Project depth: milestones that can be billed, time logging with a frozen cost rate, and profitability.
// Profit = revenue (issued invoices linked to the project, before tax) minus actual cost (labour from logged time,
// approved-and-posted expenses, posted vendor bills). Open work orders are shown as commitments, not costs.
// Everything is in the project's currency; records in another currency are listed as excluded, never converted silently.
import type { PrismaClient } from "@prisma/client";
import { createDraftInvoice, LedgerError } from "./accounting";
import { dec, round2 } from "./ledger-math";
import { notify } from "./notifications";

export class ProjectError extends Error {}
type Db = PrismaClient;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const validDate = (d: string) => DATE.test(d) && !Number.isNaN(Date.parse(d));
const money = /^\d{1,12}(\.\d{1,2})?$/;

async function ownProject(db: Db, organizationId: string, projectId: string) {
  const p = await db.project.findFirst({ where: { id: projectId, organizationId } });
  if (!p) throw new ProjectError("Project not found.");
  return p;
}

// ---------- milestones ----------
export async function addMilestone(db: Db, p: { organizationId: string; projectId: string; name: string; dueDate?: string | null; amount?: string | null }) {
  const project = await ownProject(db, p.organizationId, p.projectId);
  if (["COMPLETED", "CANCELLED"].includes(project.status)) throw new ProjectError("This project is closed.");
  if (!p.name.trim()) throw new ProjectError("Give the milestone a name.");
  if (p.dueDate && !validDate(p.dueDate)) throw new ProjectError("Enter a valid due date.");
  if (p.amount && (!money.test(p.amount) || dec(p.amount).lte(0))) throw new ProjectError("Enter the billing amount as a positive number, or leave it empty.");
  if (p.amount && !project.clientId) throw new ProjectError("Only projects with a client can have billable milestones.");
  const last = await db.milestone.aggregate({ where: { projectId: project.id }, _max: { sortOrder: true } });
  return db.milestone.create({ data: { projectId: project.id, name: p.name.trim().slice(0, 160), dueDate: p.dueDate || null, amount: p.amount || null, sortOrder: (last._max.sortOrder ?? 0) + 1 } });
}

export async function assignTaskToMilestone(db: Db, p: { organizationId: string; taskId: string; milestoneId: string | null }) {
  const task = await db.task.findFirst({ where: { id: p.taskId, project: { organizationId: p.organizationId } } });
  if (!task) throw new ProjectError("Task not found.");
  if (p.milestoneId) {
    const m = await db.milestone.findFirst({ where: { id: p.milestoneId, projectId: task.projectId } });
    if (!m) throw new ProjectError("That milestone belongs to a different project.");
    if (m.status === "DONE") throw new ProjectError("That milestone is already done.");
  }
  await db.task.update({ where: { id: task.id }, data: { milestoneId: p.milestoneId } });
}

export async function setMilestoneStatus(db: Db, p: { organizationId: string; milestoneId: string; to: "PENDING" | "IN_PROGRESS" | "DONE" }) {
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Milestone" WHERE id = ${p.milestoneId} FOR UPDATE`;
    const m = await tx.milestone.findFirst({ where: { id: p.milestoneId, project: { organizationId: p.organizationId } }, include: { tasks: true } });
    if (!m) throw new ProjectError("Milestone not found.");
    if (m.invoiceId) throw new ProjectError("This milestone has been invoiced and can no longer change.");
    if (p.to === "DONE") {
      const open = m.tasks.filter((t) => t.status !== "DONE").length;
      if (open > 0) throw new ProjectError(`${open} task${open === 1 ? " is" : "s are"} not done yet.`);
    }
    return tx.milestone.update({ where: { id: m.id }, data: { status: p.to, completedAt: p.to === "DONE" ? new Date() : null } });
  });
}

// Creates one draft invoice for a finished milestone. Billing twice, even at the same moment, returns the same invoice.
export async function billMilestone(db: Db, p: { organizationId: string; milestoneId: string; actorId: string; taxRate?: string }) {
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Milestone" WHERE id = ${p.milestoneId} FOR UPDATE`;
    const m = await tx.milestone.findFirst({ where: { id: p.milestoneId, project: { organizationId: p.organizationId } }, include: { project: true } });
    if (!m) throw new ProjectError("Milestone not found.");
    if (m.invoiceId) return { invoiceId: m.invoiceId, already: true };
    if (m.status !== "DONE") throw new ProjectError("Finish the milestone before billing it.");
    if (!m.amount) throw new ProjectError("This milestone has no billing amount.");
    if (!m.project.clientId) throw new ProjectError("This project has no client to bill.");
    let inv;
    try {
      inv = await createDraftInvoice(tx as unknown as PrismaClient, {
        organizationId: p.organizationId, clientId: m.project.clientId, currency: m.project.currency, taxRate: p.taxRate ?? "0", createdById: p.actorId,
        notes: `Project ${m.project.number}: ${m.project.name}`,
        lines: [{ description: `${m.project.name}: ${m.name}`, quantity: "1", unitPrice: m.amount.toString() }],
      });
    } catch (e) {
      if (e instanceof LedgerError) throw new ProjectError(e.message);
      throw e;
    }
    await tx.invoice.update({ where: { id: inv.id }, data: { projectId: m.projectId } });
    await tx.milestone.update({ where: { id: m.id }, data: { invoiceId: inv.id } });
    return { invoiceId: inv.id, already: false };
  });
}

// ---------- time ----------
export async function setMemberRate(db: Db, p: { organizationId: string; projectId: string; userId: string; hourlyCost: string | null }) {
  await ownProject(db, p.organizationId, p.projectId);
  if (p.hourlyCost !== null && (!money.test(p.hourlyCost))) throw new ProjectError("Enter the hourly cost as a number, or leave it empty.");
  const r = await db.projectMember.updateMany({ where: { projectId: p.projectId, userId: p.userId }, data: { hourlyCost: p.hourlyCost } });
  if (r.count === 0) throw new ProjectError("That person is not on this project.");
}

export async function logTime(db: Db, p: { organizationId: string; projectId: string; userId: string; taskId?: string | null; workDate: string; hours: string; note?: string; today: string }) {
  const project = await ownProject(db, p.organizationId, p.projectId);
  if (["COMPLETED", "CANCELLED"].includes(project.status)) throw new ProjectError("This project is closed.");
  if (!validDate(p.workDate)) throw new ProjectError("Enter a valid date.");
  if (p.workDate > p.today) throw new ProjectError("Time cannot be logged for a future date.");
  if (!/^\d{1,2}(\.\d{1,2})?$/.test(p.hours) || dec(p.hours).lte(0) || dec(p.hours).gt(24)) throw new ProjectError("Enter the hours as a number between 0 and 24.");
  const member = await db.projectMember.findUnique({ where: { projectId_userId: { projectId: p.projectId, userId: p.userId } } });
  if (!member && project.managerId !== p.userId) throw new ProjectError("Only people on the project can log time to it.");
  if (p.taskId && !(await db.task.findFirst({ where: { id: p.taskId, projectId: p.projectId } }))) throw new ProjectError("That task is not on this project.");
  return db.$transaction(async (tx) => {
    // One person's day cannot exceed 24 hours across all projects, even with simultaneous submissions.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"time:" + p.userId + ":" + p.workDate}))`;
    const day = await tx.timeEntry.aggregate({ where: { organizationId: p.organizationId, userId: p.userId, workDate: p.workDate }, _sum: { hours: true } });
    if (dec(day._sum.hours?.toString() ?? 0).add(p.hours).gt(24)) throw new ProjectError("That would put more than 24 hours on one day.");
    return tx.timeEntry.create({
      data: { organizationId: p.organizationId, projectId: p.projectId, taskId: p.taskId || null, userId: p.userId, workDate: p.workDate, hours: p.hours, note: p.note?.slice(0, 300) || null, hourlyCost: member?.hourlyCost ?? null },
    });
  });
}

export async function deleteTime(db: Db, p: { organizationId: string; entryId: string; actorId: string; isManager: boolean; today: string }) {
  const e = await db.timeEntry.findFirst({ where: { id: p.entryId, organizationId: p.organizationId } });
  if (!e) throw new ProjectError("Time entry not found.");
  if (e.userId !== p.actorId && !p.isManager) throw new ProjectError("You can only remove your own time.");
  if (e.approval === "APPROVED" && !p.isManager) throw new ProjectError("Approved time can only be removed by a project manager.");
  await db.timeEntry.delete({ where: { id: e.id } });
}

// A manager approves or rejects logged time. Nobody decides on their own hours. This is a review step: profitability still counts every
// entry (a rejected entry is a conversation with the person, who can remove it or log it again), so the figures never silently change.
export async function decideTime(db: Db, p: { organizationId: string; entryId: string; approverId: string; decision: "APPROVED" | "REJECTED"; note?: string }) {
  if (p.decision !== "APPROVED" && p.decision !== "REJECTED") throw new ProjectError("Choose approve or reject.");
  const note = p.note?.trim().slice(0, 300) || null;
  if (p.decision === "REJECTED" && !note) throw new ProjectError("Say why the time is rejected, so the person can fix it.");
  const e = await db.timeEntry.findFirst({ where: { id: p.entryId, organizationId: p.organizationId } });
  if (!e) throw new ProjectError("Time entry not found.");
  if (e.userId === p.approverId) throw new ProjectError("You cannot approve or reject your own time.");
  await db.timeEntry.update({ where: { id: e.id }, data: { approval: p.decision, approvedById: p.approverId, approvedAt: new Date(), approvalNote: note } });
  await notify(db, e.userId, {
    kind: "time.decided", title: p.decision === "APPROVED" ? `Your ${e.hours.toString()} h on ${e.workDate} was approved` : `Your ${e.hours.toString()} h on ${e.workDate} was rejected`,
    body: note ?? undefined, link: `/projects/${e.projectId}`, dedupeKey: `time-decided:${e.id}:${p.decision}:${Date.now()}`,
  });
  return { ...e, approval: p.decision };
}

// ---------- profitability ----------
export async function projectProfitability(db: Db, organizationId: string, projectId: string) {
  const project = await ownProject(db, organizationId, projectId);
  const cur = project.currency;
  const [invoices, entries, vouchers, bills, orders] = await Promise.all([
    db.invoice.findMany({ where: { organizationId, projectId, status: { in: ["ISSUED", "PARTIALLY_PAID", "PAID"] } }, select: { subtotal: true, currency: true, creditedAmount: true } }),
    db.timeEntry.findMany({ where: { organizationId, projectId } }),
    db.expenseVoucher.findMany({ where: { organizationId, projectId, status: { in: ["POSTED", "PAID"] } }, select: { amount: true, currency: true } }),
    db.vendorBill.findMany({ where: { organizationId, status: { in: ["POSTED", "PAID"] }, workOrder: { projectId } }, select: { amount: true, currency: true } }),
    db.workOrder.findMany({ where: { organizationId, projectId, status: { in: ["ISSUED", "DELIVERED", "ACCEPTED"] } }, select: { amount: true, currency: true, bills: { where: { status: { in: ["POSTED", "PAID"] } }, select: { amount: true } } } }),
  ]);
  const excluded = new Map<string, number>();
  const note = (c: string) => excluded.set(c, (excluded.get(c) ?? 0) + 1);
  const sum = <T extends { currency: string }>(rows: T[], f: (r: T) => string) => rows.reduce((a, r) => { if (r.currency !== cur) { note(r.currency); return a; } return a.add(f(r)); }, dec(0));

  const revenue = round2(sum(invoices, (i) => i.subtotal.toString()));
  const unrated = entries.filter((e) => e.hourlyCost === null).length;
  const hours = entries.reduce((a, e) => a.add(e.hours.toString()), dec(0));
  const labour = round2(entries.reduce((a, e) => a.add(dec(e.hours.toString()).mul(e.hourlyCost?.toString() ?? 0)), dec(0)));
  const expenses = round2(sum(vouchers, (v) => v.amount.toString()));
  const vendor = round2(sum(bills, (b) => b.amount.toString()));
  const committed = round2(orders.reduce((a, o) => {
    if (o.currency !== cur) { note(o.currency); return a; }
    const billed = o.bills.reduce((x, b) => x.add(b.amount.toString()), dec(0));
    const left = dec(o.amount.toString()).sub(billed);
    return left.gt(0) ? a.add(left) : a;
  }, dec(0)));
  const cost = labour.add(expenses).add(vendor);
  const profit = revenue.sub(cost);
  const budget = project.budgetAmount ? dec(project.budgetAmount.toString()) : null;
  return {
    currency: cur, revenue, labour, hours, entriesWithoutRate: unrated, expenses, vendor, committed, cost, profit,
    margin: revenue.gt(0) ? profit.div(revenue).mul(100).toDecimalPlaces(1) : null,
    budget, budgetUsedPct: budget && budget.gt(0) ? cost.add(committed).div(budget).mul(100).toDecimalPlaces(0) : null,
    excluded: [...excluded].map(([currency, count]) => ({ currency, count })),
  };
}
