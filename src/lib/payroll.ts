// Payroll service. Runs go DRAFT -> APPROVED -> POSTED -> PAID. Approved runs are frozen (database trigger),
// posting creates one balanced journal entry, and payment is recorded separately. Free of Next.js imports.
// Approved commissions and bonuses (src/lib/commissions.ts) in the run currency are paid through the run: they are
// claimed by the run while it is a draft, taxed at the person's rate, and marked paid when the run is paid. They were
// already expensed when approved, so posting clears that payable instead of expensing them again.
import { Prisma, type PrismaClient } from "@prisma/client";
import { periodBounds, calculatePay } from "./payroll-rules";
import { LedgerError, round2, dec, type DraftLine } from "./ledger-math";
import { postJournal } from "./accounting";

export class PayrollError extends Error {}

export async function setSalaryStructure(
  db: PrismaClient,
  p: { userId: string; effectiveFrom: string; currency: string; basic: string; allowance: string; taxPercent: string; createdById: string },
) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(p.effectiveFrom)) throw new PayrollError("Enter a valid effective date.");
  if (!["PKR", "USD", "AED", "GBP"].includes(p.currency)) throw new PayrollError("Unsupported currency.");
  const money = /^\d{1,12}(\.\d{1,2})?$/;
  if (!money.test(p.basic) || !money.test(p.allowance)) throw new PayrollError("Enter valid amounts.");
  if (!/^\d{1,2}(\.\d{1,2})?$/.test(p.taxPercent) || Number(p.taxPercent) > 60) throw new PayrollError("Tax percent must be between 0 and 60.");
  return db.salaryStructure.upsert({
    where: { userId_effectiveFrom: { userId: p.userId, effectiveFrom: p.effectiveFrom } },
    update: { currency: p.currency, basic: p.basic, allowance: p.allowance, taxPercent: p.taxPercent, createdById: p.createdById },
    create: { userId: p.userId, effectiveFrom: p.effectiveFrom, currency: p.currency, basic: p.basic, allowance: p.allowance, taxPercent: p.taxPercent, createdById: p.createdById },
  });
}

