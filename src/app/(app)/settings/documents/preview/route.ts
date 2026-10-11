import { requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";
import { creditNotePdf, invoicePdf, payslipPdf, receiptPdf, statementPdf, voucherPdf } from "@/lib/pdf";
import { DOC_TYPES, companyFrom, getDocConfig, type DocType } from "@/lib/pdf-data";
import { notFound, pdfResponse } from "@/lib/pdf-response";

export const dynamic = "force-dynamic";

// A preview built from sample figures and the current company profile and template. Nothing real is shown or saved.
export async function GET(req: Request) {
  const user = await requirePermission("settings.company.view");
  const type = (new URL(req.url).searchParams.get("type") ?? "INVOICE") as DocType;
  if (!DOC_TYPES.includes(type)) return notFound();
  const profile = await db.companyProfile.findFirst({ where: { organizationId: user.organizationId, isDefault: true } });
  const company = companyFrom(profile as unknown as Record<string, unknown>);
  const { config } = await getDocConfig(db, user.organizationId, type);
  const bank = await db.bankAccount.findFirst({ where: { organizationId: user.organizationId, active: true, isDefault: true } });
  const sampleBank = bank ? { bankName: bank.bankName, accountHolder: bank.accountHolder, accountNumber: "SAMPLE-0000", paymentInstructions: bank.paymentInstructions } : { bankName: "Sample Bank", accountHolder: company.legalName, accountNumber: "SAMPLE-0000" };
  const d = new Date();
  let pdf: Buffer;
  if (type === "INVOICE") {
    pdf = await invoicePdf({ number: "INV-SAMPLE", status: "ISSUED", currency: "USD", issueDate: d, dueDate: d, notes: "Sample notes.", client: { name: "Sample Client Ltd", billingAddress: "1 Example Street" },
      lines: [{ description: "Sample service", quantity: "2", unitPrice: "500.00", amount: "1000.00" }], subtotal: "1000.00", taxRate: "5", taxAmount: "50.00", total: "1050.00", amountPaid: "0", creditedAmount: "0", company, bank: sampleBank, config });
  } else if (type === "RECEIPT") {
    pdf = await receiptPdf({ number: "RCT-SAMPLE", date: d, currency: "USD", amount: "500.00", unallocated: "0", method: "BANK_TRANSFER", reference: "SAMPLE", client: { name: "Sample Client Ltd" }, allocations: [{ invoiceNumber: "INV-SAMPLE", amount: "500.00" }], company, config });
  } else if (type === "CREDIT_NOTE") {
    pdf = await creditNotePdf({ number: "CN-SAMPLE", date: d, currency: "USD", amount: "105.00", taxPortion: "5.00", reason: "Sample reason", invoiceNumber: "INV-SAMPLE", client: { name: "Sample Client Ltd" }, company, config });
  } else if (type === "STATEMENT") {
    pdf = await statementPdf({ client: { name: "Sample Client Ltd", code: "C-0000" }, asOf: d, company, config, advances: [], rows: [{ date: d, number: "JE-SAMPLE", description: "Sample invoice", debit: "1050.00", credit: "0", balance: "1050.00", currency: "USD" }] });
  } else if (type === "PAYSLIP") {
    pdf = await payslipPdf({ period: d.toISOString().slice(0, 7), currency: "USD", status: "PAID", employee: { name: "Sample Employee", employeeNo: "E-0000" }, basic: "1000", allowance: "100", bonus: "0", unpaidDeduction: "0", unpaidDays: "0", workingDays: 22, gross: "1100", taxPercent: "5", tax: "55", net: "1045", company, config });
  } else {
    pdf = await voucherPdf({ number: "VCH-SAMPLE", date: d.toISOString().slice(0, 10), status: "APPROVED", currency: "USD", amount: "250.00", payee: "Sample Supplier", description: "Sample expense", category: "6000 Marketing Expense", submittedBy: "Sample Person", reviewedBy: "Reviewer", approvedBy: "Approver", company, config });
  }
  return pdfResponse(pdf, `preview-${type.toLowerCase()}`);
}
