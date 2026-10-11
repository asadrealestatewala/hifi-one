// Payroll integration tests against hifi_one_test.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { PayrollError, approveRun, createRun, payRun, postRun, setBonus, setSalaryStructure } from "./payroll";
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
    'TRUNCATE "PayrollItem","PayrollRun","SalaryStructure","LeaveRequest","LeaveType","EmployeeProfile","JournalLine","JournalEntry","BankAccount","Account","NumberSequence","UserRole","User","Role","Organization" CASCADE',
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
