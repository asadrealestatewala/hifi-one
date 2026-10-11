// Expense and budget integration tests against hifi_one_test.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import {
  ExpenseError, approveVoucher, budgetStatus, cancelVoucher, createBudget, decideTransfer, payVoucher, postVoucher, rejectVoucher, requestTransfer,
  reviewVoucher, submitVoucher,
} from "./expenses";
import { trialBalance } from "./accounting";

const url = process.env.TEST_DATABASE_URL ?? "postgresql://hifi:hifi_local_dev@localhost:54329/hifi_one_test";
const db = new PrismaClient({ datasourceUrl: url });

let org: string;
let opex: string;
let asset: string;
let bank: string;
let bankUsd: string;
let budgetA: string;
let budgetB: string;
const emp = "emp-1";
const rev = "reviewer-1";
const appr = "approver-1";

const submit = (amount: string, budgetId?: string) =>
  submitVoucher(db, { organizationId: org, submittedById: emp, date: "2026-10-12", payee: "Cloud Co", description: "Hosting", expenseAccountId: opex, budgetId, currency: "PKR", amount });
const toApproved = async (amount: string, budgetId?: string, canOverride = false, overrideReason?: string) => {
  const v = await submit(amount, budgetId);
  await reviewVoucher(db, { organizationId: org, id: v.id, reviewerId: rev });
  return approveVoucher(db, { organizationId: org, id: v.id, approverId: appr, canOverride, overrideReason });
};

beforeAll(async () => {
  await db.$executeRawUnsafe(
    'TRUNCATE "BudgetTransfer","ExpenseVoucher","Budget","Project","JournalLine","JournalEntry","BankAccount","Account","NumberSequence","Organization" CASCADE',
  );
  org = (await db.organization.create({ data: { name: "Expense Test Org" } })).id;
  const mk = (code: string, name: string, type: string, systemKey?: string) => db.account.create({ data: { organizationId: org, code, name, type, systemKey } });
  opex = (await mk("6010", "Hosting", "OPEX")).id;
  asset = (await mk("1200", "A receivable", "ASSET", "AR")).id;
  await mk("2000", "Accounts payable", "LIABILITY", "ACCOUNTS_PAYABLE");
  const cash = await mk("1100", "Bank PKR", "ASSET");
  const cashUsd = await mk("1101", "Bank USD", "ASSET");
  const mkBank = (n: string, cur: string, led: string) =>
    db.bankAccount.create({ data: { organizationId: org, internalName: n, bankName: "B", accountHolder: "H", accountNumber: "1234", currency: cur, ledgerAccountId: led } });
  bank = (await mkBank("PKR", "PKR", cash.id)).id;
  bankUsd = (await mkBank("USD", "USD", cashUsd.id)).id;
  budgetA = (await createBudget(db, { organizationId: org, name: "Marketing", scope: "COMPANY", periodStart: "2026-10-01", periodEnd: "2026-12-31", currency: "PKR", amount: "1000", createdById: rev })).id;
  budgetB = (await createBudget(db, { organizationId: org, name: "Software", scope: "COMPANY", periodStart: "2026-10-01", periodEnd: "2026-12-31", currency: "PKR", amount: "500", createdById: rev })).id;
});
afterAll(async () => {
  await db.$disconnect();
});

