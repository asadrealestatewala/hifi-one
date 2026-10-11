// Financial statements built from the same journal lines as the ledger, so every figure
// reconciles. Pure builders (no database) take account balance rows; the loaders run the SQL.
// Amounts are kept per currency here; the consolidated reports convert them first (see fx.ts).
import type { PrismaClient } from "@prisma/client";
import { dec, round2 } from "./ledger-math";

export type BalanceRow = { code: string; name: string; type: string; currency: string; debit: string; credit: string };

type D = ReturnType<typeof dec>;
export type Line = { code: string; name: string; amount: D };

const net = (r: BalanceRow, side: "debit" | "credit"): D => (side === "debit" ? dec(r.debit).sub(r.credit) : dec(r.credit).sub(r.debit));
const lines = (rows: BalanceRow[], types: string[], side: "debit" | "credit"): Line[] =>
  rows.filter((r) => types.includes(r.type)).map((r) => ({ code: r.code, name: r.name, amount: round2(net(r, side)) })).filter((l) => !l.amount.isZero());
const total = (ls: Line[]) => ls.reduce((a, l) => a.add(l.amount), dec(0));

export function buildIncomeStatement(rows: BalanceRow[]) {
  const revenue = lines(rows, ["REVENUE"], "credit");
  const direct = lines(rows, ["DIRECT_COST"], "debit");
  const opex = lines(rows, ["OPEX"], "debit");
  const otherIncome = lines(rows, ["OTHER_INCOME"], "credit");
  const otherExpense = lines(rows, ["OTHER_EXPENSE"], "debit");
  const grossProfit = total(revenue).sub(total(direct));
  const operatingProfit = grossProfit.sub(total(opex));
  const netProfit = operatingProfit.add(total(otherIncome)).sub(total(otherExpense));
  return { revenue, direct, opex, otherIncome, otherExpense, totals: { revenue: total(revenue), direct: total(direct), grossProfit, opex: total(opex), operatingProfit, netProfit } };
}

// Assets = Liabilities + Equity + earnings to date. Earnings are shown on their own line because
// the books are not closed at year end yet, so profit still sits in the revenue and expense accounts.
export function buildBalanceSheet(rows: BalanceRow[]) {
  const assets = lines(rows, ["ASSET"], "debit");
  const liabilities = lines(rows, ["LIABILITY"], "credit");
  const equity = lines(rows, ["EQUITY"], "credit");
  const earnings = buildIncomeStatement(rows).totals.netProfit;
  const totalAssets = total(assets);
  const totalLE = total(liabilities).add(total(equity)).add(earnings);
  return { assets, liabilities, equity, earnings, totals: { assets: totalAssets, liabilities: total(liabilities), equity: total(equity), liabilitiesAndEquity: totalLE }, balanced: totalAssets.eq(totalLE) };
}

export function groupByCurrency(rows: BalanceRow[]): Map<string, BalanceRow[]> {
  const m = new Map<string, BalanceRow[]>();
  for (const r of rows) m.set(r.currency, [...(m.get(r.currency) ?? []), r]);
  return m;
}

// JournalEntry.date is stored as a timestamp without time zone (UTC wall clock). Bounds are passed as plain
// text and cast to timestamp so the database server's own time zone can never shift a period boundary.
const startOf = (d: string) => `${d} 00:00:00`;
const endOf = (d: string) => `${d} 23:59:59.999`;

// Balances of every account in the period [from, to] (either bound optional).
export async function loadBalances(db: PrismaClient, organizationId: string, p: { from?: string; to?: string }): Promise<BalanceRow[]> {
  const from = p.from ? startOf(p.from) : "1970-01-01 00:00:00";
  const to = p.to ? endOf(p.to) : "2999-12-31 23:59:59";
  // Year-end closing entries move profit into retained earnings. They belong in balances (the balance sheet) but must not
  // wipe out a period's profit and loss, so they are left out whenever a start date is given.
  const withClosing = !p.from;
  return db.$queryRaw<BalanceRow[]>`
    SELECT a.code, a.name, a.type, e.currency,
           COALESCE(SUM(l.debit), 0)::text AS debit, COALESCE(SUM(l.credit), 0)::text AS credit
    FROM "JournalLine" l
    JOIN "JournalEntry" e ON e.id = l."entryId"
    JOIN "Account" a ON a.id = l."accountId"
    WHERE e."organizationId" = ${organizationId} AND e.date >= ${from}::timestamp AND e.date <= ${to}::timestamp
      AND (${withClosing}::boolean OR COALESCE(e."sourceType", '') <> 'YEAR_END_CLOSE')
    GROUP BY a.code, a.name, a.type, e.currency
    ORDER BY e.currency, a.code`;
}

