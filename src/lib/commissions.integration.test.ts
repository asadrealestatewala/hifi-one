import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { createDraftInvoice, issueInvoice, recordPayment, trialBalance } from "./accounting";
import { CommissionError, accrueCommissions, addBonus, approveEntry, payEntry, salesOwnerOf, setRule, statementFor, voidEntry } from "./commissions";

const url = process.env.TEST_DATABASE_URL ?? "postgresql://hifi:hifi_local_dev@localhost:54329/hifi_one_test";
const db = new PrismaClient({ datasourceUrl: url });
let org: string, other: string, sales: string, boss: string, client: string, bank: string, aedBank: string;
let n = 0;
const key = () => `ck-${++n}`;

async function invoiceAndPayment(subtotal: string, taxRate: string, pay: string, clientId = client) {
  const d = await createDraftInvoice(db, { organizationId: org, clientId, currency: "USD", taxRate, createdById: boss, lines: [{ description: "Work", quantity: "1", unitPrice: subtotal }] });
  const inv = await issueInvoice(db, { organizationId: org, invoiceId: d.id, actorId: boss });
  await recordPayment(db, { organizationId: org, actorId: boss, clientId, bankAccountId: bank, amount: pay, date: new Date(), method: "BANK_TRANSFER", idempotencyKey: key(), invoiceIds: [inv.id] });
  return inv;
}

beforeAll(async () => {
  await db.$executeRawUnsafe('TRUNCATE "CommissionEntry","CommissionRule","Lead","PipelineStage","PaymentAllocation","Payment","InvoiceLine","Invoice","JournalLine","JournalEntry","NumberSequence","BankAccount","Account","Client","User","CompanyProfile","Organization" CASCADE');
  org = (await db.organization.create({ data: { name: "Comm Org" } })).id;
  other = (await db.organization.create({ data: { name: "Other" } })).id;
  const mk = (code: string, name: string, type: string, systemKey?: string) => db.account.create({ data: { organizationId: org, code, name, type, systemKey } });
  await mk("1200", "AR", "ASSET", "AR"); await mk("2100", "Advances", "LIABILITY", "CUSTOMER_ADVANCES"); await mk("2200", "Tax", "LIABILITY", "TAX_PAYABLE"); await mk("4000", "Revenue", "REVENUE", "REVENUE_SERVICE");
  await mk("6020", "Commissions", "OPEX", "PAYROLL_EXPENSE"); await mk("2500", "Payroll payable", "LIABILITY", "PAYROLL_PAYABLE");
  const cash = await mk("1100", "Bank USD", "ASSET"); const cash2 = await mk("1101", "Bank AED", "ASSET");
  bank = (await db.bankAccount.create({ data: { organizationId: org, internalName: "USD", bankName: "B", accountHolder: "H", accountNumber: "1", currency: "USD", isDefault: true, ledgerAccountId: cash.id } })).id;
  aedBank = (await db.bankAccount.create({ data: { organizationId: org, internalName: "AED", bankName: "B", accountHolder: "H", accountNumber: "2", currency: "AED", ledgerAccountId: cash2.id } })).id;
  sales = (await db.user.create({ data: { organizationId: org, email: "s@c.test", name: "Sam Sales", passwordHash: "x" } })).id;
  boss = (await db.user.create({ data: { organizationId: org, email: "b@c.test", name: "Bea Boss", passwordHash: "x" } })).id;
  client = (await db.client.create({ data: { organizationId: org, name: "Acme", currency: "USD" } })).id;
  const stage = await db.pipelineStage.create({ data: { organizationId: org, name: "Won", sortOrder: 1, isWon: true } });
  await db.lead.create({ data: { organizationId: org, stageId: stage.id, name: "Acme lead", assignedToId: sales, clientId: client, convertedAt: new Date() } });
});
afterAll(async () => { await db.$disconnect(); });

describe("rules and ownership", () => {
  it("validates the rate and the person, and knows who owns a client", async () => {
    await expect(setRule(db, { organizationId: org, userId: sales, ratePercent: "60", active: true, actorId: boss })).rejects.toThrow(CommissionError);
    await expect(setRule(db, { organizationId: org, userId: sales, ratePercent: "abc", active: true, actorId: boss })).rejects.toThrow(CommissionError);
    await expect(setRule(db, { organizationId: other, userId: sales, ratePercent: "5", active: true, actorId: boss })).rejects.toThrow(/staff member/);
    expect(await salesOwnerOf(db, org, client)).toBe(sales);
    expect(await salesOwnerOf(db, org, "nobody")).toBeNull();
  });
});

