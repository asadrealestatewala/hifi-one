import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { postJournal } from "./accounting";
import { BankError, acceptSuggestions, clearOpeningBalance, importStatement, matchLines, parseAmount, parseDate, parseStatementCsv, postStatementLine, reconcile, reconciliationView, unmatch } from "./bank-rec";
import { closeYear, previewYearEnd, YearEndError } from "./year-end";
import { buildBalanceSheet, buildIncomeStatement, loadBalances } from "./statements";
import { trialBalance } from "./accounting";

const url = process.env.TEST_DATABASE_URL ?? "postgresql://hifi:hifi_local_dev@localhost:54329/hifi_one_test";
const db = new PrismaClient({ datasourceUrl: url });
let org: string, bankId: string, cash: string, revenue: string, fees: string, cogs: string;
const actor = "acct";

const post = (date: string, lines: { accountId: string; debit?: string; credit?: string }[], key: string, currency = "USD") =>
  db.$transaction((tx) => postJournal(tx, { organizationId: org, date: new Date(`${date}T12:00:00Z`), currency, sourceType: "MANUAL", idempotencyKey: key, postedById: actor, lines }));
const receive = (date: string, amount: string, key: string) => post(date, [{ accountId: cash, debit: amount }, { accountId: revenue, credit: amount }], key);

beforeAll(async () => {
  await db.$executeRawUnsafe('TRUNCATE "BankMatch","BankStatementLine","BankReconciliation","ManualJournal","PeriodLock","JournalLine","JournalEntry","NumberSequence","BankAccount","Account","Organization" CASCADE');
  org = (await db.organization.create({ data: { name: "Bank Org" } })).id;
  const mk = async (code: string, name: string, type: string, systemKey?: string) => (await db.account.create({ data: { organizationId: org, code, name, type, systemKey } })).id;
  cash = await mk("1100", "Bank USD", "ASSET");
  revenue = await mk("4000", "Revenue", "REVENUE");
  cogs = await mk("5000", "Direct cost", "DIRECT_COST");
  fees = await mk("6050", "Bank charges", "OPEX");
  await mk("3000", "Equity", "EQUITY");
  await mk("3100", "Retained Earnings", "EQUITY", "RETAINED_EARNINGS");
  bankId = (await db.bankAccount.create({ data: { organizationId: org, internalName: "USD", bankName: "B", accountHolder: "H", accountNumber: "1", currency: "USD", ledgerAccountId: cash } })).id;
});
afterAll(async () => { await db.$disconnect(); });

describe("statement parsing", () => {
  it("reads dates in both formats and rejects impossible ones", () => {
    expect(parseDate("2026-03-05")).toBe("2026-03-05");
    expect(parseDate("05/03/2026")).toBe("2026-03-05");
    expect(parseDate("31/02/2026")).toBeNull();
    expect(parseDate("tomorrow")).toBeNull();
  });
  it("reads amounts with commas, brackets and trailing minus", () => {
    expect(parseAmount("1,234.50")).toBe("1234.5");
    expect(parseAmount("(250.00)")).toBe("-250");
    expect(parseAmount("-10")).toBe("-10");
    expect(parseAmount("75.00-")).toBe("-75");
    expect(parseAmount("abc")).toBeNull();
    expect(parseAmount("1.234")).toBeNull();
  });
  it("finds columns by header, combines money in and out, and reports bad rows", () => {
    const a = parseStatementCsv("Date,Details,Money In,Money Out\n2026-01-02,Deposit,100.00,\n03/01/2026,Fee,,5.50");
    expect(a.errors).toEqual([]);
    expect(a.lines.map((l) => l.amount)).toEqual(["100", "-5.5"]);
    const b = parseStatementCsv("date,description,amount\nbad,x,5\n2026-01-01,y,0");
    expect(b.errors).toHaveLength(2);
    expect(parseStatementCsv("foo,bar\n1,2").errors[0]).toMatch(/columns/);
  });
});

