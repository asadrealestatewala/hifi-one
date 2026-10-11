import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { cancelInvoice, createDraftInvoice, issueInvoice, recordPayment, trialBalance } from "./accounting";
import { issueCreditNote, writeOffInvoice } from "./bookkeeping";
import { LedgerError } from "./ledger-math";
import { loadPayablesAging } from "./statements";
import { TaxError, addTaxRate, salesTaxReport, setTaxRateActive } from "./tax";

const url = process.env.TEST_DATABASE_URL ?? "postgresql://hifi:hifi_local_dev@localhost:54329/hifi_one_test";
const db = new PrismaClient({ datasourceUrl: url });
let org: string, other: string, client: string, bank: string;
const actor = "fin";
let n = 0;
const key = () => `k-${++n}`;

async function issued(subtotal: string, taxRate: string, currency = "USD") {
  const d = await createDraftInvoice(db, { organizationId: org, clientId: client, currency, taxRate, createdById: actor, lines: [{ description: "Work", quantity: "1", unitPrice: subtotal }] });
  return issueInvoice(db, { organizationId: org, invoiceId: d.id, actorId: actor });
}

beforeAll(async () => {
  await db.$executeRawUnsafe('TRUNCATE "TaxRate","CreditNote","PaymentAllocation","Payment","InvoiceLine","Invoice","VendorBill","WorkOrder","Vendor","JournalLine","JournalEntry","NumberSequence","BankAccount","Account","Client","CompanyProfile","Organization" CASCADE');
  org = (await db.organization.create({ data: { name: "Tax Org" } })).id;
  other = (await db.organization.create({ data: { name: "Other" } })).id;
  const mk = (code: string, name: string, type: string, systemKey?: string) => db.account.create({ data: { organizationId: org, code, name, type, systemKey } });
  await mk("1200", "AR", "ASSET", "AR"); await mk("2200", "Tax payable", "LIABILITY", "TAX_PAYABLE"); await mk("2100", "Advances", "LIABILITY", "CUSTOMER_ADVANCES"); await mk("4000", "Revenue", "REVENUE", "REVENUE_SERVICE");
  const cash = await mk("1100", "Bank", "ASSET");
  bank = (await db.bankAccount.create({ data: { organizationId: org, internalName: "USD", bankName: "B", accountHolder: "H", accountNumber: "1234", currency: "USD", isDefault: true, ledgerAccountId: cash.id } })).id;
  client = (await db.client.create({ data: { organizationId: org, name: "Acme", currency: "USD" } })).id;
});
afterAll(async () => { await db.$disconnect(); });

describe("tax rates", () => {
  it("validates, rejects duplicates, and can be switched off", async () => {
    await expect(addTaxRate(db, { organizationId: org, name: " ", ratePercent: "5" })).rejects.toThrow(TaxError);
    await expect(addTaxRate(db, { organizationId: org, name: "X", ratePercent: "101" })).rejects.toThrow(TaxError);
    await expect(addTaxRate(db, { organizationId: org, name: "X", ratePercent: "5.123" })).rejects.toThrow(TaxError);
    const r = await addTaxRate(db, { organizationId: org, name: "VAT 5%", ratePercent: "5" });
    await expect(addTaxRate(db, { organizationId: org, name: "VAT 5%", ratePercent: "6" })).rejects.toThrow(/already exists/);
    await setTaxRateActive(db, { organizationId: org, id: r.id, active: false });
    expect((await db.taxRate.findUniqueOrThrow({ where: { id: r.id } })).active).toBe(false);
    await expect(setTaxRateActive(db, { organizationId: other, id: r.id, active: true })).rejects.toThrow(TaxError);
  });
});

describe("sales tax report", () => {
  it("totals tax by currency and rate, nets credit notes, and leaves out cancelled invoices", async () => {
    await issued("1000", "5");
    await issued("500", "5");
    const ten = await issued("200", "10");
    await issued("300", "0");
    const cancelled = await issued("999", "5");
    await cancelInvoice(db, { organizationId: org, invoiceId: cancelled.id, actorId: actor });
    await issueCreditNote(db, { organizationId: org, invoiceId: ten.id, amount: "110", reason: "Returned", actorId: actor, idempotencyKey: key() }); // reverses 10.00 of tax
    const today = new Date().toISOString().slice(0, 10);
    const [usd] = await salesTaxReport(db, org, { from: today, to: today });
    expect(usd.currency).toBe("USD");
    const by = Object.fromEntries(usd.lines.map((l) => [l.rate, l]));
    expect(by["5"].tax.toString()).toBe("75");
    expect(by["5"].taxable.toString()).toBe("1500");
    expect(by["5"].count).toBe(2);
    expect(by["10"].tax.toString()).toBe("20");
    expect(by["0"].tax.toString()).toBe("0");
    expect(usd.collected.toString()).toBe("95");
    expect(usd.reversed.toString()).toBe("10");
    expect(usd.net.toString()).toBe("85");
  });

  it("reports nothing for an empty period", async () => {
    expect(await salesTaxReport(db, org, { from: "2020-01-01", to: "2020-01-31" })).toEqual([]);
  });
});

