// Expense and budget integration tests against hifi_one_test.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import {
  ExpenseError, approveVoucher, budgetStatus, cancelVoucher, createBudget, decideTransfer, payVoucher, postVoucher, rejectVoucher, requestTransfer,
  reviewVoucher, submitVoucher,
} from "./expenses";
import { trialBalance } from "./accounting";
import { vendorLedger } from "./vendors";
import { vendorFeed } from "./project-updates";

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
    'TRUNCATE "BudgetTransfer","ExpenseVoucher","ProjectUpdate","WorkOrder","Vendor","Budget","Project","JournalLine","JournalEntry","BankAccount","Account","NumberSequence","Organization" CASCADE',
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

describe("vendor vouchers", () => {
  const mkVendor = (code: string, status = "APPROVED") => db.vendor.create({ data: { organizationId: org, code, name: `Vendor ${code}`, currency: "PKR", status } });

  it("a voucher for a vendor shows on that vendor's statement only, and takes the vendor's name as payee", async () => {
    const saad = await mkVendor("V-S");
    const other = await mkVendor("V-O");
    const v = await submitVoucher(db, { organizationId: org, submittedById: emp, date: "2026-11-15", payee: "typed name", vendorId: saad.id, description: "Legal fee, first instalment", expenseAccountId: opex, currency: "PKR", amount: "10000" });
    expect(v.payee).toBe("Vendor V-S");
    expect(v.vendorId).toBe(saad.id);
    await reviewVoucher(db, { organizationId: org, id: v.id, reviewerId: rev });
    await approveVoucher(db, { organizationId: org, id: v.id, approverId: appr, canOverride: false });
    await postVoucher(db, { organizationId: org, id: v.id, actorId: appr });
    let rows = await vendorLedger(db, org, saad.id);
    expect(rows).toHaveLength(1);
    expect(Number(rows[0].billed)).toBe(10000);
    await payVoucher(db, { organizationId: org, id: v.id, bankAccountId: bank, actorId: appr });
    rows = await vendorLedger(db, org, saad.id);
    expect(rows).toHaveLength(2);
    expect(Number(rows[1].paid)).toBe(10000);
    expect(Number(rows[1].balance)).toBe(0);
    expect(await vendorLedger(db, org, other.id)).toHaveLength(0); // another vendor sees nothing
  });

  it("an unknown or suspended vendor cannot be used, and a voucher without a vendor needs a typed payee", async () => {
    const sus = await mkVendor("V-X", "SUSPENDED");
    const base = { organizationId: org, submittedById: emp, date: "2026-11-15", description: "Fee", expenseAccountId: opex, currency: "PKR", amount: "5" };
    await expect(submitVoucher(db, { ...base, payee: "", vendorId: "nope" })).rejects.toThrow(/Unknown vendor/);
    await expect(submitVoucher(db, { ...base, payee: "", vendorId: sus.id })).rejects.toThrow(/suspended/);
    await expect(submitVoucher(db, { ...base, payee: "" })).rejects.toThrow(/payee/);
  });

  it("a vendor sees progress only on projects tied to them, and only entries marked for vendors", async () => {
    const vendor = await mkVendor("V-P");
    const outsider = await mkVendor("V-Q");
    const proj = await db.project.create({ data: { organizationId: org, number: "PRJ-T1", name: "SMC formation", managerId: rev, phase: "DEVELOPMENT" } });
    const hidden = await db.project.create({ data: { organizationId: org, number: "PRJ-T2", name: "Unrelated", managerId: rev } });
    const mkUpdate = (projectId: string, title: string, visibleToVendor: boolean) => db.projectUpdate.create({ data: { organizationId: org, projectId, title, authorId: rev, visibleToVendor } });
    await mkUpdate(proj.id, "Name reserved", true);
    await mkUpdate(proj.id, "Internal note", false);
    await mkUpdate(hidden.id, "Other job", true);
    await submitVoucher(db, { organizationId: org, submittedById: emp, date: "2026-11-15", payee: "", vendorId: vendor.id, projectId: proj.id, description: "Fee", expenseAccountId: opex, currency: "PKR", amount: "7" });
    const feed = await vendorFeed(db, { organizationId: org, vendorId: vendor.id });
    expect(feed.map((f) => f.number)).toEqual(["PRJ-T1"]);
    expect(feed[0].updates.map((u) => u.title)).toEqual(["Name reserved"]);
    expect(await vendorFeed(db, { organizationId: org, vendorId: outsider.id })).toEqual([]);
  });
});