// Movement of every bank/cash ledger account in the period, with opening and closing balances.
export async function loadCashMovement(db: PrismaClient, organizationId: string, p: { from: string; to: string }) {
  const banks = await db.bankAccount.findMany({ where: { organizationId, ledgerAccountId: { not: null } }, select: { id: true, internalName: true, currency: true, ledgerAccountId: true } });
  const out = [];
  for (const b of banks) {
    const rows = await db.$queryRaw<{ before: string; inflow: string; outflow: string }[]>`
      SELECT COALESCE(SUM(CASE WHEN e.date < ${startOf(p.from)}::timestamp THEN l.debit - l.credit ELSE 0 END), 0)::text AS before,
             COALESCE(SUM(CASE WHEN e.date >= ${startOf(p.from)}::timestamp AND e.date <= ${endOf(p.to)}::timestamp THEN l.debit ELSE 0 END), 0)::text AS inflow,
             COALESCE(SUM(CASE WHEN e.date >= ${startOf(p.from)}::timestamp AND e.date <= ${endOf(p.to)}::timestamp THEN l.credit ELSE 0 END), 0)::text AS outflow
      FROM "JournalLine" l JOIN "JournalEntry" e ON e.id = l."entryId"
      WHERE l."accountId" = ${b.ledgerAccountId} AND e."organizationId" = ${organizationId}`;
    const r = rows[0];
    out.push({ name: b.internalName, currency: b.currency, opening: dec(r.before), inflow: dec(r.inflow), outflow: dec(r.outflow), closing: dec(r.before).add(r.inflow).sub(r.outflow) });
  }
  return out;
}

export const AGING_BUCKETS = ["Not yet due", "1-30 days", "31-60 days", "61-90 days", "Over 90 days"] as const;

export function agingBucket(dueDate: Date | null, asOf: Date): (typeof AGING_BUCKETS)[number] {
  if (!dueDate) return "Not yet due";
  const days = Math.floor((asOf.getTime() - dueDate.getTime()) / 86400000);
  if (days <= 0) return "Not yet due";
  if (days <= 30) return "1-30 days";
  if (days <= 60) return "31-60 days";
  if (days <= 90) return "61-90 days";
  return "Over 90 days";
}

// Outstanding customer invoices by age, per currency. The grand total reconciles to the AR control account.
export async function loadReceivablesAging(db: PrismaClient, organizationId: string, asOf = new Date()) {
  const invoices = await db.invoice.findMany({
    where: { organizationId, status: { in: ["ISSUED", "PARTIALLY_PAID"] } }, include: { client: { select: { name: true } } }, orderBy: { dueDate: "asc" },
  });
  const byCurrency = new Map<string, Map<string, D>>();
  const detail = invoices.map((i) => {
    const outstanding = round2(i.total.sub(i.amountPaid).sub(i.creditedAmount));
    const bucket = agingBucket(i.dueDate, asOf);
    const m = byCurrency.get(i.currency) ?? new Map<string, D>();
    m.set(bucket, (m.get(bucket) ?? dec(0)).add(outstanding));
    byCurrency.set(i.currency, m);
    return { id: i.id, number: i.number, client: i.client.name, currency: i.currency, dueDate: i.dueDate, outstanding, bucket };
  });
  return { detail, byCurrency };
}

// Unpaid vendor bills by age since they were posted, per currency. Bills carry no due date yet, so age runs from posting.
export async function loadPayablesAging(db: PrismaClient, organizationId: string, asOf = new Date()) {
  const bills = await db.vendorBill.findMany({ where: { organizationId, status: "POSTED" }, include: { vendor: { select: { name: true } } }, orderBy: { createdAt: "asc" } });
  const byCurrency = new Map<string, Map<string, D>>();
  const detail = bills.map((b) => {
    const bucket = agingBucket(b.createdAt, asOf);
    const m = byCurrency.get(b.currency) ?? new Map<string, D>();
    m.set(bucket, (m.get(bucket) ?? dec(0)).add(b.amount.toString()));
    byCurrency.set(b.currency, m);
    return { id: b.id, number: b.number, vendor: b.vendor.name, currency: b.currency, postedOn: b.createdAt, amount: round2(b.amount.toString()), bucket };
  });
  return { detail, byCurrency };
}
