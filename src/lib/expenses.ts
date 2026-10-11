// Expense vouchers and budgets. Voucher flow: SUBMITTED -> UNDER_REVIEW -> APPROVED -> POSTED -> PAID.
// Posting records the expense and a payable; only payment moves cash, so an unpaid voucher never
// reduces a bank balance. Free of Next.js imports so it can be tested against the database.
import type { Prisma, PrismaClient } from "@prisma/client";
import { LedgerError, dec, type DraftLine } from "./ledger-math";
import { postJournal } from "./accounting";
import { canTransfer, effectiveBudget, utilization, wouldExceed } from "./budget-rules";

export class ExpenseError extends Error {}
type Tx = Prisma.TransactionClient;
const MONEY = /^\d{1,12}(\.\d{1,2})?$/;
// Only real expense accounts. Asset purchases (capitalisation) will have their own workflow in the assets module.
const EXPENSE_TYPES = ["OPEX", "DIRECT_COST", "OTHER_EXPENSE"];

async function nextVoucherNo(tx: Tx, organizationId: string) {
  const seq = await tx.numberSequence.upsert({
    where: { organizationId_key: { organizationId, key: "VCH" } },
    create: { organizationId, key: "VCH", next: 2 },
    update: { next: { increment: 1 } },
  });
  return `VCH-${String(seq.next - 1).padStart(6, "0")}`;
}

export async function budgetStatus(db: Pick<PrismaClient, "budget" | "expenseVoucher" | "budgetTransfer">, budgetId: string) {
  const b = await db.budget.findUniqueOrThrow({ where: { id: budgetId } });
  const [inn, out, committed, incurred] = await Promise.all([
    db.budgetTransfer.findMany({ where: { toBudgetId: budgetId, status: "APPROVED" }, select: { amount: true } }),
    db.budgetTransfer.findMany({ where: { fromBudgetId: budgetId, status: "APPROVED" }, select: { amount: true } }),
    db.expenseVoucher.aggregate({ where: { budgetId, status: "APPROVED" }, _sum: { amount: true } }),
    db.expenseVoucher.aggregate({ where: { budgetId, status: { in: ["POSTED", "PAID"] } }, _sum: { amount: true } }),
  ]);
  const effective = effectiveBudget(b.originalAmount, inn.map((t) => t.amount), out.map((t) => t.amount));
  const c = committed._sum.amount ?? dec(0);
  const i = incurred._sum.amount ?? dec(0);
  return { budget: b, effective, committed: c, incurred: i, ...utilization(effective, c, i) };
}