describe("voucher workflow", () => {
  it("validates input and only allows expense accounts", async () => {
    await expect(submit("0")).rejects.toThrow(/positive/);
    await expect(
      submitVoucher(db, { organizationId: org, submittedById: emp, date: "2026-10-12", payee: "X Co", description: "Thing", expenseAccountId: asset, currency: "PKR", amount: "10" }),
    ).rejects.toThrow(/expense account/);
    await expect(
      submitVoucher(db, { organizationId: org, submittedById: emp, date: "2026-10-12", payee: "X Co", description: "Thing", expenseAccountId: opex, budgetId: budgetA, currency: "USD", amount: "10" }),
    ).rejects.toThrow(/budget is in PKR/);
  });

  it("enforces review before approval and separation of duties", async () => {
    const v = await submit("100");
    await expect(approveVoucher(db, { organizationId: org, id: v.id, approverId: appr, canOverride: false })).rejects.toThrow(/Review/);
    await expect(reviewVoucher(db, { organizationId: org, id: v.id, reviewerId: emp })).rejects.toThrow(/own voucher/);
    await reviewVoucher(db, { organizationId: org, id: v.id, reviewerId: rev });
    await expect(approveVoucher(db, { organizationId: org, id: v.id, approverId: emp, canOverride: false })).rejects.toThrow(/own voucher/);
    const ok = await approveVoucher(db, { organizationId: org, id: v.id, approverId: appr, canOverride: false });
    expect(ok.status).toBe("APPROVED");
  });

  it("an unpaid posted voucher records expense and payable but does not touch cash", async () => {
    const v = await toApproved("250");
    await postVoucher(db, { organizationId: org, id: v.id, actorId: appr });
    const tb = await trialBalance(db, org);
    expect(Number(tb.find((r) => r.code === "6010")!.debit)).toBeGreaterThanOrEqual(250);
    expect(tb.find((r) => r.code === "1100")).toBeUndefined(); // no cash movement yet
    const paid = await Promise.all([1, 2].map(() => payVoucher(db, { organizationId: org, id: v.id, bankAccountId: bank, actorId: appr })));
    expect(paid.every((p) => p.status === "PAID")).toBe(true);
    expect(await db.journalEntry.count({ where: { sourceType: "EXPENSE_PAYMENT", sourceId: v.id } })).toBe(1);
    const after = await trialBalance(db, org);
    expect(Number(after.find((r) => r.code === "1100")!.credit)).toBe(250);
  });

  it("posting twice creates one entry; payment needs a bank in the voucher currency", async () => {
    const v = await toApproved("40");
    await Promise.all([1, 2, 3].map(() => postVoucher(db, { organizationId: org, id: v.id, actorId: appr })));
    expect(await db.journalEntry.count({ where: { sourceType: "EXPENSE", sourceId: v.id } })).toBe(1);
    await expect(payVoucher(db, { organizationId: org, id: v.id, bankAccountId: bankUsd, actorId: appr })).rejects.toThrow(/PKR/);
  });

  it("rejection needs a reason; only the submitter can cancel, and only before review", async () => {
    const v = await submit("15");
    await expect(rejectVoucher(db, { organizationId: org, id: v.id, actorId: appr, note: " " })).rejects.toThrow(/reason/);
    await expect(cancelVoucher(db, { organizationId: org, id: v.id, userId: rev })).rejects.toThrow(/submitter/);
    expect((await cancelVoucher(db, { organizationId: org, id: v.id, userId: emp })).status).toBe("CANCELLED");
    const w = await submit("15");
    await reviewVoucher(db, { organizationId: org, id: w.id, reviewerId: rev });
    await expect(cancelVoucher(db, { organizationId: org, id: w.id, userId: emp })).rejects.toThrow(/not been reviewed/);
    expect((await rejectVoucher(db, { organizationId: org, id: w.id, actorId: appr, note: "Not allowed" })).status).toBe("REJECTED");
  });
});

describe("budget control", () => {
  it("committed and incurred spend are tracked separately and block overspending", async () => {
    await toApproved("600", budgetA); // committed
    let s = await budgetStatus(db, budgetA);
    expect(s.committed.toString()).toBe("600");
    expect(s.incurred.toString()).toBe("0");
    const big = await submit("500", budgetA);
    await reviewVoucher(db, { organizationId: org, id: big.id, reviewerId: rev });
    await expect(approveVoucher(db, { organizationId: org, id: big.id, approverId: appr, canOverride: false })).rejects.toThrow(/exceed the budget/);
    await expect(approveVoucher(db, { organizationId: org, id: big.id, approverId: appr, canOverride: true })).rejects.toThrow(/reason/);
    const ok = await approveVoucher(db, { organizationId: org, id: big.id, approverId: appr, canOverride: true, overrideReason: "Urgent client launch" });
    expect(ok.overBudgetReason).toBe("Urgent client launch");
    s = await budgetStatus(db, budgetA);
    expect(s.over).toBe(true);
  });

  it("concurrent approvals cannot jointly overspend a budget", async () => {
    const [x, y] = await Promise.all([submit("300", budgetB), submit("300", budgetB)]);
    for (const v of [x, y]) await reviewVoucher(db, { organizationId: org, id: v.id, reviewerId: rev });
    const results = await Promise.allSettled(
      [x, y].map((v) => approveVoucher(db, { organizationId: org, id: v.id, approverId: appr, canOverride: false })),
    );
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1); // 300 + 300 > 500
    expect((await budgetStatus(db, budgetB)).committed.toString()).toBe("300");
  });

  it("transfers need a second approver, only move unspent money, and keep the original amount", async () => {
    await expect(
      requestTransfer(db, { organizationId: org, fromBudgetId: budgetB, toBudgetId: budgetA, amount: "500", reason: "Rebalance", requestedById: rev }),
    ).rejects.toThrow(/unspent/);
    const t = await requestTransfer(db, { organizationId: org, fromBudgetId: budgetB, toBudgetId: budgetA, amount: "150", reason: "Rebalance", requestedById: rev });
    await expect(decideTransfer(db, { organizationId: org, id: t.id, approverId: rev, approve: true })).rejects.toThrow(/own transfer/);
    const results = await Promise.allSettled(
      [1, 2].map(() => decideTransfer(db, { organizationId: org, id: t.id, approverId: appr, approve: true })),
    );
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const a = await budgetStatus(db, budgetA);
    const b = await budgetStatus(db, budgetB);
    expect(a.effective.toString()).toBe("1150");
    expect(b.effective.toString()).toBe("350");
    expect(a.budget.originalAmount.toString()).toBe("1000"); // history preserved
    expect(b.budget.originalAmount.toString()).toBe("500");
  });

  it("uses the right error type for bad input", async () => {
    await expect(
      createBudget(db, { organizationId: org, name: "x", scope: "PROJECT", periodStart: "2026-10-01", periodEnd: "2026-12-31", currency: "PKR", amount: "10", createdById: rev }),
    ).rejects.toThrow(ExpenseError);
  });
});
