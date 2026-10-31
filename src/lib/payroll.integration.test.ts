// Payroll integration tests against hifi_one_test.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { PayrollError, approveRun, createRun, deleteDraftRun, payRun, postRun, refreshRunCommissions, setBonus, setSalaryStructure } from "./payroll";
import { addBonus, approveEntry, payEntry, voidEntry } from "./commissions";
import { ROLE_DEFS } from "./permissions";
import { createEmployee } from "./hr";
import { trialBalance } from "./accounting";

const url = process.env.TEST_DATABASE_URL ?? "postgresql://hifi:hifi_local_dev@localhost:54329/hifi_one_test";
const db = new PrismaClient({ datasourceUrl: url });

let org: string;
let bank: string;
let a: string;
let b: string;
const prep = "preparer-1";
const boss = "approver-1";

beforeAll(async () => {
  await db.$executeRawUnsafe(
    'TRUNCATE "CommissionEntry","PayrollItem","PayrollRun","SalaryStructure","LeaveRequest","LeaveType","EmployeeProfile","JournalLine","JournalEntry","BankAccount","Account","NumberSequence","UserRole","User","Role","Organization" CASCADE',
  );
  org = (await db.organization.create({ data: { name: "Payroll Test Org" } })).id;
  await db.role.create({ data: { organizationId: org, key: "SALES_AGENT", name: "Sales Agent" } });
  const mk = (code: string, name: string, type: string, systemKey?: string) => db.account.create({ data: { organizationId: org, code, name, type, systemKey } });
  await mk("6020", "Salaries", "OPEX", "PAYROLL_EXPENSE");
  await mk("2500", "Payroll payable", "LIABILITY", "PAYROLL_PAYABLE");
  await mk("2510", "Payroll tax", "LIABILITY", "PAYROLL_TAX");
  const cash = await mk("1100", "Bank PKR", "ASSET");
  bank = (await db.bankAccount.create({ data: { organizationId: org, internalName: "PKR", bankName: "B", accountHolder: "H", accountNumber: "1234", currency: "PKR", ledgerAccountId: cash.id } })).id;
  a = (await createEmployee(db, { organizationId: org, name: "A", email: "a@p.example", password: "long-enough-pw-1", roleKey: "SALES_AGENT" })).id;
  b = (await createEmployee(db, { organizationId: org, name: "B", email: "b@p.example", password: "long-enough-pw-2", roleKey: "SALES_AGENT" })).id;
  await setSalaryStructure(db, { userId: a, effectiveFrom: "2026-01-01", currency: "PKR", basic: "100000", allowance: "20000", taxPercent: "5", createdById: prep });
  await setSalaryStructure(db, { userId: b, effectiveFrom: "2026-01-01", currency: "PKR", basic: "50000", allowance: "0", taxPercent: "0", createdById: prep });
});
afterAll(async () => { await db.$disconnect(); });

let runId: string;

describe("payroll run", () => {
  it("calculates each employee and refuses a duplicate run for the same period and currency", async () => {
    const run = await createRun(db, { organizationId: org, period: "2026-10", currency: "PKR", createdById: prep });
    runId = run.id;
    const items = await db.payrollItem.findMany({ where: { runId } });
    const ia = items.find((i) => i.userId === a)!;
    expect(ia.net.toString()).toBe("114000"); // 120000 gross - 5% tax
    await expect(createRun(db, { organizationId: org, period: "2026-10", currency: "PKR", createdById: prep })).rejects.toThrow(/already exists/);
    await expect(createRun(db, { organizationId: org, period: "2026-10", currency: "USD", createdById: prep })).rejects.toThrow(/No active employees/);
  });

  it("applies unpaid leave and bonus in draft only", async () => {
    const updated = await setBonus(db, { organizationId: org, runId, userId: b, bonus: "5000" });
    expect(updated.net.toString()).toBe("55000");
  });

  it("separation of duties: the preparer cannot approve; approval locks the run", async () => {
    await expect(approveRun(db, { organizationId: org, runId, approverId: prep })).rejects.toThrow(/cannot approve/);
    await approveRun(db, { organizationId: org, runId, approverId: boss });
    await expect(setBonus(db, { organizationId: org, runId, userId: b, bonus: "1" })).rejects.toThrow(/locked/);
    await expect(approveRun(db, { organizationId: org, runId, approverId: boss })).rejects.toThrow(PayrollError);
  });

  it("the database itself refuses to edit or delete lines of an approved run", async () => {
    await expect(db.payrollItem.updateMany({ where: { runId }, data: { net: 1 } })).rejects.toThrow();
    await expect(db.payrollItem.deleteMany({ where: { runId } })).rejects.toThrow();
  });

  it("posting twice (even concurrently) creates one balanced journal entry", async () => {
    const results = await Promise.all([1, 2, 3].map(() => postRun(db, { organizationId: org, runId, actorId: boss })));
    expect(results.every((r) => r.status === "POSTED")).toBe(true);
    expect(await db.journalEntry.count({ where: { sourceType: "PAYROLL", sourceId: runId } })).toBe(1);
    const tb = await trialBalance(db, org);
    const dr = tb.reduce((s, r) => s + Number(r.debit), 0);
    const cr = tb.reduce((s, r) => s + Number(r.credit), 0);
    expect(dr).toBe(cr);
    // gross 120000 + 55000 = 175000 expense; net 114000 + 55000 = 169000; tax 6000
    expect(Number(tb.find((r) => r.code === "6020")!.debit)).toBe(175000);
    expect(Number(tb.find((r) => r.code === "2500")!.credit)).toBe(169000);
    expect(Number(tb.find((r) => r.code === "2510")!.credit)).toBe(6000);
  });

  it("payment is recorded separately, once, from a bank in the run currency", async () => {
    await expect(payRun(db, { organizationId: org, runId, bankAccountId: "nope", actorId: boss })).rejects.toThrow(/bank account/);
    await Promise.all([1, 2].map(() => payRun(db, { organizationId: org, runId, bankAccountId: bank, actorId: boss })));
    expect((await db.payrollRun.findUniqueOrThrow({ where: { id: runId } })).status).toBe("PAID");
    expect(await db.journalEntry.count({ where: { sourceType: "PAYROLL_PAYMENT", sourceId: runId } })).toBe(1);
    const tb = await trialBalance(db, org);
    expect(Number(tb.find((r) => r.code === "2500")!.debit)).toBe(169000); // liability settled
    expect(Number(tb.find((r) => r.code === "1100")!.credit)).toBe(169000);
  });
});