export async function createRun(db: PrismaClient, p: { organizationId: string; period: string; currency: string; createdById: string; holidays?: string[] }) {
  const b = periodBounds(p.period);
  const profiles = await db.employeeProfile.findMany({ where: { organizationId: p.organizationId, status: "ACTIVE" }, select: { userId: true } });
  const ids = profiles.map((x) => x.userId);
  const structures = await db.salaryStructure.findMany({
    where: { userId: { in: ids }, effectiveFrom: { lte: b.end } }, orderBy: { effectiveFrom: "desc" },
  });
  const latest = new Map<string, (typeof structures)[number]>();
  for (const s of structures) if (!latest.has(s.userId)) latest.set(s.userId, s); // newest effective structure per person
  const eligible = [...latest.values()].filter((s) => s.currency === p.currency);
  if (eligible.length === 0) throw new PayrollError(`No active employees have a ${p.currency} salary structure for ${p.period}.`);
  const unpaid = await db.leaveRequest.findMany({
    where: { userId: { in: eligible.map((s) => s.userId) }, status: "APPROVED", leaveType: { paid: false }, startDate: { lte: b.end }, endDate: { gte: b.start } },
    select: { userId: true, startDate: true, endDate: true },
  });
  try {
    return await db.$transaction(async (tx) => {
      const run = await tx.payrollRun.create({
        data: {
          organizationId: p.organizationId, period: p.period, currency: p.currency, createdById: p.createdById,
          items: {
            create: eligible.map((s) => {
              const c = calculatePay({
                period: p.period, basic: s.basic.toString(), allowance: s.allowance.toString(), taxPercent: s.taxPercent.toString(),
                unpaidLeaves: unpaid.filter((u) => u.userId === s.userId), holidays: p.holidays,
              });
              return {
                userId: s.userId, workingDays: c.workingDays, unpaidDays: c.unpaidDays, basic: c.basic, allowance: c.allowance, bonus: c.bonus,
                unpaidDeduction: c.unpaidDeduction, gross: c.gross, taxPercent: s.taxPercent, tax: c.tax, net: c.net,
              };
            }),
          },
        },
        include: { items: true },
      });
      await claimCommissions(tx, run);
      return run;
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") throw new PayrollError(`A ${p.currency} payroll run for ${p.period} already exists.`);
    throw e;
  }
}

type ItemPay = { basic: Prisma.Decimal; allowance: Prisma.Decimal; bonus: Prisma.Decimal; unpaidDeduction: Prisma.Decimal; taxPercent: Prisma.Decimal };

// Salary and commission are taxed separately at the same rate, so the salary part rounds exactly as before.
function payWith(it: ItemPay, commission: Prisma.Decimal.Value) {
  const salary = it.basic.add(it.allowance).add(it.bonus).sub(it.unpaidDeduction);
  const c = round2(commission);
  const commissionTax = round2(c.mul(it.taxPercent).div(100));
  const gross = salary.add(c);
  const tax = round2(salary.mul(it.taxPercent).div(100)).add(commissionTax);
  return { commission: c, commissionTax, gross, tax, net: gross.sub(tax) };
}

// Claims each person's approved, unpaid commissions and bonuses in the run currency and recalculates every line.
// The rows are locked, so a manual payment on the commissions screen cannot pay the same entry at the same time.
async function claimCommissions(tx: Prisma.TransactionClient, run: { id: string; organizationId: string; currency: string; items: ({ id: string; userId: string } & ItemPay)[] }) {
  const userIds = run.items.map((i) => i.userId);
  const rows = userIds.length === 0 ? [] : await tx.$queryRaw<{ id: string; userId: string; amount: Prisma.Decimal }[]>`
    SELECT id, "userId", amount FROM "CommissionEntry"
    WHERE "organizationId" = ${run.organizationId} AND currency = ${run.currency} AND status = 'APPROVED' AND kind IN ('COMMISSION', 'BONUS')
      AND "payrollRunId" IS NULL AND "userId" IN (${Prisma.join(userIds)})
    FOR UPDATE`;
  if (rows.length > 0) await tx.commissionEntry.updateMany({ where: { id: { in: rows.map((r) => r.id) }, payrollRunId: null }, data: { payrollRunId: run.id } });
  const total = new Map<string, Prisma.Decimal>();
  for (const r of rows) total.set(r.userId, (total.get(r.userId) ?? dec(0)).add(r.amount));
  for (const it of run.items) await tx.payrollItem.update({ where: { id: it.id }, data: payWith(it, total.get(it.userId) ?? 0) });
  return rows.length;
}

const releaseCommissions = (tx: Prisma.TransactionClient, runId: string) =>
  tx.commissionEntry.updateMany({ where: { payrollRunId: runId, status: "APPROVED" }, data: { payrollRunId: null } });

// Picks up commissions approved since the draft was made (and drops none twice). Draft runs only.
export async function refreshRunCommissions(db: PrismaClient, p: { organizationId: string; runId: string }) {
  return db.$transaction(async (tx) => {
    const run = await lockedRun(tx, p.organizationId, p.runId);
    if (run.status !== "DRAFT") throw new PayrollError("This payroll run is locked.");
    await releaseCommissions(tx, run.id);
    return { claimed: await claimCommissions(tx, run) };
  });
}

// A draft can be thrown away (for example to make it again); its commissions go back to waiting for payment.
export async function deleteDraftRun(db: PrismaClient, p: { organizationId: string; runId: string }) {
  return db.$transaction(async (tx) => {
    const run = await lockedRun(tx, p.organizationId, p.runId);
    if (run.status !== "DRAFT") throw new PayrollError("Only a draft run can be deleted.");
    const released = await releaseCommissions(tx, run.id);
    await tx.payrollRun.delete({ where: { id: run.id } });
    return { period: run.period, currency: run.currency, released: released.count };
  });
}

export async function setBonus(db: PrismaClient, p: { organizationId: string; runId: string; userId: string; bonus: string }) {
  if (!/^\d{1,12}(\.\d{1,2})?$/.test(p.bonus)) throw new PayrollError("Enter a valid bonus amount.");
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "PayrollRun" WHERE id = ${p.runId} FOR UPDATE`;
    const run = await tx.payrollRun.findFirst({ where: { id: p.runId, organizationId: p.organizationId } });
    if (!run) throw new PayrollError("Run not found.");
    if (run.status !== "DRAFT") throw new PayrollError("This payroll run is locked.");
    const it = await tx.payrollItem.findUnique({ where: { runId_userId: { runId: p.runId, userId: p.userId } } });
    if (!it) throw new PayrollError("Employee is not in this run.");
    const bonus = round2(p.bonus);
    return tx.payrollItem.update({ where: { id: it.id }, data: { bonus, ...payWith({ ...it, bonus }, it.commission) } });
  });
}

async function lockedRun(tx: Prisma.TransactionClient, organizationId: string, runId: string) {
  await tx.$queryRaw`SELECT id FROM "PayrollRun" WHERE id = ${runId} FOR UPDATE`;
  const run = await tx.payrollRun.findFirst({ where: { id: runId, organizationId }, include: { items: true } });
  if (!run) throw new PayrollError("Run not found.");
  return run;
}

export async function approveRun(db: PrismaClient, p: { organizationId: string; runId: string; approverId: string }) {
  return db.$transaction(async (tx) => {
    const run = await lockedRun(tx, p.organizationId, p.runId);
    if (run.status !== "DRAFT") throw new PayrollError("Only a draft run can be approved.");
    if (run.items.length === 0) throw new PayrollError("The run has no employees.");
    if (run.createdById === p.approverId) throw new PayrollError("The person who prepared the run cannot approve it.");
    return tx.payrollRun.update({ where: { id: run.id }, data: { status: "APPROVED", approvedById: p.approverId, approvedAt: new Date() } });
  });
}

async function systemAccount(tx: Prisma.TransactionClient, organizationId: string, systemKey: string) {
  const a = await tx.account.findFirst({ where: { organizationId, systemKey, active: true } });
  if (!a) throw new LedgerError(`Chart of accounts is missing the ${systemKey} account.`);
  return a;
}

// One balanced entry: expense for gross pay, liability for net pay and for tax withheld. Commissions in the run were
// expensed when approved, so their part debits the payable they were accrued to instead of the expense account.
export async function postRun(db: PrismaClient, p: { organizationId: string; runId: string; actorId: string }) {
  return db.$transaction(async (tx) => {
    const run = await lockedRun(tx, p.organizationId, p.runId);
    if (run.status === "POSTED" || run.status === "PAID") return run; // idempotent
    if (run.status !== "APPROVED") throw new PayrollError("Approve the run before posting it.");
    const gross = run.items.reduce((a, i) => a.add(i.gross), dec(0));
    const net = run.items.reduce((a, i) => a.add(i.net), dec(0));
    const tax = run.items.reduce((a, i) => a.add(i.tax), dec(0));
    const commission = run.items.reduce((a, i) => a.add(i.commission), dec(0));
    const expense = await systemAccount(tx, p.organizationId, "PAYROLL_EXPENSE");
    const payable = await systemAccount(tx, p.organizationId, "PAYROLL_PAYABLE");
    const lines: DraftLine[] = [];
    if (gross.sub(commission).gt(0)) lines.push({ accountId: expense.id, debit: gross.sub(commission), memo: `Payroll ${run.period}` });
    if (commission.gt(0)) lines.push({ accountId: payable.id, debit: commission, memo: `Approved commissions and bonuses paid through payroll ${run.period}` });
    if (net.gt(0)) lines.push({ accountId: payable.id, credit: net, memo: `Net pay ${run.period}` });
    if (tax.gt(0)) lines.push({ accountId: (await systemAccount(tx, p.organizationId, "PAYROLL_TAX")).id, credit: tax, memo: `Tax withheld ${run.period}` });
    const entry = await postJournal(tx, {
      organizationId: p.organizationId, date: new Date(), memo: `Payroll ${run.period} (${run.currency})`, currency: run.currency,
      sourceType: "PAYROLL", sourceId: run.id, idempotencyKey: `payroll-post:${run.id}`, postedById: p.actorId, lines,
    });
    return tx.payrollRun.update({ where: { id: run.id }, data: { status: "POSTED", postedAt: new Date(), journalEntryId: entry.id } });
  });
}

// Actual payment of net salaries is recorded separately from posting.
export async function payRun(db: PrismaClient, p: { organizationId: string; runId: string; bankAccountId: string; actorId: string }) {
  return db.$transaction(async (tx) => {
    const run = await lockedRun(tx, p.organizationId, p.runId);
    if (run.status === "PAID") return run;
    if (run.status !== "POSTED") throw new PayrollError("Post the run before recording payment.");
    const bank = await tx.bankAccount.findFirst({ where: { id: p.bankAccountId, organizationId: p.organizationId, active: true } });
    if (!bank || !bank.ledgerAccountId) throw new PayrollError("Choose an active bank account linked to the ledger.");
    if (bank.currency !== run.currency) throw new PayrollError(`This run is in ${run.currency}; choose a ${run.currency} bank account.`);
    const net = run.items.reduce((a, i) => a.add(i.net), dec(0));
    const payable = await systemAccount(tx, p.organizationId, "PAYROLL_PAYABLE");
    const entry = net.gt(0)
      ? await postJournal(tx, {
          organizationId: p.organizationId, date: new Date(), memo: `Salaries paid ${run.period}`, currency: run.currency,
          sourceType: "PAYROLL_PAYMENT", sourceId: run.id, idempotencyKey: `payroll-pay:${run.id}`, postedById: p.actorId,
          lines: [{ accountId: payable.id, debit: net }, { accountId: bank.ledgerAccountId, credit: net }],
        })
      : null;
    const paidAt = new Date();
    await tx.commissionEntry.updateMany({
      where: { payrollRunId: run.id, status: "APPROVED" },
      data: { status: "PAID", paidAt, paidById: p.actorId, paymentEntryId: entry?.id ?? null },
    });
    return tx.payrollRun.update({ where: { id: run.id }, data: { status: "PAID", paidAt, paymentEntryId: entry?.id ?? null } });
  });
}
