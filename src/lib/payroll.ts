// Payroll service. Runs go DRAFT -> APPROVED -> POSTED -> PAID. Approved runs are frozen (database trigger),
// posting creates one balanced journal entry, and payment is recorded separately. Free of Next.js imports.
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
    return await db.payrollRun.create({
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
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") throw new PayrollError(`A ${p.currency} payroll run for ${p.period} already exists.`);
    throw e;
  }
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
    const gross = it.basic.add(it.allowance).add(bonus).sub(it.unpaidDeduction);
    const tax = round2(gross.mul(it.taxPercent).div(100));
    return tx.payrollItem.update({ where: { id: it.id }, data: { bonus, gross, tax, net: gross.sub(tax) } });
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

// One balanced entry: expense for gross pay, liability for net pay and for tax withheld.
export async function postRun(db: PrismaClient, p: { organizationId: string; runId: string; actorId: string }) {
  return db.$transaction(async (tx) => {
    const run = await lockedRun(tx, p.organizationId, p.runId);
    if (run.status === "POSTED" || run.status === "PAID") return run; // idempotent
    if (run.status !== "APPROVED") throw new PayrollError("Approve the run before posting it.");
    const gross = run.items.reduce((a, i) => a.add(i.gross), dec(0));
    const net = run.items.reduce((a, i) => a.add(i.net), dec(0));
    const tax = run.items.reduce((a, i) => a.add(i.tax), dec(0));
    const expense = await systemAccount(tx, p.organizationId, "PAYROLL_EXPENSE");
    const payable = await systemAccount(tx, p.organizationId, "PAYROLL_PAYABLE");
    const lines: DraftLine[] = [{ accountId: expense.id, debit: gross, memo: `Payroll ${run.period}` }];
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
    return tx.payrollRun.update({ where: { id: run.id }, data: { status: "PAID", paidAt: new Date(), paymentEntryId: entry?.id ?? null } });
  });
}