export async function createBudget(
  db: PrismaClient,
  p: { organizationId: string; name: string; scope: string; projectId?: string | null; periodStart: string; periodEnd: string; currency: string; amount: string; createdById: string },
) {
  if (!MONEY.test(p.amount) || Number(p.amount) <= 0) throw new ExpenseError("Enter a positive budget amount.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(p.periodStart) || !/^\d{4}-\d{2}-\d{2}$/.test(p.periodEnd) || p.periodEnd < p.periodStart) throw new ExpenseError("Enter a valid period.");
  if (!["COMPANY", "DEPARTMENT", "PROJECT"].includes(p.scope)) throw new ExpenseError("Unknown budget scope.");
  if (p.scope === "PROJECT") {
    if (!p.projectId || !(await db.project.findFirst({ where: { id: p.projectId, organizationId: p.organizationId } }))) throw new ExpenseError("Choose a project.");
  }
  return db.budget.create({
    data: {
      organizationId: p.organizationId, name: p.name.trim(), scope: p.scope, projectId: p.scope === "PROJECT" ? p.projectId : null,
      periodStart: p.periodStart, periodEnd: p.periodEnd, currency: p.currency, originalAmount: p.amount, createdById: p.createdById,
    },
  });
}

export async function submitVoucher(
  db: PrismaClient,
  p: {
    organizationId: string; submittedById: string; date: string; payee: string; description: string; justification?: string;
    expenseAccountId: string; projectId?: string | null; budgetId?: string | null; currency: string; amount: string;
  },
) {
  if (!MONEY.test(p.amount) || Number(p.amount) <= 0) throw new ExpenseError("Enter a positive amount.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(p.date)) throw new ExpenseError("Enter a valid date.");
  if (p.payee.trim().length < 2 || p.description.trim().length < 3) throw new ExpenseError("Enter a payee and a description.");
  const acct = await db.account.findFirst({ where: { id: p.expenseAccountId, organizationId: p.organizationId, active: true } });
  if (!acct || !EXPENSE_TYPES.includes(acct.type)) throw new ExpenseError("Choose an expense account.");
  if (p.budgetId) {
    const b = await db.budget.findFirst({ where: { id: p.budgetId, organizationId: p.organizationId } });
    if (!b) throw new ExpenseError("Unknown budget.");
    if (b.currency !== p.currency) throw new ExpenseError(`This budget is in ${b.currency}, the voucher is in ${p.currency}.`);
  }
  if (p.projectId && !(await db.project.findFirst({ where: { id: p.projectId, organizationId: p.organizationId } }))) throw new ExpenseError("Unknown project.");
  return db.$transaction(async (tx) => {
    const number = await nextVoucherNo(tx, p.organizationId);
    return tx.expenseVoucher.create({
      data: {
        organizationId: p.organizationId, number, date: p.date, payee: p.payee.trim(), description: p.description.trim(),
        justification: p.justification?.trim() || null, expenseAccountId: acct.id, projectId: p.projectId || null, budgetId: p.budgetId || null,
        currency: p.currency, amount: p.amount, submittedById: p.submittedById,
      },
    });
  });
}

async function lockVoucher(tx: Tx, organizationId: string, id: string) {
  await tx.$queryRaw`SELECT id FROM "ExpenseVoucher" WHERE id = ${id} FOR UPDATE`;
  const v = await tx.expenseVoucher.findFirst({ where: { id, organizationId } });
  if (!v) throw new ExpenseError("Voucher not found.");
  return v;
}

export async function reviewVoucher(db: PrismaClient, p: { organizationId: string; id: string; reviewerId: string }) {
  return db.$transaction(async (tx) => {
    const v = await lockVoucher(tx, p.organizationId, p.id);
    if (v.status !== "SUBMITTED") throw new ExpenseError("Only a submitted voucher can be taken into review.");
    if (v.submittedById === p.reviewerId) throw new ExpenseError("You cannot review your own voucher.");
    return tx.expenseVoucher.update({ where: { id: v.id }, data: { status: "UNDER_REVIEW", reviewedById: p.reviewerId } });
  });
}

export async function approveVoucher(
  db: PrismaClient,
  p: { organizationId: string; id: string; approverId: string; canOverride: boolean; overrideReason?: string },
) {
  return db.$transaction(async (tx) => {
    const v = await lockVoucher(tx, p.organizationId, p.id);
    if (v.status !== "UNDER_REVIEW") throw new ExpenseError("Review the voucher before approving it.");
    if (v.submittedById === p.approverId) throw new ExpenseError("You cannot approve your own voucher.");
    let overBudgetReason: string | null = null;
    if (v.budgetId) {
      await tx.$queryRaw`SELECT id FROM "Budget" WHERE id = ${v.budgetId} FOR UPDATE`; // serialise approvals against one budget
      const s = await budgetStatus(tx, v.budgetId);
      if (wouldExceed(s.effective, s.committed, s.incurred, v.amount)) {
        if (!p.canOverride) throw new ExpenseError("This would exceed the budget. A budget override approval is required.");
        if (!p.overrideReason?.trim()) throw new ExpenseError("Give a reason to approve over budget.");
        overBudgetReason = p.overrideReason.trim();
      }
    }
    return tx.expenseVoucher.update({ where: { id: v.id }, data: { status: "APPROVED", approvedById: p.approverId, overBudgetReason } });
  });
}

export async function rejectVoucher(db: PrismaClient, p: { organizationId: string; id: string; actorId: string; note: string }) {
  if (!p.note.trim()) throw new ExpenseError("A reason is required to reject a voucher.");
  return db.$transaction(async (tx) => {
    const v = await lockVoucher(tx, p.organizationId, p.id);
    if (!["SUBMITTED", "UNDER_REVIEW", "APPROVED"].includes(v.status)) throw new ExpenseError("This voucher can no longer be rejected.");
    return tx.expenseVoucher.update({ where: { id: v.id }, data: { status: "REJECTED", decisionNote: p.note.trim() } });
  });
}

export async function cancelVoucher(db: PrismaClient, p: { organizationId: string; id: string; userId: string }) {
  return db.$transaction(async (tx) => {
    const v = await lockVoucher(tx, p.organizationId, p.id);
    if (v.submittedById !== p.userId) throw new ExpenseError("Only the submitter can cancel a voucher.");
    if (v.status !== "SUBMITTED") throw new ExpenseError("Only a voucher that has not been reviewed can be cancelled.");
    return tx.expenseVoucher.update({ where: { id: v.id }, data: { status: "CANCELLED" } });
  });
}

async function systemAccount(tx: Tx, organizationId: string, systemKey: string) {
  const a = await tx.account.findFirst({ where: { organizationId, systemKey, active: true } });
  if (!a) throw new LedgerError(`Chart of accounts is missing the ${systemKey} account.`);
  return a;
}

// Recognises the expense and the payable. Cash is untouched until the voucher is paid.
export async function postVoucher(db: PrismaClient, p: { organizationId: string; id: string; actorId: string }) {
  return db.$transaction(async (tx) => {
    const v = await lockVoucher(tx, p.organizationId, p.id);
    if (v.status === "POSTED" || v.status === "PAID") return v; // idempotent
    if (v.status !== "APPROVED") throw new ExpenseError("Approve the voucher before posting it.");
    const ap = await systemAccount(tx, p.organizationId, "ACCOUNTS_PAYABLE");
    const lines: DraftLine[] = [
      { accountId: v.expenseAccountId, debit: v.amount, memo: v.description },
      { accountId: ap.id, credit: v.amount, memo: `${v.number} ${v.payee}` },
    ];
    const entry = await postJournal(tx, {
      organizationId: p.organizationId, date: new Date(`${v.date}T00:00:00Z`), memo: `Expense ${v.number}: ${v.payee}`, currency: v.currency,
      sourceType: "EXPENSE", sourceId: v.id, idempotencyKey: `voucher-post:${v.id}`, postedById: p.actorId, lines,
    });
    return tx.expenseVoucher.update({ where: { id: v.id }, data: { status: "POSTED", journalEntryId: entry.id } });
  });
}

export async function payVoucher(db: PrismaClient, p: { organizationId: string; id: string; bankAccountId: string; actorId: string }) {
  return db.$transaction(async (tx) => {
    const v = await lockVoucher(tx, p.organizationId, p.id);
    if (v.status === "PAID") return v;
    if (v.status !== "POSTED") throw new ExpenseError("Post the voucher before paying it.");
    const bank = await tx.bankAccount.findFirst({ where: { id: p.bankAccountId, organizationId: p.organizationId, active: true } });
    if (!bank?.ledgerAccountId) throw new ExpenseError("Choose an active bank account linked to the ledger.");
    if (bank.currency !== v.currency) throw new ExpenseError(`This voucher is in ${v.currency}; choose a ${v.currency} bank account.`);
    const ap = await systemAccount(tx, p.organizationId, "ACCOUNTS_PAYABLE");
    const entry = await postJournal(tx, {
      organizationId: p.organizationId, date: new Date(), memo: `Payment of ${v.number} to ${v.payee}`, currency: v.currency,
      sourceType: "EXPENSE_PAYMENT", sourceId: v.id, idempotencyKey: `voucher-pay:${v.id}`, postedById: p.actorId,
      lines: [{ accountId: ap.id, debit: v.amount }, { accountId: bank.ledgerAccountId, credit: v.amount }],
    });
    return tx.expenseVoucher.update({ where: { id: v.id }, data: { status: "PAID", paymentEntryId: entry.id, paidById: p.actorId } });
  });
}

// ----- Budget transfers (need a second person's approval) -----

export async function requestTransfer(
  db: PrismaClient,
  p: { organizationId: string; fromBudgetId: string; toBudgetId: string; amount: string; reason: string; requestedById: string },
) {
  if (p.fromBudgetId === p.toBudgetId) throw new ExpenseError("Choose two different budgets.");
  if (!p.reason.trim()) throw new ExpenseError("A reason is required.");
  if (!MONEY.test(p.amount)) throw new ExpenseError("Enter a positive amount.");
  const [from, to] = await Promise.all([
    db.budget.findFirst({ where: { id: p.fromBudgetId, organizationId: p.organizationId } }),
    db.budget.findFirst({ where: { id: p.toBudgetId, organizationId: p.organizationId } }),
  ]);
  if (!from || !to) throw new ExpenseError("Unknown budget.");
  if (from.currency !== to.currency) throw new ExpenseError("Transfers must stay within one currency.");
  const s = await budgetStatus(db, from.id);
  if (!canTransfer(s.effective, s.committed, s.incurred, p.amount)) throw new ExpenseError("The source budget does not have that much unspent money.");
  return db.budgetTransfer.create({ data: { fromBudgetId: from.id, toBudgetId: to.id, amount: p.amount, reason: p.reason.trim(), requestedById: p.requestedById } });
}

export async function decideTransfer(db: PrismaClient, p: { organizationId: string; id: string; approverId: string; approve: boolean }) {
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "BudgetTransfer" WHERE id = ${p.id} FOR UPDATE`;
    const t = await tx.budgetTransfer.findUnique({ where: { id: p.id }, include: { from: true } });
    if (!t || t.from.organizationId !== p.organizationId) throw new ExpenseError("Transfer not found.");
    if (t.status !== "PENDING") throw new ExpenseError("This transfer was already decided.");
    if (t.requestedById === p.approverId) throw new ExpenseError("You cannot approve your own transfer request.");
    if (p.approve) {
      await tx.$queryRaw`SELECT id FROM "Budget" WHERE id = ${t.fromBudgetId} FOR UPDATE`;
      const s = await budgetStatus(tx, t.fromBudgetId);
      if (!canTransfer(s.effective, s.committed, s.incurred, t.amount)) throw new ExpenseError("The source budget no longer has that much unspent money.");
    }
    return tx.budgetTransfer.update({ where: { id: t.id }, data: { status: p.approve ? "APPROVED" : "REJECTED", decidedById: p.approverId, decidedAt: new Date() } });
  });
}
