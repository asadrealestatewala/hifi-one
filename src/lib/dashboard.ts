// Executive dashboard data. Money figures come from the same loaders as the financial reports,
// so a dashboard number can never disagree with the ledger. Currencies are never added together.
import type { PrismaClient } from "@prisma/client";
import { buildIncomeStatement, groupByCurrency, loadBalances, loadReceivablesAging } from "./statements";
import { budgetStatus } from "./expenses";

export async function loadExecutiveDashboard(db: PrismaClient, organizationId: string, now = new Date()) {
  const today = now.toISOString().slice(0, 10);
  const monthStart = `${today.slice(0, 7)}-01`;
  // The whole calendar month, so month-end postings (such as depreciation) belong to the month they cover
  const monthEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)).toISOString().slice(0, 10);

  const [monthRows, allRows, aging] = await Promise.all([
    loadBalances(db, organizationId, { from: monthStart, to: monthEnd }),
    loadBalances(db, organizationId, { to: today }),
    loadReceivablesAging(db, organizationId, now),
  ]);

  const money = new Map<string, { revenue: string; netProfit: string; cash: string; receivables: string; payables: string }>();
  const cur = (c: string) => {
    if (!money.has(c)) money.set(c, { revenue: "0", netProfit: "0", cash: "0", receivables: "0", payables: "0" });
    return money.get(c)!;
  };
  for (const [c, rows] of groupByCurrency(monthRows)) {
    const s = buildIncomeStatement(rows).totals;
    cur(c).revenue = s.revenue.toString();
    cur(c).netProfit = s.netProfit.toString();
  }
  const banks = await db.bankAccount.findMany({ where: { organizationId, ledgerAccountId: { not: null } }, select: { ledgerAccountId: true, currency: true } });
  for (const b of banks) {
    const r = await db.journalLine.aggregate({ where: { accountId: b.ledgerAccountId!, entry: { organizationId, date: { lte: now } } }, _sum: { debit: true, credit: true } });
    const bal = Number(r._sum.debit ?? 0) - Number(r._sum.credit ?? 0);
    cur(b.currency).cash = String(Number(cur(b.currency).cash) + bal);
  }
  for (const [c, m] of aging.byCurrency) cur(c).receivables = String([...m.values()].reduce((a, v) => a + Number(v), 0));
  for (const r of allRows.filter((x) => x.code === "2000")) cur(r.currency).payables = String(Number(r.credit) - Number(r.debit));

  const soon = new Date(now.getTime() + 30 * 86400000).toISOString().slice(0, 10);
  const [pipeline, activeProjects, overdueTasks, employees, openSessions, expiringDocs, contractsEnding, subsDue] = await Promise.all([
    db.lead.groupBy({ by: ["currency"], where: { organizationId, stage: { isWon: false, isLost: false }, dealValue: { not: null } }, _sum: { dealValue: true }, _count: true }),
    db.project.count({ where: { organizationId, status: "ACTIVE" } }),
    db.task.count({ where: { project: { organizationId }, status: { not: "DONE" }, dueDate: { lt: now } } }),
    db.employeeProfile.count({ where: { organizationId, status: "ACTIVE" } }),
    db.attendanceRecord.count({ where: { clockOut: null, workDate: { lt: today } } }),
    db.contract.count({ where: { organizationId, status: "ACTIVE", endDate: { not: null, lte: soon, gte: today } } }),
    db.subscription.count({ where: { organizationId, status: "ACTIVE", nextBillingDate: { lte: today } } }),
    db.storedFile.count({ where: { organizationId, ownerType: "EMPLOYEE", deletedAt: null, expiresOn: { not: null, lte: soon } } }),
  ]);

  const [vouchers, payrollRuns, bills, leave, transfers] = await Promise.all([
    db.expenseVoucher.count({ where: { organizationId, status: { in: ["SUBMITTED", "UNDER_REVIEW", "APPROVED", "POSTED"] } } }),
    db.payrollRun.count({ where: { organizationId, status: { in: ["DRAFT", "APPROVED", "POSTED"] } } }),
    db.vendorBill.count({ where: { organizationId, status: { in: ["SUBMITTED", "APPROVED", "POSTED"] } } }),
    db.leaveRequest.count({ where: { status: "PENDING", leaveType: { organizationId } } }),
    db.budgetTransfer.count({ where: { status: "PENDING", from: { organizationId } } }),
  ]);

  const budgets = await db.budget.findMany({ where: { organizationId } });
  const budgetAlerts = [];
  for (const b of budgets) {
    const s = await budgetStatus(db, b.id);
    if (s.level >= 90) budgetAlerts.push({ id: b.id, name: b.name, pct: s.pct, over: s.over });
  }

  return {
    money: [...money].map(([currency, v]) => ({ currency, ...v })).sort((a, b) => a.currency.localeCompare(b.currency)),
    pipeline: pipeline.map((p) => ({ currency: p.currency, value: p._sum.dealValue?.toString() ?? "0", count: p._count })),
    activeProjects, overdueTasks, employees, openSessions, expiringDocs, contractsEnding, subsDue,
    attention: { vouchers, payrollRuns, bills, leave, transfers },
    budgetAlerts,
    overdueInvoices: aging.detail.filter((d) => d.bucket !== "Not yet due").length,
  };
}