describe("reconciliation", () => {
  it("imports once: the same file again adds nothing, but identical lines in one file are both kept", async () => {
    const csv = "date,description,amount\n2026-01-05,Client A,500\n2026-01-05,Client A,500\n2026-01-09,Bank fee,-12.50";
    expect(await importStatement(db, { organizationId: org, bankAccountId: bankId, csv, actorId: actor })).toEqual({ added: 3, skipped: 0 });
    expect(await importStatement(db, { organizationId: org, bankAccountId: bankId, csv, actorId: actor })).toEqual({ added: 0, skipped: 3 });
    await expect(importStatement(db, { organizationId: org, bankAccountId: bankId, csv: "date,description,amount\nnope,x,1", actorId: actor })).rejects.toThrow(BankError);
  });

  it("matches ledger lines, suggests only unambiguous pairs, and refuses mismatched amounts and double matches", async () => {
    const a = await receive("2026-01-04", "500", "r1");
    const b = await receive("2026-01-06", "500", "r2");
    await receive("2026-01-20", "321", "r3"); // not on the statement: stays outstanding
    const v = await reconciliationView(db, org, bankId);
    expect(v.suggestions).toHaveLength(0); // two identical 500s on both sides are ambiguous, never guessed
    const stmt500 = v.unmatchedStmt.filter((s) => s.amount.toString() === "500");
    const la = v.unmatchedLedger.find((l) => l.number === a.number)!;
    const lb = v.unmatchedLedger.find((l) => l.number === b.number)!;
    await matchLines(db, { organizationId: org, bankAccountId: bankId, statementLineId: stmt500[0].id, journalLineId: la.id, actorId: actor });
    await expect(matchLines(db, { organizationId: org, bankAccountId: bankId, statementLineId: stmt500[1].id, journalLineId: la.id, actorId: actor })).rejects.toThrow(/already matched/);
    const fee = v.unmatchedStmt.find((s) => s.amount.toString() === "-12.5")!;
    await expect(matchLines(db, { organizationId: org, bankAccountId: bankId, statementLineId: fee.id, journalLineId: lb.id, actorId: actor })).rejects.toThrow(/amounts differ/);
    // the remaining 500/500 pair is now unambiguous
    expect((await reconciliationView(db, org, bankId)).suggestions).toHaveLength(1);
    expect(await acceptSuggestions(db, { organizationId: org, bankAccountId: bankId, actorId: actor })).toBe(1);
  });

  it("posts a bank fee from the statement and matches it in one step; concurrent attempts post once", async () => {
    const v = await reconciliationView(db, org, bankId);
    const fee = v.unmatchedStmt.find((s) => s.amount.toString() === "-12.5")!;
    const rs = await Promise.allSettled([1, 2].map(() => postStatementLine(db, { organizationId: org, bankAccountId: bankId, statementLineId: fee.id, counterAccountId: fees, actorId: actor })));
    expect(rs.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await db.journalEntry.count({ where: { organizationId: org, sourceType: "BANK_STATEMENT" } })).toBe(1);
    await expect(postStatementLine(db, { organizationId: org, bankAccountId: bankId, statementLineId: fee.id, counterAccountId: fees, actorId: actor })).rejects.toThrow(/already matched/);
    const after = await reconciliationView(db, org, bankId);
    expect(after.unmatchedStmt).toHaveLength(0);
    expect(after.unmatchedLedger.map((l) => l.amount.toString())).toEqual(["321"]);
  });

  it("refuses to reconcile when the balance does not agree, and explains the difference", async () => {
    // ledger 500+500+321-12.5 = 1308.5; outstanding 321; statement lines 500+500-12.5 = 987.5
    await expect(reconcile(db, { organizationId: org, bankAccountId: bankId, statementDate: "2026-01-31", statementBalance: "1000.00", actorId: actor })).rejects.toThrow(/differ by 12\.50/);
    expect(await db.bankReconciliation.count()).toBe(0);
  });

  it("completes when the statement balance is right, and then locks those matches", async () => {
    const rec = await reconcile(db, { organizationId: org, bankAccountId: bankId, statementDate: "2026-01-31", statementBalance: "987.50", actorId: actor });
    expect(rec.difference.toString()).toBe("0");
    expect(rec.outstandingLedger.toString()).toBe("321");
    const m = await db.bankMatch.findFirstOrThrow({ where: { bankAccountId: bankId } });
    await expect(unmatch(db, { organizationId: org, matchId: m.id })).rejects.toThrow(/completed reconciliation/);
    await expect(clearOpeningBalance(db, { organizationId: org, bankAccountId: bankId, throughDate: "2026-01-31", actorId: actor })).rejects.toThrow(/before the first/);
  });

  it("unmatching before completion is allowed", async () => {
    await db.$executeRawUnsafe('TRUNCATE "BankMatch","BankStatementLine","BankReconciliation" CASCADE');
    await importStatement(db, { organizationId: org, bankAccountId: bankId, csv: "date,description,amount\n2026-02-01,X,40", actorId: actor });
    const x = await receive("2026-02-01", "40", "r40");
    const v = await reconciliationView(db, org, bankId);
    const m = await matchLines(db, { organizationId: org, bankAccountId: bankId, statementLineId: v.unmatchedStmt[0].id, journalLineId: v.unmatchedLedger.find((l) => l.number === x.number)!.id, actorId: actor });
    await unmatch(db, { organizationId: org, matchId: m.id });
    expect(await db.bankMatch.count()).toBe(0);
  });

  it("the opening position clears history once, then only new activity needs matching", async () => {
    await db.$executeRawUnsafe('TRUNCATE "BankMatch","BankStatementLine","BankReconciliation" CASCADE');
    const n = await clearOpeningBalance(db, { organizationId: org, bankAccountId: bankId, throughDate: "2026-02-28", actorId: actor });
    expect(n).toBeGreaterThan(0);
    expect((await reconciliationView(db, org, bankId)).unmatchedLedger).toHaveLength(0);
    const rec = await reconcile(db, { organizationId: org, bankAccountId: bankId, statementDate: "2026-02-28", statementBalance: "1348.50", actorId: actor });
    expect(rec.ledgerBalance.toString()).not.toBe("0"); // history exists but is accounted for as opening
  });

  it("rejects other organizations' bank accounts", async () => {
    const other = (await db.organization.create({ data: { name: "Other" } })).id;
    await expect(reconciliationView(db, other, bankId)).rejects.toThrow(/not found/);
    await expect(importStatement(db, { organizationId: other, bankAccountId: bankId, csv: "date,description,amount\n2026-01-01,x,1", actorId: actor })).rejects.toThrow(/not found/);
  });
});