describe("approved commissions and bonuses are paid through payroll", () => {
  let run2: string;
  let bonusA: string, commA: string, usdA: string, earnedB: string, manualB: string, lateB: string;
  const approved = async (userId: string, amount: string, currency = "PKR") => {
    const e = await addBonus(db, { organizationId: org, userId, amount, currency, note: "Target met", actorId: boss });
    await approveEntry(db, { organizationId: org, entryId: e.id, approverId: boss });
    return e.id;
  };
  const entry = (id: string) => db.commissionEntry.findUniqueOrThrow({ where: { id } });

  it("claims only approved, unpaid entries in the run currency, and taxes them at the person's rate", async () => {
    bonusA = await approved(a, "10000");
    commA = (await db.commissionEntry.create({ data: { organizationId: org, userId: a, kind: "COMMISSION", currency: "PKR", base: "20000", ratePercent: "10", amount: "2000", createdById: boss } })).id;
    await approveEntry(db, { organizationId: org, entryId: commA, approverId: boss });
    usdA = await approved(a, "100", "USD"); // other currency: stays out of a PKR run
    earnedB = (await addBonus(db, { organizationId: org, userId: b, amount: "500", currency: "PKR", note: "Not approved", actorId: boss })).id;
    const voided = (await addBonus(db, { organizationId: org, userId: b, amount: "700", currency: "PKR", note: "Voided", actorId: boss })).id;
    await voidEntry(db, { organizationId: org, entryId: voided });
    manualB = await approved(b, "300");
    await payEntry(db, { organizationId: org, entryId: manualB, bankAccountId: bank, actorId: boss }); // already paid by hand

    run2 = (await createRun(db, { organizationId: org, period: "2026-11", currency: "PKR", createdById: prep })).id;
    const ia = await db.payrollItem.findUniqueOrThrow({ where: { runId_userId: { runId: run2, userId: a } } });
    expect(ia.commission.toString()).toBe("12000");
    expect(ia.commissionTax.toString()).toBe("600"); // 5% of 12000
    expect(ia.gross.toString()).toBe("132000");
    expect(ia.tax.toString()).toBe("6600");
    expect(ia.net.toString()).toBe("125400");
    const ib = await db.payrollItem.findUniqueOrThrow({ where: { runId_userId: { runId: run2, userId: b } } });
    expect(ib.commission.toString()).toBe("0");
    expect((await entry(bonusA)).payrollRunId).toBe(run2);
    expect((await entry(commA)).payrollRunId).toBe(run2);
    for (const id of [usdA, earnedB, voided, manualB]) expect((await entry(id)).payrollRunId).toBeNull();
  });

  it("a bonus set on the run keeps the commission and its tax", async () => {
    const it2 = await setBonus(db, { organizationId: org, runId: run2, userId: a, bonus: "1000" });
    expect(it2.commission.toString()).toBe("12000");
    expect(it2.tax.toString()).toBe("6650"); // 5% of 121000 salary + 600
    await setBonus(db, { organizationId: org, runId: run2, userId: a, bonus: "0" });
  });

  it("an entry claimed by a run cannot also be paid by hand", async () => {
    await expect(payEntry(db, { organizationId: org, entryId: bonusA, bankAccountId: bank, actorId: boss })).rejects.toThrow(/payroll run/);
    expect((await entry(bonusA)).status).toBe("APPROVED");
  });

  it("deleting the draft releases its entries; making it again claims them again", async () => {
    const del = await deleteDraftRun(db, { organizationId: org, runId: run2 });
    expect(del.released).toBe(2);
    expect((await entry(bonusA)).payrollRunId).toBeNull();
    expect((await entry(commA)).payrollRunId).toBeNull();
    run2 = (await createRun(db, { organizationId: org, period: "2026-11", currency: "PKR", createdById: prep })).id;
    expect((await entry(bonusA)).payrollRunId).toBe(run2);
  });

  it("refreshing the draft picks up entries approved since, without counting any twice", async () => {
    lateB = await approved(b, "1000");
    expect((await refreshRunCommissions(db, { organizationId: org, runId: run2 })).claimed).toBe(3);
    const items = await db.payrollItem.findMany({ where: { runId: run2 } });
    expect(items.find((i) => i.userId === a)!.commission.toString()).toBe("12000");
    expect(items.find((i) => i.userId === b)!.net.toString()).toBe("51000"); // 0% tax
    expect((await entry(lateB)).payrollRunId).toBe(run2);
  });

  it("posting clears the accrued payable instead of expensing commissions twice, and the books balance", async () => {
    await approveRun(db, { organizationId: org, runId: run2, approverId: boss });
    await expect(refreshRunCommissions(db, { organizationId: org, runId: run2 })).rejects.toThrow(/locked/);
    await expect(deleteDraftRun(db, { organizationId: org, runId: run2 })).rejects.toThrow(/draft/);
    const before = await trialBalance(db, org);
    await postRun(db, { organizationId: org, runId: run2, actorId: boss });
    const lines = await db.journalLine.findMany({ where: { entry: { sourceType: "PAYROLL", sourceId: run2 } }, include: { account: true } });
    const by = (code: string, side: "debit" | "credit") => lines.filter((l) => l.account.code === code).reduce((s, l) => s + Number(l[side]), 0);
    expect(by("6020", "debit")).toBe(170000); // salaries only: commissions were expensed at approval
    expect(by("2500", "debit")).toBe(13000); // the commissions accrued to the payable
    expect(by("2500", "credit")).toBe(125400 + 51000);
    expect(by("2510", "credit")).toBe(6600);
    const tb = await trialBalance(db, org);
    for (const cur of ["PKR", "USD"]) {
      const rows = tb.filter((r) => r.currency === cur);
      expect(rows.reduce((s, r) => s + Number(r.debit), 0)).toBe(rows.reduce((s, r) => s + Number(r.credit), 0));
    }
    const expense = (t: typeof tb) => Number(t.find((r) => r.code === "6020" && r.currency === "PKR")!.debit);
    expect(expense(tb) - expense(before)).toBe(170000);
  });

  it("paying the run pays its entries, settles the payable, and they cannot be paid again", async () => {
    await payRun(db, { organizationId: org, runId: run2, bankAccountId: bank, actorId: boss });
    const run = await db.payrollRun.findUniqueOrThrow({ where: { id: run2 } });
    for (const id of [bonusA, commA, lateB]) {
      const e = await entry(id);
      expect(e.status).toBe("PAID");
      expect(e.paidById).toBe(boss);
      expect(e.paymentEntryId).toBe(run.paymentEntryId);
      expect(e.paidAt).not.toBeNull();
    }
    expect((await entry(earnedB)).status).toBe("EARNED");
    expect((await entry(usdA)).status).toBe("APPROVED");
    await expect(payEntry(db, { organizationId: org, entryId: bonusA, bankAccountId: bank, actorId: boss })).rejects.toThrow(/paid and cannot be paid/);
    const pkrPayable = (await trialBalance(db, org)).find((r) => r.code === "2500" && r.currency === "PKR")!;
    expect(Number(pkrPayable.debit)).toBe(Number(pkrPayable.credit)); // nothing left owed in PKR
    // A later run does not pick up what this one paid
    const run3 = await createRun(db, { organizationId: org, period: "2026-12", currency: "PKR", createdById: prep });
    expect((await db.payrollItem.findMany({ where: { runId: run3.id } })).every((i) => i.commission.eq(0))).toBe(true);
  });

  it("denied: only payroll managers prepare runs, and the earner cannot approve their own payout", async () => {
    const perms = (key: string) => ROLE_DEFS.find((r) => r.key === key)!.permissions as string[];
    expect(perms("SALES_AGENT")).not.toContain("payroll.manage");
    expect(perms("ACCOUNTANT")).not.toContain("payroll.manage");
    expect(perms("PAYROLL_OFFICER")).toContain("payroll.manage");
    expect(perms("PAYROLL_OFFICER")).not.toContain("payroll.post");
    const own = (await addBonus(db, { organizationId: org, userId: a, amount: "50", currency: "PKR", note: "Self", actorId: boss })).id;
    await expect(approveEntry(db, { organizationId: org, entryId: own, approverId: a })).rejects.toThrow(/your own/);
  });
});
