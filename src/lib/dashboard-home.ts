// Numbers for the home dashboard. Money comes from the same loaders as the financial reports (ledger balances, receivables aging),
// so a figure here can never disagree with a report. Currencies are never added together.
import type { PrismaClient } from "@prisma/client";
import { buildIncomeStatement, groupByCurrency, loadBalances, loadReceivablesAging } from "./statements";

export const PERIODS = { month: "This month", last: "Last month", quarter: "This quarter", year: "This year" } as const;
export type Period = keyof typeof PERIODS;
export const isPeriod = (v: string | undefined): v is Period => !!v && v in PERIODS;

const iso = (d: Date) => d.toISOString().slice(0, 10);

// The first and last day of the chosen period, as plain dates. `today` is the company's local date.
export function periodRange(period: Period, today: string): { from: string; to: string } {
  const y = Number(today.slice(0, 4)), m = Number(today.slice(5, 7)) - 1;
  if (period === "last") return { from: iso(new Date(Date.UTC(y, m - 1, 1))), to: iso(new Date(Date.UTC(y, m, 0))) };
  if (period === "quarter") { const q = Math.floor(m / 3) * 3; return { from: iso(new Date(Date.UTC(y, q, 1))), to: iso(new Date(Date.UTC(y, q + 3, 0))) }; }
  if (period === "year") return { from: `${y}-01-01`, to: `${y}-12-31` };
  return { from: iso(new Date(Date.UTC(y, m, 1))), to: iso(new Date(Date.UTC(y, m + 1, 0))) };
}

export type MoneyByCurrency = { currency: string; amount: string }[];
const add = (m: Map<string, number>, c: string, v: number) => m.set(c, (m.get(c) ?? 0) + v);
const toList = (m: Map<string, number>): MoneyByCurrency => [...m].filter(([, v]) => v !== 0).map(([currency, v]) => ({ currency, amount: v.toFixed(2) })).sort((a, b) => Number(b.amount) - Number(a.amount));

const startOfDay = (d: string) => new Date(`${d}T00:00:00.000Z`);
const endOfDay = (d: string) => new Date(`${d}T23:59:59.999Z`);

export async function loadHero(db: PrismaClient, organizationId: string, range: { from: string; to: string }, now: Date, canFinance: boolean, leadWhere: object | null) {
  const [payments, aging, newLeads, totalLeads] = await Promise.all([
    canFinance ? db.payment.groupBy({ by: ["currency"], where: { organizationId, date: { gte: startOfDay(range.from), lte: endOfDay(range.to) } }, _sum: { amount: true } }) : [],
    canFinance ? loadReceivablesAging(db, organizationId, now) : null,
    leadWhere ? db.lead.count({ where: { ...leadWhere, createdAt: { gte: startOfDay(range.from), lte: endOfDay(range.to) } } }) : 0,
    leadWhere ? db.lead.count({ where: leadWhere }) : 0,
  ]);
  const overdue = new Map<string, number>();
  let overdueCount = 0;
  for (const d of aging?.detail ?? []) if (d.bucket !== "Not yet due") { overdueCount++; add(overdue, d.currency, Number(d.outstanding.toString())); }
  return {
    collected: toList(new Map(payments.map((p) => [p.currency, Number(p._sum.amount ?? 0)]))),
    overdue: { count: overdueCount, amounts: toList(overdue) },
    leads: { fresh: newLeads, total: totalLeads },
  };
}

// Collected (payments received) and spent (expenses in the ledger) for each of the last six months, per currency.
export async function loadFlow(db: PrismaClient, organizationId: string, today: string) {
  const y = Number(today.slice(0, 4)), m = Number(today.slice(5, 7)) - 1;
  const months = Array.from({ length: 6 }, (_, i) => { const d = new Date(Date.UTC(y, m - 5 + i, 1)); return { key: iso(d).slice(0, 7), from: iso(d), to: iso(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0))) }; });
  const payments = await db.payment.findMany({ where: { organizationId, date: { gte: startOfDay(months[0].from), lte: endOfDay(months[5].to) } }, select: { date: true, currency: true, amount: true } });
  const ledgers = await Promise.all(months.map((mo) => loadBalances(db, organizationId, { from: mo.from, to: mo.to })));
  const byCur = new Map<string, { month: string; collected: number; spent: number }[]>();
  const series = (c: string) => { if (!byCur.has(c)) byCur.set(c, months.map((mo) => ({ month: mo.key, collected: 0, spent: 0 }))); return byCur.get(c)!; };
  for (const p of payments) { const row = series(p.currency).find((r) => r.month === iso(p.date).slice(0, 7)); if (row) row.collected += Number(p.amount); }
  ledgers.forEach((rows, i) => {
    for (const [c, list] of groupByCurrency(rows)) { const t = buildIncomeStatement(list).totals; series(c)[i].spent += Number(t.direct.add(t.opex).toString()); }
  });
  return [...byCur].map(([currency, data]) => ({ currency, data })).sort((a, b) => b.data.reduce((s, r) => s + r.collected + r.spent, 0) - a.data.reduce((s, r) => s + r.collected + r.spent, 0));
}

