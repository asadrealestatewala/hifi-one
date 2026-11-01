// Emails a generated PDF (invoice, quotation or account statement) to a client, in the branded template (editable under
// Settings > Email templates). The PDF is built from the same loaders as
// the download links, so what is emailed is exactly what a person would download. Drafts and cancelled documents are never sent.
import type { PrismaClient } from "@prisma/client";
import { formatMoney } from "./money";
import { invoicePdf, quotePdf, statementPdf } from "./pdf";
import { loadInvoiceDoc, loadQuoteDoc, loadStatementDoc } from "./pdf-data";
import { MailError } from "./mailer";
import { appUrl, sendTemplate } from "./email-template-store";

type Db = PrismaClient;
const fmt = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : "");
const portal = () => `${appUrl()}/portal`;

export async function emailInvoice(db: Db, p: { organizationId: string; invoiceId: string; to: string; actorId: string }) {
  const doc = await loadInvoiceDoc(db, { organizationId: p.organizationId, invoiceId: p.invoiceId });
  if (!doc) throw new MailError("Invoice not found.");
  if (!doc.number || !["ISSUED", "PARTIALLY_PAID", "PAID"].includes(doc.status)) throw new MailError("Only an issued invoice can be emailed.");
  const balance = Number(doc.total) - Number(doc.amountPaid) - Number(doc.creditedAmount);
  return sendTemplate(db, {
    organizationId: p.organizationId, key: "invoice_sent", to: p.to, relatedType: "INVOICE", relatedId: p.invoiceId, actorId: p.actorId, buttonUrl: portal(),
    vars: { client_name: doc.client.name, number: doc.number, amount: formatMoney(doc.total, doc.currency), due_date: fmt(doc.dueDate), balance: balance > 0 && balance < Number(doc.total) ? formatMoney(balance, doc.currency) : "", company_name: doc.company.legalName },
    attachment: { filename: `invoice-${doc.number}.pdf`, content: await invoicePdf(doc), contentType: "application/pdf" },
  });
}

export async function emailQuote(db: Db, p: { organizationId: string; quoteId: string; to: string; actorId: string }) {
  const doc = await loadQuoteDoc(db, { organizationId: p.organizationId, quoteId: p.quoteId });
  if (!doc) throw new MailError("Quotation not found.");
  if (["DRAFT", "CANCELLED"].includes(doc.status)) throw new MailError("Mark the quotation as sent before emailing it.");
  return sendTemplate(db, {
    organizationId: p.organizationId, key: "quote_sent", to: p.to, relatedType: "QUOTE", relatedId: p.quoteId, actorId: p.actorId, buttonUrl: portal(),
    vars: { client_name: doc.client.name, number: doc.number, amount: formatMoney(doc.total, doc.currency), valid_until: doc.validUntil ?? "", company_name: doc.company.legalName },
    attachment: { filename: `quotation-${doc.number}.pdf`, content: await quotePdf(doc), contentType: "application/pdf" },
  });
}

export async function emailStatement(db: Db, p: { organizationId: string; clientId: string; to: string; actorId: string }) {
  const doc = await loadStatementDoc(db, { organizationId: p.organizationId, clientId: p.clientId });
  if (!doc) throw new MailError("Client not found.");
  return sendTemplate(db, {
    organizationId: p.organizationId, key: "statement_sent", to: p.to, relatedType: "STATEMENT", relatedId: p.clientId, actorId: p.actorId, buttonUrl: portal(),
    vars: { client_name: doc.client.name, as_of: fmt(doc.asOf), company_name: doc.company.legalName },
    attachment: { filename: "account-statement.pdf", content: await statementPdf(doc), contentType: "application/pdf" },
  });
}
