// Accountant essentials against hifi_one_test: manual journals, chart of accounts, period lock, credit notes, refunds.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { cancelInvoice, createDraftInvoice, issueInvoice, recordPayment, trialBalance } from "./accounting";
import {
  accountBalances, advanceBalance, approveManualJournal, createAccount, createManualJournal, issueCreditNote, refundAdvance, rejectManualJournal,
  reverseManualEntry, setPeriodLock, updateAccount,
} from "./bookkeeping";
import { loadReceivablesAging } from "./statements";

const url = process.env.TEST_DATABASE_URL ?? "postgresql://hifi:hifi_local_dev@localhost:54329/hifi_one_test";
const db = new PrismaClient({ datasourceUrl: url });

let org: string;
let bank: string;
let client: string;
let rent: string;
let cash: string;
let ar: string;
const maker = "maker-1";
const checker = "checker-1";
const today = new Date().toISOString().slice(0, 10);

const tb = async (code: string) => (await trialBalance(db, org)).find((r) => r.code === code && r.currency === "USD");
const balanced = async () => {
  const rows = await trialBalance(db, org);
  return rows.reduce((s, r) => s + Number(r.debit), 0) === rows.reduce((s, r) => s + Number(r.credit), 0);
};
const invoice = async (amount: string, taxRate = "0") => {
  const d = await createDraftInvoice(db, { organizationId: org, clientId: client, currency: "USD", taxRate, createdById: maker, lines: [{ description: "Work", quantity: "1", unitPrice: amount }] });
  return issueInvoice(db, { organizationId: org, invoiceId: d.id, actorId: maker });
};

beforeAll(async () => {
  await db.$executeRawUnsafe(
    'TRUNCATE "CreditNote","ManualJournal","PeriodLock","PaymentAllocation","Payment","InvoiceLine","Invoice","JournalLine","JournalEntry","NumberSequence","BankAccount","Account","Client","CompanyProfile","Organization" CASCADE',
  );
  org = (await db.organization.create({ data: { name: "Books Org" } })).id;
  await db.companyProfile.create({ data: { organizationId: org, isDefault: true, legalName: "Books Org" } });
  const mk = (code: string, name: string, type: string, systemKey?: string) => db.account.create({ data: { organizationId: org, code, name, type, systemKey } });
  ar = (await mk("1200", "AR", "ASSET", "AR")).id;
  await mk("2100", "Advances", "LIABILITY", "CUSTOMER_ADVANCES");
  await mk("2200", "Tax payable", "LIABILITY", "TAX_PAYABLE");
  await mk("4000", "Revenue", "REVENUE", "REVENUE_SERVICE");
  rent = (await mk("6010", "Rent", "OPEX")).id;
  cash = (await mk("1100", "Bank USD", "ASSET")).id;
  bank = (await db.bankAccount.create({ data: { organizationId: org, internalName: "USD", bankName: "B", accountHolder: "H", accountNumber: "1234", currency: "USD", isDefault: true, ledgerAccountId: cash } })).id;
  client = (await db.client.create({ data: { organizationId: org, name: "Acme", currency: "USD" } })).id;
});
afterAll(async () => {
  await db.$disconnect();
});

