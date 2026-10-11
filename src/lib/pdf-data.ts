// Loads the data each PDF needs, always scoped (to the organization, and for portal users to their own client),
// and returns null when the record does not exist or is not theirs. Free of Next.js imports.
import type { PrismaClient } from "@prisma/client";
import { clientStatement } from "./accounting";
import { DEFAULT_DOC_CONFIG, mergeConfig, type Bank, type Company, type CreditNoteDoc, type DocConfig, type InvoiceDoc, type PayslipDoc, type ReceiptDoc, type QuoteDoc, type StatementDoc, type VoucherDoc } from "./pdf";

type Json = Record<string, unknown> | null | undefined;

export type DocType = "QUOTE" | "INVOICE" | "RECEIPT" | "CREDIT_NOTE" | "STATEMENT" | "PAYSLIP" | "VOUCHER";
export const DOC_TYPES: DocType[] = ["QUOTE", "INVOICE", "RECEIPT", "CREDIT_NOTE", "STATEMENT", "PAYSLIP", "VOUCHER"];

export async function getDocConfig(db: PrismaClient, organizationId: string, docType: DocType): Promise<{ config: DocConfig; version: number }> {
  const row = await db.documentSetting.findUnique({ where: { organizationId_docType: { organizationId, docType } } });
  return { config: mergeConfig(row?.config as Partial<DocConfig> | undefined), version: row?.version ?? 0 };
}

const str = (v: unknown) => (typeof v === "string" ? v : v == null ? null : String(v));

export function companyFrom(p: Json): Company {
  return {
    legalName: str(p?.legalName) ?? "Company", registeredOffice: str(p?.registeredOffice), salesCentre: str(p?.salesCentre), globalUan: str(p?.globalUan), localUan: str(p?.localUan),
    email: str(p?.email), website: str(p?.website), registrationNo: str(p?.registrationNo), taxId: str(p?.taxId), legalNotice: str(p?.legalNotice), invoiceFooter: str(p?.invoiceFooter),
  };
}

const liveCompany = async (db: PrismaClient, organizationId: string) => companyFrom((await db.companyProfile.findFirst({ where: { organizationId, isDefault: true } })) as unknown as Json);

export async function loadInvoiceDoc(db: PrismaClient, p: { organizationId: string; invoiceId: string; clientId?: string }): Promise<InvoiceDoc | null> {
  const inv = await db.invoice.findFirst({
    where: { id: p.invoiceId, organizationId: p.organizationId, ...(p.clientId ? { clientId: p.clientId, status: { in: ["ISSUED", "PARTIALLY_PAID", "PAID", "CREDITED"] } } : {}) },
    include: { client: true, lines: true },
  });
  if (!inv) return null;
  // Issued invoices use the details frozen when they were issued; drafts use today's settings
  const snap = inv.companySnapshot as Json;
  const company = snap ? companyFrom(snap) : await liveCompany(db, p.organizationId);
  const tpl = snap?._template as { config?: Partial<DocConfig>; version?: number } | undefined;
  const live = tpl ? null : await getDocConfig(db, p.organizationId, "INVOICE");
  return {
    number: inv.number, status: inv.status, currency: inv.currency, issueDate: inv.issueDate, dueDate: inv.dueDate, notes: inv.notes,
    client: { name: inv.client.name, billingAddress: inv.client.billingAddress, taxId: inv.client.taxId, email: inv.client.email },
    lines: inv.lines.map((l) => ({ description: l.description, quantity: l.quantity.toString(), unitPrice: l.unitPrice.toString(), amount: l.amount.toString() })),
    subtotal: inv.subtotal.toString(), taxRate: inv.taxRate.toString(), taxAmount: inv.taxAmount.toString(), total: inv.total.toString(),
    amountPaid: inv.amountPaid.toString(), creditedAmount: inv.creditedAmount.toString(),
    company, bank: (inv.bankSnapshot as Bank | null) ?? null, config: tpl ? mergeConfig(tpl.config) : live!.config, templateVersion: tpl?.version ?? live?.version ?? null,
  };
}

// Clients only ever get quotes that were actually sent to them, never drafts.
export async function loadQuoteDoc(db: PrismaClient, p: { organizationId: string; quoteId: string; clientId?: string }): Promise<QuoteDoc | null> {
  const q = await db.quote.findFirst({
    where: { id: p.quoteId, organizationId: p.organizationId, ...(p.clientId ? { clientId: p.clientId, status: { notIn: ["DRAFT", "CANCELLED"] } } : {}) },
    include: { client: true, lines: true },
  });
  if (!q) return null;
  return {
    number: q.number, status: q.status, currency: q.currency, date: q.sentAt ?? q.createdAt, validUntil: q.validUntil, notes: q.notes, terms: q.terms,
    client: { name: q.client.name, billingAddress: q.client.billingAddress },
    lines: q.lines.map((l) => ({ description: l.description, quantity: l.quantity.toString(), unitPrice: l.unitPrice.toString(), amount: l.amount.toString() })),
    subtotal: q.subtotal.toString(), taxRate: q.taxRate.toString(), taxAmount: q.taxAmount.toString(), total: q.total.toString(),
    company: await liveCompany(db, p.organizationId), config: (await getDocConfig(db, p.organizationId, "QUOTE")).config,
  };
}

