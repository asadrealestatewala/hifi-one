// Commissions and bonuses.
// A salesperson earns a percentage of the revenue (before tax) on money actually received from clients they converted.
// Each payment allocation can earn at most one commission (database-unique), and only payments made after the rule
// was set count, so changing a rate never rewrites history. Payout is a two-step approval by someone other than the
// earner, and both steps are journal entries: approval accrues the cost (Dr commissions expense, Cr payroll payable),
// payment settles it (Dr payroll payable, Cr bank).
import type { PrismaClient } from "@prisma/client";
import { postJournal } from "./accounting";
import { dec, LedgerError, round2 } from "./ledger-math";
import { CURRENCIES } from "./money";

export class CommissionError extends Error {}
type Db = PrismaClient;

export async function setRule(db: Db, p: { organizationId: string; userId: string; ratePercent: string; active: boolean; actorId: string }) {
  if (!/^\d{1,2}(\.\d{1,2})?$/.test(p.ratePercent.trim()) || dec(p.ratePercent).gt(50)) throw new CommissionError("Enter a rate between 0 and 50 percent with up to two decimals.");
  const u = await db.user.findFirst({ where: { id: p.userId, organizationId: p.organizationId, userType: "EMPLOYEE", active: true } });
  if (!u) throw new CommissionError("Choose an active staff member.");
  const rate = p.ratePercent.trim();
  const before = await db.commissionRule.findUnique({ where: { organizationId_userId: { organizationId: p.organizationId, userId: p.userId } } });
  // A rate change restarts the clock so only later payments use the new rate
  const rule = await db.commissionRule.upsert({
    where: { organizationId_userId: { organizationId: p.organizationId, userId: p.userId } },
    update: { ratePercent: rate, active: p.active, updatedById: p.actorId, ...(before && (!before.ratePercent.eq(rate) || (!before.active && p.active)) ? { createdAt: new Date() } : {}) },
    create: { organizationId: p.organizationId, userId: p.userId, ratePercent: rate, active: p.active, updatedById: p.actorId },
  });
  return { rule, before };
}

// The person who owns a client's sales is the owner of the lead that converted into it (the latest, if several).
export async function salesOwnerOf(db: Db, organizationId: string, clientId: string): Promise<string | null> {
  const lead = await db.lead.findFirst({ where: { organizationId, clientId, convertedAt: { not: null }, assignedToId: { not: null } }, orderBy: { convertedAt: "desc" }, select: { assignedToId: true } });
  return lead?.assignedToId ?? null;
}

// Works out commissions for payment allocations that have none yet. Safe to run as often as you like.
export async function accrueCommissions(db: Db, p: { organizationId: string; actorId: string }) {
  const rules = await db.commissionRule.findMany({ where: { organizationId: p.organizationId, active: true } });
  if (rules.length === 0) return { created: 0 };
  const ruleBy = new Map(rules.map((r) => [r.userId, r]));
  const done = new Set((await db.commissionEntry.findMany({ where: { organizationId: p.organizationId, allocationId: { not: null } }, select: { allocationId: true } })).map((e) => e.allocationId!));
  const since = new Date(Math.min(...rules.map((r) => r.createdAt.getTime())));
  const allocations = await db.paymentAllocation.findMany({
    where: { payment: { organizationId: p.organizationId, createdAt: { gte: since } }, invoice: { organizationId: p.organizationId } },
    include: { invoice: true, payment: { select: { createdAt: true } } },
  });
  const ownerCache = new Map<string, string | null>();
  let created = 0;
  for (const a of allocations) {
    if (done.has(a.id)) continue;
    if (!ownerCache.has(a.invoice.clientId)) ownerCache.set(a.invoice.clientId, await salesOwnerOf(db, p.organizationId, a.invoice.clientId));
    const owner = ownerCache.get(a.invoice.clientId);
    const rule = owner ? ruleBy.get(owner) : undefined;
    if (!owner || !rule || a.payment.createdAt < rule.createdAt) continue;
    const total = dec(a.invoice.total.toString());
    if (total.lte(0)) continue;
    const base = round2(dec(a.amount.toString()).mul(a.invoice.subtotal.toString()).div(total)); // the revenue share of what was paid, tax excluded
    const amount = round2(base.mul(rule.ratePercent.toString()).div(100));
    if (amount.lte(0)) continue;
    const r = await db.commissionEntry.createMany({
      data: [{ organizationId: p.organizationId, userId: owner, kind: "COMMISSION", allocationId: a.id, invoiceId: a.invoiceId, clientId: a.invoice.clientId, currency: a.invoice.currency, base: base.toString(), ratePercent: rule.ratePercent.toString(), amount: amount.toString(), createdById: p.actorId }],
      skipDuplicates: true,
    });
    created += r.count;
  }
  return { created };
}

export async function addBonus(db: Db, p: { organizationId: string; userId: string; amount: string; currency: string; note: string; actorId: string }) {
  if (!/^\d{1,10}(\.\d{1,2})?$/.test(p.amount.trim()) || dec(p.amount).lte(0)) throw new CommissionError("Enter the bonus as a positive amount.");
  if (!(CURRENCIES as readonly string[]).includes(p.currency)) throw new CommissionError("Choose a supported currency.");
  if (p.note.trim().length < 3) throw new CommissionError("Say what the bonus is for.");
  if (!(await db.user.findFirst({ where: { id: p.userId, organizationId: p.organizationId, userType: "EMPLOYEE", active: true } }))) throw new CommissionError("Choose an active staff member.");
  return db.commissionEntry.create({ data: { organizationId: p.organizationId, userId: p.userId, kind: "BONUS", currency: p.currency, amount: p.amount.trim(), note: p.note.trim().slice(0, 300), createdById: p.actorId } });
}