// Profit and loss for the period per currency, from the same ledger loader and statement builder as the Financial reports page.
export async function loadProfitAndLoss(db: PrismaClient, organizationId: string, range: { from: string; to: string }) {
  const rows = await loadBalances(db, organizationId, range);
  return [...groupByCurrency(rows)].map(([currency, list]) => {
    const t = buildIncomeStatement(list).totals;
    return { currency, revenue: t.revenue.toString(), direct: t.direct.toString(), grossProfit: t.grossProfit.toString(), opex: t.opex.toString(), netProfit: t.netProfit.toString() };
  }).sort((a, b) => a.currency.localeCompare(b.currency));
}

export type Attention = Awaited<ReturnType<typeof loadAttention>>;

// What needs a person today, limited to what their role may see. Counts are exact; the lists show the first few.
export async function loadAttention(
  db: PrismaClient, organizationId: string, user: { id: string; permissions: ReadonlySet<string> }, today: string, now: Date, leadWhere: object | null,
) {
  const has = (p: string) => user.permissions.has(p);
  const dayEnd = endOfDay(today);
  const lateInv = has("finance.view") ? (await loadReceivablesAging(db, organizationId, now)).detail.filter((d) => d.bucket !== "Not yet due") : null;
  const [followCount, followRows, voucherCount, voucherRows, commissions, staff, marked, posts, leave, myOverdue] = await Promise.all([
    leadWhere ? db.lead.count({ where: { ...leadWhere, clientId: null, stage: { isWon: false, isLost: false }, nextFollowUp: { lte: dayEnd } } }) : 0,
    leadWhere ? db.lead.findMany({ where: { ...leadWhere, clientId: null, stage: { isWon: false, isLost: false }, nextFollowUp: { lte: dayEnd } }, orderBy: { nextFollowUp: "asc" }, take: 5, select: { id: true, name: true, phone: true, nextFollowUp: true } }) : [],
    has("expenses.review") || has("expenses.approve") ? db.expenseVoucher.count({ where: { organizationId, status: { in: ["SUBMITTED", "UNDER_REVIEW"] } } }) : 0,
    has("expenses.review") || has("expenses.approve") ? db.expenseVoucher.findMany({ where: { organizationId, status: { in: ["SUBMITTED", "UNDER_REVIEW"] } }, orderBy: { createdAt: "asc" }, take: 3, select: { id: true, number: true, description: true, amount: true, currency: true } }) : [],
    has("commissions.approve") || has("commissions.manage") ? db.commissionEntry.count({ where: { organizationId, status: "EARNED" } }) : 0,
    has("attendance.view_all") ? db.user.findMany({ where: { organizationId, active: true, userType: "EMPLOYEE" }, select: { id: true, name: true } }) : [],
    has("attendance.view_all") ? db.attendanceRecord.findMany({ where: { workDate: today }, select: { userId: true } }) : [],
    has("content.view") ? db.contentItem.findMany({ where: { organizationId, plannedDate: today, status: { in: ["APPROVED", "SCHEDULED"] } }, orderBy: { plannedTime: "asc" }, take: 5, select: { id: true, title: true, plannedTime: true } }) : [],
    has("leave.approve") ? db.leaveRequest.count({ where: { status: "PENDING", leaveType: { organizationId } } }) : 0,
    db.task.count({ where: { assigneeId: user.id, status: { not: "DONE" }, dueDate: { lt: startOfDay(today) }, project: { organizationId } } }),
  ]);
  const done = new Set(marked.map((m) => m.userId));
  const missing = staff.filter((s) => !done.has(s.id));
  const lateForFollow = followRows.filter((f) => f.nextFollowUp && f.nextFollowUp < startOfDay(today)).length;
  const veryLate = lateInv?.filter((d) => d.bucket === "61-90 days" || d.bucket === "Over 90 days").length ?? 0;
  const overdueAmounts = new Map<string, number>();
  for (const d of lateInv ?? []) add(overdueAmounts, d.currency, Number(d.outstanding.toString()));
  const sections = {
    followups: leadWhere ? { count: followCount, rows: followRows.map((f) => ({ id: f.id, name: f.name, phone: f.phone, due: f.nextFollowUp ? iso(f.nextFollowUp) : null })) } : null,
    overdue: lateInv ? { count: lateInv.length, amounts: toList(overdueAmounts), rows: lateInv.slice(0, 5).map((d) => ({ id: d.id, number: d.number ?? "Draft", client: d.client, currency: d.currency, outstanding: d.outstanding.toString(), due: d.dueDate ? iso(d.dueDate) : null })) } : null,
    vouchers: has("expenses.review") || has("expenses.approve") ? { count: voucherCount, rows: voucherRows.map((v) => ({ id: v.id, number: v.number, description: v.description, currency: v.currency, amount: v.amount.toString() })) } : null,
    commissions: has("commissions.approve") || has("commissions.manage") ? { count: commissions } : null,
    attendance: has("attendance.view_all") ? { count: missing.length, rows: missing.slice(0, 5).map((m) => ({ id: m.id, name: m.name })) } : null,
    posts: has("content.view") ? { count: posts.length, rows: posts.map((p) => ({ id: p.id, title: p.title, time: p.plannedTime })) } : null,
    leave: has("leave.approve") ? { count: leave } : null,
    myOverdueTasks: myOverdue,
  };
  const total = (sections.followups?.count ?? 0) + (sections.overdue?.count ?? 0) + (sections.vouchers?.count ?? 0) + (sections.commissions?.count ?? 0) + (sections.attendance?.count ?? 0) + (sections.posts?.count ?? 0) + (sections.leave?.count ?? 0) + myOverdue;
  return { ...sections, total, urgent: lateForFollow + veryLate + myOverdue };
}
