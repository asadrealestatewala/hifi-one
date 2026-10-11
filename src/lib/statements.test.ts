import { describe, expect, it } from "vitest";
import { agingBucket, buildBalanceSheet, buildIncomeStatement, groupByCurrency, type BalanceRow } from "./statements";

const row = (code: string, type: string, debit: string, credit: string, currency = "USD", name = code): BalanceRow => ({ code, name, type, currency, debit, credit });

describe("income statement", () => {
  const rows = [
    row("4000", "REVENUE", "0", "10000"),
    row("5000", "DIRECT_COST", "3000", "0"),
    row("6000", "OPEX", "2000", "0"),
    row("7000", "OTHER_INCOME", "0", "500"),
    row("8000", "OTHER_EXPENSE", "200", "0"),
    row("1100", "ASSET", "9999", "0"), // balance sheet accounts never appear in the P&L
  ];
  it("builds gross, operating and net profit", () => {
    const t = buildIncomeStatement(rows).totals;
    expect(t.revenue.toString()).toBe("10000");
    expect(t.grossProfit.toString()).toBe("7000");
    expect(t.operatingProfit.toString()).toBe("5000");
    expect(t.netProfit.toString()).toBe("5300");
  });
  it("shows a loss as a negative number", () => {
    expect(buildIncomeStatement([row("4000", "REVENUE", "0", "100"), row("6000", "OPEX", "250", "0")]).totals.netProfit.toString()).toBe("-150");
  });
  it("revenue reversals net against revenue", () => {
    expect(buildIncomeStatement([row("4000", "REVENUE", "300", "1000")]).totals.revenue.toString()).toBe("700");
  });
});

describe("balance sheet", () => {
  it("balances when earnings to date are included", () => {
    // Cash 8000 dr, revenue 10000 cr, expense 2000 dr  =>  assets 8000 = equity 0 + earnings 8000
    const rows = [row("1100", "ASSET", "8000", "0"), row("4000", "REVENUE", "0", "10000"), row("6000", "OPEX", "2000", "0")];
    const bs = buildBalanceSheet(rows);
    expect(bs.totals.assets.toString()).toBe("8000");
    expect(bs.earnings.toString()).toBe("8000");
    expect(bs.balanced).toBe(true);
  });
  it("contra-assets such as accumulated depreciation reduce assets", () => {
    const rows = [row("1500", "ASSET", "2400", "0"), row("1590", "ASSET", "0", "300"), row("3000", "EQUITY", "0", "2100")];
    const bs = buildBalanceSheet(rows);
    expect(bs.totals.assets.toString()).toBe("2100");
    expect(bs.balanced).toBe(true);
  });
  it("reports an unbalanced ledger instead of hiding it", () => {
    expect(buildBalanceSheet([row("1100", "ASSET", "100", "0")]).balanced).toBe(false);
  });
});

describe("currencies stay separate", () => {
  it("groups rows by currency without mixing them", () => {
    const g = groupByCurrency([row("1100", "ASSET", "5", "0", "USD"), row("1101", "ASSET", "7", "0", "PKR")]);
    expect([...g.keys()].sort()).toEqual(["PKR", "USD"]);
    expect(g.get("PKR")!.length).toBe(1);
  });
});

describe("agingBucket", () => {
  const asOf = new Date("2026-11-01T12:00:00Z");
  const due = (d: string) => new Date(`${d}T00:00:00Z`);
  it("puts invoices in the right age band", () => {
    expect(agingBucket(due("2026-11-10"), asOf)).toBe("Not yet due");
    expect(agingBucket(due("2026-10-15"), asOf)).toBe("1-30 days");
    expect(agingBucket(due("2026-09-20"), asOf)).toBe("31-60 days");
    expect(agingBucket(due("2026-08-20"), asOf)).toBe("61-90 days");
    expect(agingBucket(due("2026-05-01"), asOf)).toBe("Over 90 days");
    expect(agingBucket(null, asOf)).toBe("Not yet due");
  });
});
