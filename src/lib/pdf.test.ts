import { describe, expect, it } from "vitest";
import {
  DEFAULT_DOC_CONFIG, creditNotePdf, invoicePdf, mergeConfig, payslipPdf, pdfMoney, pdfText, receiptPdf, statementPdf, voucherPdf,
  type Company, type InvoiceDoc,
} from "./pdf";
import { pdfPlainText } from "./pdf-text.testutil";

const company: Company = {
  legalName: "Hifi Marketing and Technologies", registeredOffice: "7901 4TH ST N, STE T, St. Petersburg, FL 33702", salesCentre: "PZT Tower, Islamabad",
  globalUan: "+1 778-652-1616", localUan: "+92 316 8080801", taxId: "TAX-123", invoiceFooter: "Thank you for your business.",
};

const invoice = (over: Partial<InvoiceDoc> = {}): InvoiceDoc => ({
  number: "INV-000042", status: "ISSUED", currency: "USD", issueDate: new Date("2026-10-11"), dueDate: new Date("2026-10-25"), notes: "Net 14",
  client: { name: "Acme Demo Client", billingAddress: "1 Main St", taxId: null },
  lines: [{ description: "Social Pro (monthly)", quantity: "2", unitPrice: "1499.00", amount: "2998.00" }, { description: "Setup", quantity: "1", unitPrice: "250.50", amount: "250.50" }],
  subtotal: "3248.50", taxRate: "5", taxAmount: "162.43", total: "3410.93", amountPaid: "1000.00", creditedAmount: "410.93",
  company, bank: { bankName: "Test Bank", accountHolder: "Hifi", accountNumber: "000011112222", iban: "PK00TEST", swift: "TESTPKKA" }, config: DEFAULT_DOC_CONFIG, templateVersion: 3, ...over,
});

describe("formatting helpers", () => {
  it("formats money as plain text with grouping and a minus sign", () => {
    expect(pdfMoney("3410.93", "USD")).toBe("USD 3,410.93");
    expect(pdfMoney(-5, "PKR")).toBe("PKR -5.00".replace("PKR -", "-PKR "));
    expect(pdfMoney(0, "AED")).toBe("AED 0.00");
  });
  it("replaces characters the PDF font cannot show and says so", () => {
    expect(pdfText("Cafe ñ £ 5")).toEqual({ text: "Cafe ñ £ 5", lossy: false });
    expect(pdfText("احمد خان")).toEqual({ text: "???? ???", lossy: true });
  });
  it("merges settings with defaults and ignores bad values", () => {
    expect(mergeConfig({ showBank: false, accent: "not-a-colour", footerText: "Hi" } as never)).toMatchObject({ showBank: false, accent: DEFAULT_DOC_CONFIG.accent, footerText: "Hi", showPhones: true });
    expect(mergeConfig({ showBank: "yes" } as never).showBank).toBe(true);
    expect(mergeConfig(null)).toEqual(DEFAULT_DOC_CONFIG);
  });
});

