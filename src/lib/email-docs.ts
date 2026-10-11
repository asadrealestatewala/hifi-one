// Emails a generated PDF (invoice, quotation or account statement) to a client. The PDF is built from the same loaders as
// the download links, so what is emailed is exactly what a person would download. Drafts and cancelled documents are never sent.
import type { PrismaClient } from "@prisma/client";
import { formatMoney } from "./money";
import { invoicePdf, quotePdf, statementPdf } from "./pdf";
import { loadInvoiceDoc, loadQuoteDoc, loadStatementDoc } from "./pdf-data";
import { MailError, sendEmail } from "./mailer";

type Db = PrismaClient;
const fmt = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : "");
const sign = (company: string) => `\nKind regards,\n${company}`;

export async function emailInvoice(db: Db, p: { organizationId: string; invoiceId: string; to: string; actorId: string }) {
  const doc = await loadInvoiceDoc(db, { organizationId: p.organizationId, invoiceId: p.invoiceId });
  if (!doc) throw new MailError("Invoice not found.");
  if (!doc.number || !["ISSUED", "PARTIALLY_PAID", "PAID"].includes(doc.status)) throw new MailError("Only an issued invoice can be emailed.");
  const balance = Number(doc.total) - Number(doc.amountPaid) - Number(doc.creditedAmount);
  const text = `Dear ${doc.client.name},\n\nPlease find attached invoice ${doc.number} for ${formatMoney(doc.total, doc.currency)}${doc.dueDate ? `, due on ${fmt(doc.dueDate)}` : ""}.${balance > 0 && balance < Number(doc.total) ? ` The balance outstanding is ${formatMoney(balance, doc.currency)}.` : ""}\n\nPayment details are on the invoice. If you have any questions, just reply to this email.\n${sign(doc.company.legalName)}`;
  return sendEmail(db, {
    organizationId: p.organizationId, to: p.to, subject: `Invoice ${doc.number} from ${doc.company.legalName}`, text, relatedType: "INVOICE", relatedId: p.invoiceId, actorId: p.actorId,
    attachment: { filename: `invoice-${doc.number}.pdf`, content: await invoicePdf(doc), contentType: "application/pdf" },
  });
}

export async function emailQuote(db: Db, p: { organizationId: string; quoteId: string; to: string; actorId: string }) {
  const doc = await loadQuoteDoc(db, { organizationId: p.organizationId, quoteId: p.quoteId });
  if (!doc) throw new MailError("Quotation not found.");
  if (["DRAFT", "CANCELLED"].includes(doc.status)) throw new MailError("Mark the quotation as sent before emailing it.");
  const text = `Dear ${doc.client.name},\n\nThank you for your interest. Please find attached quotation ${doc.number} for ${formatMoney(doc.total, doc.currency)}${doc.validUntil ? `, valid until ${doc.validUntil}` : ""}.\n\nYou can accept it from your client portal or reply to this email.\n${sign(doc.company.legalName)}`;
  return sendEmail(db, {
    organizationId: p.organizationId, to: p.to, subject: `Quotation ${doc.number} from ${doc.company.legalName}`, text, relatedType: "QUOTE", relatedId: p.quoteId, actorId: p.actorId,
    attachment: { filename: `quotation-${doc.number}.pdf`, content: await quotePdf(doc), contentType: "application/pdf" },
  });
}

export async function emailStatement(db: Db, p: { organizationId: string; clientId: string; to: string; actorId: string }) {
  const doc = await loadStatementDoc(db, { organizationId: p.organizationId, clientId: p.clientId });
  if (!doc) throw new MailError("Client not found.");
  const text = `Dear ${doc.client.name},\n\nPlease find attached your account statement as at ${fmt(doc.asOf)}.\n\nIf anything looks wrong, reply to this email and we will check it.\n${sign(doc.company.legalName)}`;
  return sendEmail(db, {
    organizationId: p.organizationId, to: p.to, subject: `Account statement from ${doc.company.legalName}`, text, relatedType: "STATEMENT", relatedId: p.clientId, actorId: p.actorId,
    attachment: { filename: "account-statement.pdf", content: await statementPdf(doc), contentType: "application/pdf" },
  });
}
