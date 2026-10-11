// PDF data loading against hifi_one_test: frozen snapshots, template settings, and client scoping.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { createDraftInvoice, issueInvoice, recordPayment } from "./accounting";
import { issueCreditNote } from "./bookkeeping";
import { invoicePdf, receiptPdf, statementPdf, creditNotePdf } from "./pdf";
import { loadCreditNoteDoc, loadInvoiceDoc, loadReceiptDoc, loadStatementDoc, loadVoucherDoc } from "./pdf-data";
import { pdfPlainText } from "./pdf-text.testutil";

const url = process.env.TEST_DATABASE_URL ?? "postgresql://hifi:hifi_local_dev@localhost:54329/hifi_one_test";
const db = new PrismaClient({ datasourceUrl: url });

let org: string;
let acme: string;
let other: string;
let bank: string;
let invoiceId: string;
let draftId: string;
let paymentId: string;
const actor = "actor-1";

beforeAll(async () => {
  await db.$executeRawUnsafe(
    'TRUNCATE "DocumentSetting","CreditNote","PaymentAllocation","Payment","InvoiceLine","Invoice","ExpenseVoucher","JournalLine","JournalEntry","NumberSequence","BankAccount","Account","Client","CompanyProfile","Organization" CASCADE',
  );
  org = (await db.organization.create({ data: { name: "PDF Org" } })).id;
  await db.companyProfile.create({ data: { organizationId: org, isDefault: true, legalName: "Original Name Ltd", registeredOffice: "1 Old Road", globalUan: "+1 000", defaultCurrency: "USD" } });
  const mk = (code: string, name: string, type: string, systemKey?: string) => db.account.create({ data: { organizationId: org, code, name, type, systemKey } });
  await mk("1200", "AR", "ASSET", "AR");
  await mk("2100", "Advances", "LIABILITY", "CUSTOMER_ADVANCES");
  await mk("2200", "Tax", "LIABILITY", "TAX_PAYABLE");
  await mk("4000", "Revenue", "REVENUE", "REVENUE_SERVICE");
  const cash = await mk("1100", "Bank", "ASSET");
  bank = (await db.bankAccount.create({ data: { organizationId: org, internalName: "USD main", bankName: "Old Bank", accountHolder: "H", accountNumber: "111122223333", currency: "USD", isDefault: true, ledgerAccountId: cash.id } })).id;
  acme = (await db.client.create({ data: { organizationId: org, name: "Acme", currency: "USD" } })).id;
  other = (await db.client.create({ data: { organizationId: org, name: "Other Co", currency: "USD" } })).id;
  await db.documentSetting.create({ data: { organizationId: org, docType: "INVOICE", version: 2, config: { showPhones: false, footerText: "Pay within 14 days." } } });
  const draft = await createDraftInvoice(db, { organizationId: org, clientId: acme, currency: "USD", taxRate: "10", createdById: actor, lines: [{ description: "Work", quantity: "1", unitPrice: "1000" }] });
  draftId = draft.id;
  const issued = await createDraftInvoice(db, { organizationId: org, clientId: acme, currency: "USD", taxRate: "10", createdById: actor, lines: [{ description: "Retainer", quantity: "1", unitPrice: "1000" }] });
  invoiceId = issued.id;
  await issueInvoice(db, { organizationId: org, invoiceId, actorId: actor });
  const pay = await recordPayment(db, { organizationId: org, actorId: actor, clientId: acme, bankAccountId: bank, amount: "400", date: new Date(), method: "BANK_TRANSFER", idempotencyKey: "pdf-1", invoiceIds: [invoiceId], reference: "TT-77" });
  paymentId = pay.id;
});
afterAll(async () => {
  await db.$disconnect();
});