describe("manual journals", () => {
  const input = (over: object = {}) => ({ organizationId: org, date: today, memo: "Bank rent correction", currency: "USD", createdById: maker, lines: [{ accountId: rent, debit: "300" }, { accountId: cash, credit: "300" }], ...over });
  it("must balance and cannot touch control accounts", async () => {
    await expect(createManualJournal(db, input({ lines: [{ accountId: rent, debit: "300" }, { accountId: cash, credit: "299" }] }))).rejects.toThrow(/balance/);
    await expect(createManualJournal(db, input({ lines: [{ accountId: ar, debit: "50" }, { accountId: cash, credit: "50" }] }))).rejects.toThrow(/control account/);
    await expect(createManualJournal(db, input({ memo: "x" }))).rejects.toThrow(/Describe/);
    await expect(createManualJournal(db, input({ lines: [{ accountId: rent, debit: "-5" }, { accountId: cash, credit: "-5" }] }))).rejects.toThrow();
  });
  it("needs a second person to approve and posts exactly once, even concurrently", async () => {
    const j = await createManualJournal(db, input());
    expect(j.status).toBe("PENDING");
    expect(await tb("6010")).toBeUndefined(); // nothing posted before approval
    await expect(approveManualJournal(db, { organizationId: org, id: j.id, approverId: maker })).rejects.toThrow(/you prepared/);
    const results = await Promise.allSettled([1, 2, 3].map(() => approveManualJournal(db, { organizationId: org, id: j.id, approverId: checker })));
    expect(results.every((r) => r.status === "fulfilled")).toBe(true);
    expect(await db.journalEntry.count({ where: { sourceType: "MANUAL", sourceId: j.id } })).toBe(1);
    expect((await tb("6010"))!.debit).toBe("300.00");
    expect(await balanced()).toBe(true);
  });
  it("a rejection needs a reason and nothing is posted", async () => {
    const j = await createManualJournal(db, input({ memo: "Mistaken entry" }));
    await expect(rejectManualJournal(db, { organizationId: org, id: j.id, deciderId: checker, note: " " })).rejects.toThrow(/reason/);
    await rejectManualJournal(db, { organizationId: org, id: j.id, deciderId: checker, note: "Not needed" });
    await expect(approveManualJournal(db, { organizationId: org, id: j.id, approverId: checker })).rejects.toThrow(/already decided/);
    expect((await tb("6010"))!.debit).toBe("300.00");
  });
  it("a posted manual entry is corrected by a reversal, once; system entries cannot be reversed this way", async () => {
    const e = await db.journalEntry.findFirstOrThrow({ where: { sourceType: "MANUAL" } });
    await expect(reverseManualEntry(db, { organizationId: org, entryId: e.id, actorId: checker, reason: " " })).rejects.toThrow(/reason/);
    await Promise.all([1, 2].map(() => reverseManualEntry(db, { organizationId: org, entryId: e.id, actorId: checker, reason: "Posted to wrong month" })));
    expect(await db.journalEntry.count({ where: { reversalOfId: e.id } })).toBe(1);
    expect((await db.journalEntry.findUniqueOrThrow({ where: { id: e.id } })).status).toBe("REVERSED");
    expect(Number((await tb("6010"))!.debit) - Number((await tb("6010"))!.credit)).toBe(0);
    const inv = await invoice("10");
    await expect(reverseManualEntry(db, { organizationId: org, entryId: inv.journalEntryId!, actorId: checker, reason: "try" })).rejects.toThrow(/Only manual/);
  });
});

describe("chart of accounts", () => {
  it("creates accounts with unique valid codes", async () => {
    const a = await createAccount(db, { organizationId: org, code: "6500", name: "Travel", type: "OPEX" });
    expect(a.active).toBe(true);
    await expect(createAccount(db, { organizationId: org, code: "6500", name: "Dup", type: "OPEX" })).rejects.toThrow(/already exists/);
    await expect(createAccount(db, { organizationId: org, code: "6 5", name: "Bad", type: "OPEX" })).rejects.toThrow(/Account code/);
    await expect(createAccount(db, { organizationId: org, code: "6501", name: "Bad", type: "NONSENSE" })).rejects.toThrow(/type/);
  });
  it("renames freely but deactivates only empty, non-system, non-bank accounts", async () => {
    const travel = await db.account.findFirstOrThrow({ where: { code: "6500" } });
    expect((await updateAccount(db, { organizationId: org, id: travel.id, name: "Travel and transport" })).name).toBe("Travel and transport");
    expect((await updateAccount(db, { organizationId: org, id: travel.id, active: false })).active).toBe(false);
    await expect(updateAccount(db, { organizationId: org, id: ar, active: false })).rejects.toThrow(/automatic postings/);
    await expect(updateAccount(db, { organizationId: org, id: cash, active: false })).rejects.toThrow(/balance|bank account/);
    const used = await createAccount(db, { organizationId: org, code: "6600", name: "Fees", type: "OPEX" });
    const j = await createManualJournal(db, { organizationId: org, date: today, memo: "Bank fees", currency: "USD", createdById: maker, lines: [{ accountId: used.id, debit: "20" }, { accountId: cash, credit: "20" }] });
    await approveManualJournal(db, { organizationId: org, id: j.id, approverId: checker });
    await expect(updateAccount(db, { organizationId: org, id: used.id, active: false })).rejects.toThrow(/has a balance/);
    expect((await accountBalances(db, used.id))[0].balance).toBe("20.00");
  });
});