export async function loadCreditNoteDoc(db: PrismaClient, p: { organizationId: string; creditNoteId: string; clientId?: string }): Promise<CreditNoteDoc | null> {
  const cn = await db.creditNote.findFirst({ where: { id: p.creditNoteId, organizationId: p.organizationId, ...(p.clientId ? { clientId: p.clientId } : {}) }, include: { invoice: { include: { client: true } } } });
  if (!cn) return null;
  return {
    number: cn.number, date: cn.createdAt, currency: cn.currency, amount: cn.amount.toString(), taxPortion: cn.taxPortion.toString(), reason: cn.reason, invoiceNumber: cn.invoice.number,
    client: { name: cn.invoice.client.name, billingAddress: cn.invoice.client.billingAddress },
    company: (cn.invoice.companySnapshot ? companyFrom(cn.invoice.companySnapshot as Json) : await liveCompany(db, p.organizationId)),
    config: (await getDocConfig(db, p.organizationId, "CREDIT_NOTE")).config,
  };
}

export async function loadReceiptDoc(db: PrismaClient, p: { organizationId: string; paymentId: string; clientId?: string }): Promise<ReceiptDoc | null> {
  const pay = await db.payment.findFirst({
    where: { id: p.paymentId, organizationId: p.organizationId, ...(p.clientId ? { clientId: p.clientId } : {}) },
    include: { client: true, allocations: { include: { invoice: true } } },
  });
  if (!pay) return null;
  const by = pay.receivedById ? await db.user.findUnique({ where: { id: pay.receivedById }, select: { name: true } }) : null;
  return {
    number: pay.number, date: pay.date, currency: pay.currency, amount: pay.amount.toString(), unallocated: pay.unallocated.toString(), method: pay.method, reference: pay.reference,
    receivedBy: by?.name ?? null, client: { name: pay.client.name }, allocations: pay.allocations.map((a) => ({ invoiceNumber: a.invoice.number, amount: a.amount.toString() })),
    bankName: (pay.bankSnapshot as Json)?.internalName as string | undefined, company: await liveCompany(db, p.organizationId),
    config: (await getDocConfig(db, p.organizationId, "RECEIPT")).config,
  };
}

export async function loadStatementDoc(db: PrismaClient, p: { organizationId: string; clientId: string }): Promise<StatementDoc | null> {
  const client = await db.client.findFirst({ where: { id: p.clientId, organizationId: p.organizationId } });
  if (!client) return null;
  const st = await clientStatement(db, p.organizationId, client.id);
  return {
    client: { name: client.name, code: client.code }, asOf: new Date(), company: await liveCompany(db, p.organizationId), config: (await getDocConfig(db, p.organizationId, "STATEMENT")).config,
    rows: st.rows.map((r) => ({ date: r.date, number: r.number, description: r.description, debit: r.debit.toString(), credit: r.credit.toString(), balance: r.balance.toString(), currency: r.currency })),
    advances: st.advances.map((a) => ({ currency: a.currency, amount: a.amount.toString() })),
  };
}

export async function loadPayslipDoc(db: PrismaClient, p: { organizationId: string; itemId: string }): Promise<PayslipDoc | null> {
  const item = await db.payrollItem.findUnique({ where: { id: p.itemId }, include: { run: true } });
  if (!item || item.run.organizationId !== p.organizationId) return null;
  const [user, profile] = await Promise.all([db.user.findUnique({ where: { id: item.userId } }), db.employeeProfile.findUnique({ where: { userId: item.userId } })]);
  return {
    period: item.run.period, currency: item.run.currency, status: item.run.status, employee: { name: user?.name ?? "", employeeNo: profile?.employeeNo, designation: profile?.designation },
    basic: item.basic.toString(), allowance: item.allowance.toString(), bonus: item.bonus.toString(), unpaidDeduction: item.unpaidDeduction.toString(), unpaidDays: item.unpaidDays.toString(),
    workingDays: item.workingDays, gross: item.gross.toString(), taxPercent: item.taxPercent.toString(), tax: item.tax.toString(), net: item.net.toString(),
    company: await liveCompany(db, p.organizationId), config: (await getDocConfig(db, p.organizationId, "PAYSLIP")).config,
  };
}

export async function loadVoucherDoc(db: PrismaClient, p: { organizationId: string; voucherId: string }): Promise<VoucherDoc | null> {
  const v = await db.expenseVoucher.findFirst({ where: { id: p.voucherId, organizationId: p.organizationId } });
  if (!v) return null;
  const ids = [v.submittedById, v.reviewedById, v.approvedById, v.paidById].filter((x): x is string => Boolean(x));
  const [people, acct, project] = await Promise.all([
    db.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } }),
    db.account.findUnique({ where: { id: v.expenseAccountId } }),
    v.projectId ? db.project.findUnique({ where: { id: v.projectId } }) : Promise.resolve(null),
  ]);
  const name = (id: string | null) => people.find((x) => x.id === id)?.name ?? null;
  return {
    number: v.number, date: v.date, status: v.status, currency: v.currency, amount: v.amount.toString(), payee: v.payee, description: v.description, justification: v.justification,
    category: acct ? `${acct.code} ${acct.name}` : "", project: project ? `${project.number} ${project.name}` : null, submittedBy: name(v.submittedById) ?? "", reviewedBy: name(v.reviewedById),
    approvedBy: name(v.approvedById), paidBy: name(v.paidById), company: await liveCompany(db, p.organizationId), config: (await getDocConfig(db, p.organizationId, "VOUCHER")).config,
  };
}

export { DEFAULT_DOC_CONFIG };