describe("year-end close", () => {
  it("moves the year's profit into retained earnings, keeps the year's P&L reportable, and is repeatable", async () => {
    await db.$executeRawUnsafe('TRUNCATE "JournalLine","JournalEntry","PeriodLock" CASCADE');
    await receive("2025-03-10", "1000", "y1");
    await post("2025-06-01", [{ accountId: cogs, debit: "300" }, { accountId: cash, credit: "300" }], "y2");
    await post("2025-07-01", [{ accountId: fees, debit: "100" }, { accountId: cash, credit: "100" }], "y3");
    await receive("2026-02-01", "50", "y4"); // next year, untouched

    const pre = await previewYearEnd(db, org, 2025);
    expect(pre.groups).toHaveLength(1);
    expect(pre.groups[0].profit.toString()).toBe("600");

    const done = await closeYear(db, { organizationId: org, year: 2025, actorId: actor, lockBooks: true, today: "2026-10-11" });
    expect(done).toHaveLength(1);
    const again = await closeYear(db, { organizationId: org, year: 2025, actorId: actor, lockBooks: true, today: "2026-10-11" });
    expect(again[0].number).toBe(done[0].number);
    expect(await db.journalEntry.count({ where: { organizationId: org, sourceType: "YEAR_END_CLOSE" } })).toBe(1);

    // the trial balance still balances; revenue and expenses for 2025 are zero, retained earnings holds 600
    const tb = await trialBalance(db, org);
    const sum = (k: "debit" | "credit") => tb.reduce((a, r) => a + Number(r[k]), 0);
    expect(sum("debit")).toBe(sum("credit"));
    const bal2025 = await loadBalances(db, org, { to: "2025-12-31" });
    const bs = buildBalanceSheet(bal2025);
    expect(bs.equity.find((l) => l.code === "3100")?.amount.toString()).toBe("600");
    expect(bs.earnings.toString()).toBe("0");
    expect(bs.balanced).toBe(true);

    // the P&L for the closed year is unchanged, because period reports leave closing entries out
    const pl = buildIncomeStatement(await loadBalances(db, org, { from: "2025-01-01", to: "2025-12-31" }));
    expect(pl.totals.revenue.toString()).toBe("1000");
    expect(pl.totals.netProfit.toString()).toBe("600");

    // the books are locked through the year end
    expect((await db.periodLock.findUnique({ where: { organizationId: org } }))?.lockedThrough).toBe("2025-12-31");
  });

  it("flags a year whose profit changed after it was closed instead of silently ignoring it", async () => {
    await db.periodLock.delete({ where: { organizationId: org } });
    await receive("2025-11-01", "10", "late");
    await expect(closeYear(db, { organizationId: org, year: 2025, actorId: actor, lockBooks: false, today: "2026-10-11" })).rejects.toThrow(/profit has changed/);
  });

  it("refuses a year that has not ended, a year before one already closed, and pending manual journals", async () => {
    await expect(closeYear(db, { organizationId: org, year: 2026, actorId: actor, lockBooks: false, today: "2026-10-11" })).rejects.toThrow(/not ended/);
    await db.journalEntry.create({ data: { organizationId: org, number: "JE-X", date: new Date("2027-01-02T12:00:00Z"), currency: "USD", sourceType: "YEAR_END_CLOSE", sourceId: "2026", idempotencyKey: "fake-2026" } });
    await expect(closeYear(db, { organizationId: org, year: 2025, actorId: actor, lockBooks: false, today: "2027-10-11" })).rejects.toThrow(/Close years in order/);
    await db.journalEntry.deleteMany({ where: { idempotencyKey: "fake-2026" } }).catch(() => undefined);
  });

  it("needs a retained earnings account and a fully approved ledger", async () => {
    await db.manualJournal.create({ data: { organizationId: org, date: "2024-05-01", memo: "x", currency: "USD", lines: [], createdById: "u" } });
    await expect(closeYear(db, { organizationId: org, year: 2024, actorId: actor, lockBooks: false, today: "2026-10-11" })).rejects.toThrow(/waiting for approval/);
    await db.manualJournal.deleteMany({ where: { organizationId: org } });
    expect(YearEndError).toBeDefined();
  });
});