describe("credit notes", () => {
  let inv: Awaited<ReturnType<typeof invoice>>;
  it("reverses revenue and tax in proportion and reduces what the client owes", async () => {
    inv = await invoice("1000", "10"); // total 1100, tax 100
    const cn = await issueCreditNote(db, { organizationId: org, invoiceId: inv.id, amount: "220", reason: "Service not delivered", actorId: maker, idempotencyKey: "cn-1" });
    expect(cn.number).toMatch(/^CN-\d{6}$/);
    expect(cn.taxPortion.toString()).toBe("20"); // 220 * 100 / 1100
    const after = await db.invoice.findUniqueOrThrow({ where: { id: inv.id } });
    expect(after.creditedAmount.toString()).toBe("220");
    expect(after.status).toBe("PARTIALLY_PAID");
    expect(await balanced()).toBe(true);
    const aging = await loadReceivablesAging(db, org);
    expect(Number(aging.detail.find((d) => d.id === inv.id)!.outstanding)).toBe(880);
  });
  it("is idempotent, and cannot exceed the balance even under concurrent requests", async () => {
    const again = await issueCreditNote(db, { organizationId: org, invoiceId: inv.id, amount: "220", reason: "Service not delivered", actorId: maker, idempotencyKey: "cn-1" });
    expect(again.number).toMatch(/^CN-/);
    expect(await db.creditNote.count({ where: { invoiceId: inv.id } })).toBe(1);
    const results = await Promise.allSettled(["a", "b"].map((k) => issueCreditNote(db, { organizationId: org, invoiceId: inv.id, amount: "600", reason: "Goodwill", actorId: maker, idempotencyKey: `cn-${k}` })));
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1); // 220 + 600 + 600 > 1100
    await expect(issueCreditNote(db, { organizationId: org, invoiceId: inv.id, amount: "281", reason: "Too much", actorId: maker, idempotencyKey: "cn-x" })).rejects.toThrow(/exceeds the balance/);
  });
  it("payments only settle what is still owed after credits; a fully credited invoice becomes CREDITED", async () => {
    const left = (await db.invoice.findUniqueOrThrow({ where: { id: inv.id } }));
    const owed = Number(left.total.sub(left.amountPaid).sub(left.creditedAmount)); // 280
    const pay = await recordPayment(db, { organizationId: org, actorId: maker, clientId: client, bankAccountId: bank, amount: String(owed + 50), date: new Date(), method: "BANK_TRANSFER", idempotencyKey: "cn-pay", invoiceIds: [inv.id] });
    expect(pay.unallocated.toString()).toBe("50"); // 50 becomes an advance, not an overpayment of the invoice
    const final = await db.invoice.findUniqueOrThrow({ where: { id: inv.id } });
    expect(final.status).toBe("PAID");
    expect(final.amountPaid.toString()).toBe(String(owed));
  });
  it("a credited, unpaid invoice shows CREDITED and cannot be cancelled afterwards", async () => {
    const i2 = await invoice("200");
    await issueCreditNote(db, { organizationId: org, invoiceId: i2.id, amount: "200", reason: "Cancelled order", actorId: maker, idempotencyKey: "cn-full" });
    expect((await db.invoice.findUniqueOrThrow({ where: { id: i2.id } })).status).toBe("CREDITED");
    await expect(issueCreditNote(db, { organizationId: org, invoiceId: i2.id, amount: "1", reason: "again", actorId: maker, idempotencyKey: "cn-more" })).rejects.toThrow(/Only an issued invoice/);
    const i3 = await invoice("100");
    await issueCreditNote(db, { organizationId: org, invoiceId: i3.id, amount: "30", reason: "Discount", actorId: maker, idempotencyKey: "cn-part" });
    await expect(cancelInvoice(db, { organizationId: org, invoiceId: i3.id, actorId: maker })).rejects.toThrow(/credit notes/);
  });
});