describe("invoice documents", () => {
  it("an issued invoice keeps the company, bank and template it was issued with, even after settings change", async () => {
    await db.companyProfile.updateMany({ where: { organizationId: org }, data: { legalName: "Brand New Name Inc", registeredOffice: "99 New Avenue" } });
    await db.bankAccount.updateMany({ where: { organizationId: org }, data: { bankName: "New Bank", accountNumber: "999988887777" } });
    await db.documentSetting.update({ where: { organizationId_docType: { organizationId: org, docType: "INVOICE" } }, data: { config: { showPhones: true, footerText: "Changed footer" }, version: 3 } });
    const doc = await loadInvoiceDoc(db, { organizationId: org, invoiceId });
    const t = pdfPlainText(await invoicePdf(doc!, { compress: false }));
    expect(t).toContain("Original Name Ltd");
    expect(t).toContain("1 Old Road");
    expect(t).toContain("Old Bank");
    expect(t).toContain("111122223333");
    expect(t).toContain("Pay within 14 days.");
    expect(t).not.toContain("+1 000"); // phones were hidden when it was issued
    expect(t).not.toContain("Brand New Name");
    expect(t).toContain("Template v2");
    expect(t).toContain("USD 1,100.00");
    expect(t).toContain("USD 700.00"); // balance after the 400 payment
  });
  it("a draft uses today's details and the live template", async () => {
    const t = pdfPlainText(await invoicePdf((await loadInvoiceDoc(db, { organizationId: org, invoiceId: draftId }))!, { compress: false }));
    expect(t).toContain("Brand New Name Inc");
    expect(t).toContain("Changed footer");
    expect(t).toContain("DRAFT (not issued)");
  });
  it("a client gets only their own issued invoices", async () => {
    expect(await loadInvoiceDoc(db, { organizationId: org, invoiceId, clientId: acme })).not.toBeNull();
    expect(await loadInvoiceDoc(db, { organizationId: org, invoiceId, clientId: other })).toBeNull(); // someone else's
    expect(await loadInvoiceDoc(db, { organizationId: org, invoiceId: draftId, clientId: acme })).toBeNull(); // drafts are internal
    expect(await loadInvoiceDoc(db, { organizationId: "another-org", invoiceId })).toBeNull();
  });
});

describe("receipts, credit notes and statements", () => {
  it("a receipt comes from the recorded payment and shows what it settled", async () => {
    const t = pdfPlainText(await receiptPdf((await loadReceiptDoc(db, { organizationId: org, paymentId }))!, { compress: false }));
    expect(t).toContain("RCT-000001");
    expect(t).toContain("USD 400.00");
    expect(t).toContain("TT-77");
    expect(await loadReceiptDoc(db, { organizationId: org, paymentId, clientId: other })).toBeNull();
    expect(await loadReceiptDoc(db, { organizationId: org, paymentId, clientId: acme })).not.toBeNull();
  });
  it("a credit note document matches the credit that was posted", async () => {
    const cn = await issueCreditNote(db, { organizationId: org, invoiceId, amount: "110", reason: "Goodwill", actorId: actor, idempotencyKey: "pdf-cn" });
    const t = pdfPlainText(await creditNotePdf((await loadCreditNoteDoc(db, { organizationId: org, creditNoteId: cn.id }))!, { compress: false }));
    expect(t).toContain("CN-000001");
    expect(t).toContain("USD 110.00");
    expect(t).toContain("Goodwill");
    expect(await loadCreditNoteDoc(db, { organizationId: org, creditNoteId: cn.id, clientId: other })).toBeNull();
  });
  it("the statement running balance matches the ledger", async () => {
    const doc = await loadStatementDoc(db, { organizationId: org, clientId: acme });
    expect(doc!.rows.at(-1)!.balance).toBe("590"); // 1100 invoiced - 400 paid - 110 credited
    const t = pdfPlainText(await statementPdf(doc!, { compress: false }));
    expect(t).toContain("USD 590.00");
    expect(await loadStatementDoc(db, { organizationId: org, clientId: "nope" })).toBeNull();
  });
  it("vouchers load only inside their organization", async () => {
    expect(await loadVoucherDoc(db, { organizationId: org, voucherId: "missing" })).toBeNull();
  });
});