async function transition(db: Db, id: string, organizationId: string, from: string, data: Record<string, unknown>, what: string) {
  const r = await db.commissionEntry.updateMany({ where: { id, organizationId, status: from }, data });
  if (r.count === 0) {
    const e = await db.commissionEntry.findFirst({ where: { id, organizationId }, select: { status: true } });
    if (!e) throw new CommissionError("Entry not found.");
    throw new CommissionError(`This entry is ${e.status.toLowerCase()} and cannot be ${what}.`);
  }
}

export const voidEntry = (db: Db, p: { organizationId: string; entryId: string }) => transition(db, p.entryId, p.organizationId, "EARNED", { status: "VOID" }, "voided");

async function account(tx: Parameters<Parameters<Db["$transaction"]>[0]>[0], organizationId: string, systemKey: string) {
  const a = await tx.account.findFirst({ where: { organizationId, systemKey, active: true } });
  if (!a) throw new CommissionError(`The chart of accounts is missing the ${systemKey} account.`);
  return a;
}

// Approval books the cost. The earner can never approve their own payout.
export async function approveEntry(db: Db, p: { organizationId: string; entryId: string; approverId: string }) {
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "CommissionEntry" WHERE id = ${p.entryId} FOR UPDATE`;
    const e = await tx.commissionEntry.findFirst({ where: { id: p.entryId, organizationId: p.organizationId } });
    if (!e) throw new CommissionError("Entry not found.");
    if (e.status !== "EARNED") throw new CommissionError(`This entry is ${e.status.toLowerCase()} and cannot be approved.`);
    if (e.userId === p.approverId) throw new CommissionError("You cannot approve your own commission. Ask someone else.");
    const expense = await account(tx, p.organizationId, "PAYROLL_EXPENSE");
    const payable = await account(tx, p.organizationId, "PAYROLL_PAYABLE");
    try {
      const j = await postJournal(tx, {
        organizationId: p.organizationId, date: new Date(), memo: `${e.kind === "BONUS" ? "Bonus" : "Commission"} accrued`, currency: e.currency, sourceType: "COMMISSION", sourceId: e.id,
        idempotencyKey: `commission-accrual:${e.id}`, postedById: p.approverId,
        lines: [{ accountId: expense.id, debit: e.amount, memo: e.note ?? "Commission" }, { accountId: payable.id, credit: e.amount, memo: e.note ?? "Commission" }],
      });
      await tx.commissionEntry.update({ where: { id: e.id }, data: { status: "APPROVED", approvedById: p.approverId, approvedAt: new Date(), accrualEntryId: j.id } });
      return j;
    } catch (err) {
      if (err instanceof LedgerError) throw new CommissionError(err.message);
      throw err;
    }
  });
}

export async function payEntry(db: Db, p: { organizationId: string; entryId: string; bankAccountId: string; actorId: string }) {
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "CommissionEntry" WHERE id = ${p.entryId} FOR UPDATE`;
    const e = await tx.commissionEntry.findFirst({ where: { id: p.entryId, organizationId: p.organizationId } });
    if (!e) throw new CommissionError("Entry not found.");
    if (e.status !== "APPROVED") throw new CommissionError(`This entry is ${e.status.toLowerCase()} and cannot be paid.`);
    const bank = await tx.bankAccount.findFirst({ where: { id: p.bankAccountId, organizationId: p.organizationId, active: true } });
    if (!bank?.ledgerAccountId) throw new CommissionError("Choose an active bank account linked to the ledger.");
    if (bank.currency !== e.currency) throw new CommissionError(`This entry is in ${e.currency}; pay it from a ${e.currency} account.`);
    const payable = await account(tx, p.organizationId, "PAYROLL_PAYABLE");
    try {
      const j = await postJournal(tx, {
        organizationId: p.organizationId, date: new Date(), memo: `${e.kind === "BONUS" ? "Bonus" : "Commission"} paid`, currency: e.currency, sourceType: "COMMISSION_PAYMENT", sourceId: e.id,
        idempotencyKey: `commission-payment:${e.id}`, postedById: p.actorId,
        lines: [{ accountId: payable.id, debit: e.amount }, { accountId: bank.ledgerAccountId, credit: e.amount }],
      });
      await tx.commissionEntry.update({ where: { id: e.id }, data: { status: "PAID", paidById: p.actorId, paidAt: new Date(), paymentEntryId: j.id } });
      return j;
    } catch (err) {
      if (err instanceof LedgerError) throw new CommissionError(err.message);
      throw err;
    }
  });
}

export async function statementFor(db: Db, organizationId: string, userId: string) {
  const entries = await db.commissionEntry.findMany({ where: { organizationId, userId, status: { not: "VOID" } }, orderBy: { createdAt: "desc" }, take: 200 });
  const totals = new Map<string, { earned: ReturnType<typeof dec>; approved: ReturnType<typeof dec>; paid: ReturnType<typeof dec> }>();
  for (const e of entries) {
    const t = totals.get(e.currency) ?? { earned: dec(0), approved: dec(0), paid: dec(0) };
    if (e.status === "EARNED") t.earned = t.earned.add(e.amount.toString());
    else if (e.status === "APPROVED") t.approved = t.approved.add(e.amount.toString());
    else if (e.status === "PAID") t.paid = t.paid.add(e.amount.toString());
    totals.set(e.currency, t);
  }
  return { entries, totals };
}