describe("refunds of money held on account", () => {
  it("cannot exceed the advance, is idempotent, and pays out of the bank", async () => {
    expect((await advanceBalance(db, org, client, "USD")).toString()).toBe("50");
    await expect(refundAdvance(db, { organizationId: org, clientId: client, bankAccountId: bank, amount: "80", reason: "Client request", actorId: maker, idempotencyKey: "rf-1" })).rejects.toThrow(/holds only/);
    const results = await Promise.all([1, 2].map(() => refundAdvance(db, { organizationId: org, clientId: client, bankAccountId: bank, amount: "30", reason: "Client request", actorId: maker, idempotencyKey: "rf-2" })));
    expect(results[0].id).toBe(results[1].id);
    expect((await advanceBalance(db, org, client, "USD")).toString()).toBe("20");
    expect(await db.journalEntry.count({ where: { sourceType: "REFUND" } })).toBe(1);
    const concurrent = await Promise.allSettled(["x", "y"].map((k) => refundAdvance(db, { organizationId: org, clientId: client, bankAccountId: bank, amount: "15", reason: "More", actorId: maker, idempotencyKey: `rf-${k}` })));
    expect(concurrent.filter((r) => r.status === "fulfilled")).toHaveLength(1); // 20 held, 15 + 15 > 20
    expect(await balanced()).toBe(true);
  });
});

describe("period lock", () => {
  it("cannot close a period that has not ended, and a closed period accepts no postings from any module", async () => {
    await expect(setPeriodLock(db, { organizationId: org, lockedThrough: "2999-01-01", actorId: checker })).rejects.toThrow(/not ended/);
    await setPeriodLock(db, { organizationId: org, lockedThrough: today, actorId: checker });
    await expect(createManualJournal(db, { organizationId: org, date: today, memo: "Late entry", currency: "USD", createdById: maker, lines: [{ accountId: rent, debit: "1" }, { accountId: cash, credit: "1" }] })).rejects.toThrow(/closed/);
    const d = await createDraftInvoice(db, { organizationId: org, clientId: client, currency: "USD", taxRate: "0", createdById: maker, lines: [{ description: "x", quantity: "1", unitPrice: "5" }] });
    await expect(issueInvoice(db, { organizationId: org, invoiceId: d.id, actorId: maker })).rejects.toThrow(/closed/); // issuing posts dated today
    expect((await db.invoice.findUniqueOrThrow({ where: { id: d.id } })).status).toBe("DRAFT"); // nothing half-done
  });
  it("reopening needs a reason, and then posting works again", async () => {
    await expect(setPeriodLock(db, { organizationId: org, lockedThrough: "2000-01-01", actorId: checker })).rejects.toThrow(/reason/);
    await setPeriodLock(db, { organizationId: org, lockedThrough: "2000-01-01", actorId: checker, reopenReason: "Auditor adjustment" });
    const d = await createDraftInvoice(db, { organizationId: org, clientId: client, currency: "USD", taxRate: "0", createdById: maker, lines: [{ description: "x", quantity: "1", unitPrice: "5" }] });
    expect((await issueInvoice(db, { organizationId: org, invoiceId: d.id, actorId: maker })).status).toBe("ISSUED");
  });
});