describe("earning", () => {
  it("earns nothing before a rule exists, and not for payments made before the rule", async () => {
    await invoiceAndPayment("1000", "0", "1000");
    await setRule(db, { organizationId: org, userId: sales, ratePercent: "10", active: true, actorId: boss });
    expect((await accrueCommissions(db, { organizationId: org, actorId: boss })).created).toBe(0);
  });

  it("takes the percentage of the tax-free share of what was actually received, once per payment", async () => {
    await new Promise((r) => setTimeout(r, 20));
    await invoiceAndPayment("1000", "10", "550"); // paid half of 1100: revenue share 500
    const first = await accrueCommissions(db, { organizationId: org, actorId: boss });
    expect(first.created).toBe(1);
    expect((await accrueCommissions(db, { organizationId: org, actorId: boss })).created).toBe(0);
    const e = await db.commissionEntry.findFirstOrThrow({ where: { userId: sales, kind: "COMMISSION" } });
    expect(e.base.toString()).toBe("500");
    expect(e.amount.toString()).toBe("50");
    expect(e.status).toBe("EARNED");
  });

  it("running it twice at the same moment still creates one entry", async () => {
    await invoiceAndPayment("200", "0", "200");
    await Promise.all([1, 2, 3].map(() => accrueCommissions(db, { organizationId: org, actorId: boss })));
    expect(await db.commissionEntry.count({ where: { userId: sales, kind: "COMMISSION" } })).toBe(2);
  });

  it("changing the rate only affects later payments", async () => {
    await new Promise((r) => setTimeout(r, 20));
    await setRule(db, { organizationId: org, userId: sales, ratePercent: "20", active: true, actorId: boss });
    expect((await accrueCommissions(db, { organizationId: org, actorId: boss })).created).toBe(0);
    await new Promise((r) => setTimeout(r, 20));
    await invoiceAndPayment("100", "0", "100");
    await accrueCommissions(db, { organizationId: org, actorId: boss });
    const latest = await db.commissionEntry.findFirstOrThrow({ where: { userId: sales }, orderBy: { createdAt: "desc" } });
    expect(latest.amount.toString()).toBe("20");
    expect(latest.ratePercent.toString()).toBe("20");
  });

  it("clients with no sales owner earn nobody anything", async () => {
    const c2 = (await db.client.create({ data: { organizationId: org, name: "Walk-in", currency: "USD" } })).id;
    const before = await db.commissionEntry.count();
    await invoiceAndPayment("300", "0", "300", c2);
    await accrueCommissions(db, { organizationId: org, actorId: boss });
    expect(await db.commissionEntry.count()).toBe(before);
  });
});

describe("bonuses", () => {
  it("need an amount, a currency and a reason", async () => {
    await expect(addBonus(db, { organizationId: org, userId: sales, amount: "0", currency: "USD", note: "Quarter target", actorId: boss })).rejects.toThrow(CommissionError);
    await expect(addBonus(db, { organizationId: org, userId: sales, amount: "100", currency: "EUR", note: "Quarter target", actorId: boss })).rejects.toThrow(CommissionError);
    await expect(addBonus(db, { organizationId: org, userId: sales, amount: "100", currency: "USD", note: "x", actorId: boss })).rejects.toThrow(/for/);
    expect((await addBonus(db, { organizationId: org, userId: sales, amount: "100", currency: "USD", note: "Quarter target met", actorId: boss })).kind).toBe("BONUS");
  });
});

describe("approval and payment", () => {
  it("cannot be approved by the person who earned it, and approval books the cost once", async () => {
    const e = await db.commissionEntry.findFirstOrThrow({ where: { userId: sales, kind: "COMMISSION", status: "EARNED", amount: "50" } });
    await expect(approveEntry(db, { organizationId: org, entryId: e.id, approverId: sales })).rejects.toThrow(/own commission/);
    const rs = await Promise.allSettled([1, 2].map(() => approveEntry(db, { organizationId: org, entryId: e.id, approverId: boss })));
    expect(rs.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const tb = Object.fromEntries((await trialBalance(db, org)).map((r) => [r.code, r]));
    expect(Number(tb["6020"].debit)).toBe(50);
    expect(Number(tb["2500"].credit)).toBe(50);
    expect((await db.commissionEntry.findUniqueOrThrow({ where: { id: e.id } })).status).toBe("APPROVED");
  });

  it("is paid once, from a bank in the same currency, and settles the payable", async () => {
    const e = await db.commissionEntry.findFirstOrThrow({ where: { status: "APPROVED" } });
    await expect(payEntry(db, { organizationId: org, entryId: e.id, bankAccountId: aedBank, actorId: boss })).rejects.toThrow(/USD/);
    const rs = await Promise.allSettled([1, 2].map(() => payEntry(db, { organizationId: org, entryId: e.id, bankAccountId: bank, actorId: boss })));
    expect(rs.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const tb = Object.fromEntries((await trialBalance(db, org)).map((r) => [r.code, r]));
    expect(Number(tb["2500"].debit)).toBe(50);
    expect((await db.commissionEntry.findUniqueOrThrow({ where: { id: e.id } })).status).toBe("PAID");
    await expect(payEntry(db, { organizationId: org, entryId: e.id, bankAccountId: bank, actorId: boss })).rejects.toThrow(/paid/);
  });

  it("an unapproved entry cannot be paid, and only an earned one can be voided", async () => {
    const e = await db.commissionEntry.findFirstOrThrow({ where: { status: "EARNED", kind: "BONUS" } });
    await expect(payEntry(db, { organizationId: org, entryId: e.id, bankAccountId: bank, actorId: boss })).rejects.toThrow(/earned/);
    await voidEntry(db, { organizationId: org, entryId: e.id });
    await expect(approveEntry(db, { organizationId: org, entryId: e.id, approverId: boss })).rejects.toThrow(/void/);
    await expect(voidEntry(db, { organizationId: other, entryId: e.id })).rejects.toThrow(/not found/);
  });

  it("the earner's statement totals each stage by currency and leaves out voided entries", async () => {
    const s = await statementFor(db, org, sales);
    const usd = s.totals.get("USD")!;
    expect(Number(usd.paid)).toBe(50);
    expect(Number(usd.earned)).toBeGreaterThan(0);
    expect(s.entries.every((x) => x.status !== "VOID")).toBe(true);
  });
});