describe("documents", () => {
  it("an invoice is a real PDF with the number, lines, totals, balance and bank details", async () => {
    const buf = await invoicePdf(invoice(), { compress: false });
    expect(buf.subarray(0, 5).toString()).toBe("%PDF-");
    const t = pdfPlainText(buf);
    for (const needle of ["INVOICE", "INV-000042", "Acme Demo Client", "Social Pro (monthly)", "USD 3,248.50", "Tax (5%)", "USD 162.43", "USD 3,410.93", "Credited", "USD 410.93", "Balance due", "USD 2,000.00", "Test Bank", "000011112222", "Template v3", "Thank you for your business."]) {
      expect(t, needle).toContain(needle);
    }
  });
  it("a draft says it is not issued", async () => {
    const t = pdfPlainText(await invoicePdf(invoice({ number: null, status: "DRAFT", issueDate: null, dueDate: null }), { compress: false }));
    expect(t).toContain("DRAFT (not issued)");
  });
  it("template settings hide company details and bank instructions", async () => {
    const t = pdfPlainText(await invoicePdf(invoice({ config: mergeConfig({ showBank: false, showPhones: false, showTaxId: false }) }), { compress: false }));
    expect(t).not.toContain("000011112222");
    expect(t).not.toContain("+1 778-652-1616");
    expect(t).not.toContain("TAX-123");
    expect(t).toContain("7901 4TH ST N"); // still shown
  });
  it("long invoices continue onto more pages with page numbers", async () => {
    const lines = Array.from({ length: 60 }, (_, i) => ({ description: `Service line ${i + 1}`, quantity: "1", unitPrice: "10.00", amount: "10.00" }));
    const buf = await invoicePdf(invoice({ lines }), { compress: false });
    expect((buf.toString("latin1").match(/\/Type \/Page\b/g) ?? []).length).toBeGreaterThanOrEqual(2);
    expect(pdfPlainText(buf)).toContain("Page 2 of");
  });
  it("shows a notice when text could not be printed", async () => {
    const t = pdfPlainText(await invoicePdf(invoice({ client: { name: "احمد خان" } }), { compress: false }));
    expect(t).toContain("could not be shown in this PDF");
  });
  it("credit note, receipt, statement, payslip and voucher all render with their key facts", async () => {
    const cn = pdfPlainText(await creditNotePdf({ number: "CN-000001", date: new Date("2026-10-12"), currency: "USD", amount: "220.00", taxPortion: "20.00", reason: "Service not delivered", invoiceNumber: "INV-000042", client: { name: "Acme" }, company, config: DEFAULT_DOC_CONFIG }, { compress: false }));
    expect(cn).toContain("CREDIT NOTE"); expect(cn).toContain("USD 220.00"); expect(cn).toContain("INV-000042");
    const rc = pdfPlainText(await receiptPdf({ number: "RCT-000001", date: new Date("2026-10-12"), currency: "USD", amount: "1000.00", unallocated: "50.00", method: "BANK_TRANSFER", reference: "TT-9", client: { name: "Acme" }, allocations: [{ invoiceNumber: "INV-000042", amount: "950.00" }], company, config: DEFAULT_DOC_CONFIG }, { compress: false }));
    expect(rc).toContain("PAYMENT RECEIPT"); expect(rc).toContain("USD 950.00"); expect(rc).toContain("Held on account"); expect(rc).toContain("TT-9");
    const st = pdfPlainText(await statementPdf({ client: { name: "Acme", code: "C-0001" }, asOf: new Date("2026-10-12"), company, config: DEFAULT_DOC_CONFIG, advances: [{ currency: "USD", amount: "50.00" }], rows: [{ date: new Date("2026-10-11"), number: "JE-000001", description: "Invoice INV-000042", debit: "3410.93", credit: "0", balance: "3410.93", currency: "USD" }, { date: new Date("2026-10-12"), number: "JE-000002", description: "Receipt", debit: "0", credit: "1000.00", balance: "2410.93", currency: "USD" }] }, { compress: false }));
    expect(st).toContain("ACCOUNT STATEMENT"); expect(st).toContain("USD 2,410.93"); expect(st).toContain("Credit held on account: USD 50.00");
    const ps = pdfPlainText(await payslipPdf({ period: "2026-10", currency: "PKR", status: "PAID", employee: { name: "Demo Designer", employeeNo: "E-0001" }, basic: "110000", allowance: "10000", bonus: "0", unpaidDeduction: "0", unpaidDays: "0", workingDays: 22, gross: "120000", taxPercent: "5", tax: "6000", net: "114000", company, config: DEFAULT_DOC_CONFIG }, { compress: false }));
    expect(ps).toContain("PAYSLIP 2026-10"); expect(ps).toContain("PKR 114,000.00"); expect(ps).toContain("Confidential");
    expect(ps).not.toContain("Commissions"); // a zero commission line is left out
    const pc = pdfPlainText(await payslipPdf({ period: "2026-11", currency: "PKR", status: "PAID", employee: { name: "Demo Designer" }, basic: "110000", allowance: "10000", bonus: "0", commission: "12000", unpaidDeduction: "0", unpaidDays: "0", workingDays: 22, gross: "132000", taxPercent: "5", tax: "6600", net: "125400", company, config: DEFAULT_DOC_CONFIG }, { compress: false }));
    expect(pc).toContain("Commissions and approved bonuses"); expect(pc).toContain("PKR 12,000.00"); expect(pc).toContain("PKR 125,400.00");
    const vc = pdfPlainText(await voucherPdf({ number: "VCH-000001", date: "2026-10-12", status: "APPROVED", currency: "PKR", amount: "800", payee: "Ad Platform Ltd", description: "Facebook ads", category: "6000 Marketing Expense", submittedBy: "Sam", reviewedBy: "Rae", approvedBy: "Lee", company, config: DEFAULT_DOC_CONFIG }, { compress: false }));
    expect(vc).toContain("EXPENSE VOUCHER"); expect(vc).toContain("PKR 800.00"); expect(vc).toContain("Approved by");
  });
});