describe("write-offs", () => {
  it("reduces the balance like a credit note but charges Bad Debt, leaving tax payable unless relief is claimed", async () => {
    const inv = await issued("1000", "10"); // total 1100, tax 100
    const wo = await writeOffInvoice(db, { organizationId: org, invoiceId: inv.id, amount: "550", reason: "Client closed down", reverseTax: false, actorId: actor, idempotencyKey: key() });
    expect(wo.kind).toBe("WRITE_OFF");
    expect(wo.number).toMatch(/^WO-/);
    const after = await db.invoice.findUniqueOrThrow({ where: { id: inv.id } });
    expect(after.creditedAmount.toString()).toBe("550");
    expect(after.status).toBe("PARTIALLY_PAID");
    const tb = Object.fromEntries((await trialBalance(db, org)).map((r) => [r.code, r]));
    expect(Number(tb["6050"].debit)).toBe(550);
    const lines = await db.journalLine.findMany({ where: { entryId: wo.journalEntryId! } });
    expect(lines).toHaveLength(2); // bad debt + AR, no tax line
  });

  it("with tax relief, the tax share is taken from Tax Payable instead", async () => {
    const inv = await issued("1000", "10");
    const wo = await writeOffInvoice(db, { organizationId: org, invoiceId: inv.id, amount: "110", reason: "Uncollectable debt", reverseTax: true, actorId: actor, idempotencyKey: key() });
    expect(wo.taxPortion.toString()).toBe("10");
    const lines = await db.journalLine.findMany({ where: { entryId: wo.journalEntryId! }, include: { account: true } });
    expect(Number(lines.find((l) => l.account.systemKey === "TAX_PAYABLE")!.debit)).toBe(10);
    expect(Number(lines.find((l) => l.account.systemKey === "BAD_DEBT")!.debit)).toBe(100);
  });

  it("can clear a whole invoice, is repeatable by key, and blocks over-writing and wrong states", async () => {
    const inv = await issued("100", "0");
    const k = key();
    const a = await writeOffInvoice(db, { organizationId: org, invoiceId: inv.id, amount: "100", reason: "Written off fully", reverseTax: false, actorId: actor, idempotencyKey: k });
    const b = await writeOffInvoice(db, { organizationId: org, invoiceId: inv.id, amount: "100", reason: "Written off fully", reverseTax: false, actorId: actor, idempotencyKey: k });
    expect(b.id).toBe(a.id);
    expect((await db.invoice.findUniqueOrThrow({ where: { id: inv.id } })).status).toBe("CREDITED");
    await expect(writeOffInvoice(db, { organizationId: org, invoiceId: inv.id, amount: "1", reason: "Again again", reverseTax: false, actorId: actor, idempotencyKey: key() })).rejects.toThrow(/Only an issued/);
    const inv2 = await issued("50", "0");
    await expect(writeOffInvoice(db, { organizationId: org, invoiceId: inv2.id, amount: "51", reason: "Too much", reverseTax: false, actorId: actor, idempotencyKey: key() })).rejects.toThrow(/exceeds/);
    await expect(writeOffInvoice(db, { organizationId: org, invoiceId: inv2.id, amount: "5", reason: "no", reverseTax: false, actorId: actor, idempotencyKey: key() })).rejects.toThrow(LedgerError);
    await expect(writeOffInvoice(db, { organizationId: other, invoiceId: inv2.id, amount: "5", reason: "Other org", reverseTax: false, actorId: actor, idempotencyKey: key() })).rejects.toThrow(/not found/);
  });

  it("two simultaneous write-offs of the full balance succeed only once", async () => {
    const inv = await issued("80", "0");
    const rs = await Promise.allSettled([1, 2].map(() => writeOffInvoice(db, { organizationId: org, invoiceId: inv.id, amount: "80", reason: "Race condition", reverseTax: false, actorId: actor, idempotencyKey: key() })));
    expect(rs.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  });

  it("a payment after a full write-off is never applied to the cleared invoice", async () => {
    const inv = await issued("60", "0");
    await writeOffInvoice(db, { organizationId: org, invoiceId: inv.id, amount: "60", reason: "Cleared fully", reverseTax: false, actorId: actor, idempotencyKey: key() });
    await recordPayment(db, { organizationId: org, actorId: actor, clientId: client, bankAccountId: bank, amount: "60", date: new Date(), method: "BANK_TRANSFER", idempotencyKey: key(), invoiceIds: [inv.id] }).catch(() => undefined);
    const after = await db.invoice.findUniqueOrThrow({ where: { id: inv.id } });
    expect(after.amountPaid.toString()).toBe("0");
    expect(after.status).toBe("CREDITED");
  });
});

describe("payables aging", () => {
  it("buckets posted unpaid bills by age and ignores paid or unposted ones", async () => {
    const vendor = await db.vendor.create({ data: { organizationId: org, name: "Studio", code: "V-1" } });
    const wo = await db.workOrder.create({ data: { organizationId: org, number: "WO-1", vendorId: vendor.id, title: "x", amount: "1000", currency: "USD" } });
    const ago = (d: number) => new Date(Date.now() - d * 86400000);
    const bill = (num: string, amount: string, status: string, days: number, currency = "USD") =>
      db.vendorBill.create({ data: { organizationId: org, number: num, vendorId: vendor.id, workOrderId: wo.id, amount, currency, status, createdAt: ago(days) } });
    await bill("B1", "100", "POSTED", 5); await bill("B2", "200", "POSTED", 45); await bill("B3", "300", "POSTED", 120); await bill("B4", "400", "PAID", 50); await bill("B5", "500", "SUBMITTED", 50); await bill("B6", "70", "POSTED", 10, "AED");
    const a = await loadPayablesAging(db, org);
    const usd = a.byCurrency.get("USD")!;
    expect(usd.get("1-30 days")?.toString()).toBe("100");
    expect(usd.get("31-60 days")?.toString()).toBe("200");
    expect(usd.get("Over 90 days")?.toString()).toBe("300");
    expect(a.byCurrency.get("AED")?.get("1-30 days")?.toString()).toBe("70");
    expect(a.detail).toHaveLength(4);
  });
});
