// Business events that create work or news for someone else, and who hears about them. Call these after the
// owning service has committed. Each one uses a dedupe key, so a retried action never notifies twice.
// Free of Next.js imports so it can be tested against the test database.
import type { PrismaClient } from "@prisma/client";
import { salesOwnerOf } from "./commissions";
import { formatMoney } from "./money";
import { notify, notifyMany, notifyPermission } from "./notifications";

type Db = PrismaClient;

const portalUsers = async (db: Db, where: { clientId: string } | { vendorId: string }) =>
  (await db.user.findMany({ where: { ...where, active: true }, select: { id: true } })).map((u) => u.id);

// A lead was given to someone other than the person who did it.
export async function leadAssigned(db: Db, p: { organizationId: string; leadId: string; toUserId: string | null; byUserId: string }) {
  if (!p.toUserId || p.toUserId === p.byUserId) return;
  const lead = await db.lead.findFirst({ where: { id: p.leadId, organizationId: p.organizationId }, select: { id: true, name: true, number: true } });
  if (!lead) return;
  await notify(db, p.toUserId, { kind: "lead.assigned", title: `Lead assigned to you: ${lead.name}`, body: `L-${lead.number}`, link: `/leads/${lead.id}`, dedupeKey: `lead-assigned:${lead.id}:${p.toUserId}` });
}

// Several contacts (and their open leads) were given to one person at once.
export async function contactsAssigned(db: Db, p: { toUserId: string; byUserId: string; count: number; batchKey: string }) {
  if (p.toUserId === p.byUserId || p.count === 0) return;
  await notify(db, p.toUserId, { kind: "contact.assigned", title: `${p.count} contact${p.count === 1 ? "" : "s"} assigned to you`, link: `/contacts?owner=${p.toUserId}`, dedupeKey: `contacts-assigned:${p.batchKey}` });
}

// An invoice was issued: the client's portal users can now see it.
export async function invoiceIssued(db: Db, p: { organizationId: string; invoiceId: string }) {
  const inv = await db.invoice.findFirst({ where: { id: p.invoiceId, organizationId: p.organizationId }, select: { id: true, number: true, clientId: true, total: true, currency: true, dueDate: true } });
  if (!inv?.number) return;
  await notifyMany(db, await portalUsers(db, { clientId: inv.clientId }), {
    kind: "invoice.issued", title: `New invoice ${inv.number}`, body: `${formatMoney(inv.total, inv.currency)}${inv.dueDate ? `, due ${inv.dueDate.toISOString().slice(0, 10)}` : ""}`,
    link: `/portal/invoices/${inv.id}`, dedupeKey: `invoice-issued:${inv.id}`,
  });
}

// Money arrived: the salesperson who won the client and the client's portal users hear about it.
export async function paymentReceived(db: Db, p: { organizationId: string; paymentId: string; actorId: string }) {
  const pay = await db.payment.findFirst({ where: { id: p.paymentId, organizationId: p.organizationId }, select: { id: true, number: true, clientId: true, amount: true, currency: true, client: { select: { name: true } } } });
  if (!pay) return;
  const amount = formatMoney(pay.amount, pay.currency);
  const owner = await salesOwnerOf(db, p.organizationId, pay.clientId);
  if (owner && owner !== p.actorId) await notify(db, owner, { kind: "payment.received", title: `${pay.client.name} paid ${amount}`, body: pay.number, link: "/finance/payments", dedupeKey: `payment-owner:${pay.id}` });
  await notifyMany(db, await portalUsers(db, { clientId: pay.clientId }), { kind: "payment.received", title: `Payment received: ${amount}`, body: `Receipt ${pay.number}`, link: "/portal/statement", dedupeKey: `payment-client:${pay.id}` });
}

// The client accepted or declined a quotation in the portal: whoever made it (or else the quote managers) hears.
export async function quoteDecided(db: Db, p: { organizationId: string; quoteId: string }) {
  const q = await db.quote.findFirst({ where: { id: p.quoteId, organizationId: p.organizationId }, select: { id: true, number: true, status: true, createdById: true, client: { select: { name: true } } } });
  if (!q || !["ACCEPTED", "DECLINED"].includes(q.status)) return;
  const n = { kind: `quote.${q.status.toLowerCase()}`, title: `${q.client.name} ${q.status === "ACCEPTED" ? "accepted" : "declined"} quotation ${q.number}`, link: `/quotes/${q.id}`, dedupeKey: `quote-decided:${q.id}` };
  if (q.createdById) await notify(db, q.createdById, n);
  else await notifyPermission(db, p.organizationId, "quotes.manage", n);
}

// Salaries were paid: each person on the run can open their payslip.
export async function payrollPaid(db: Db, p: { organizationId: string; runId: string }) {
  const run = await db.payrollRun.findFirst({ where: { id: p.runId, organizationId: p.organizationId, status: "PAID" }, select: { id: true, period: true } });
  if (!run) return;
  const items = await db.payrollItem.findMany({ where: { runId: run.id }, select: { userId: true } });
  for (const i of items) await notify(db, i.userId, { kind: "payroll.paid", title: `Your salary for ${run.period} has been paid`, link: "/me/payslips", dedupeKey: `payroll-paid:${run.id}:${i.userId}` });
}

// A vendor's bill moved (approved, rejected or paid): the vendor's portal users hear.
export async function vendorBillChanged(db: Db, p: { organizationId: string; billId: string }) {
  const b = await db.vendorBill.findFirst({ where: { id: p.billId, organizationId: p.organizationId }, select: { id: true, number: true, status: true, vendorId: true } });
  if (!b || !["APPROVED", "REJECTED", "PAID"].includes(b.status)) return;
  const what = b.status === "PAID" ? "has been paid" : b.status === "APPROVED" ? "was approved" : "was rejected";
  await notifyMany(db, await portalUsers(db, { vendorId: b.vendorId }), { kind: `vendor_bill.${b.status.toLowerCase()}`, title: `Bill ${b.number} ${what}`, link: "/vendor/work", dedupeKey: `vendor-bill:${b.id}:${b.status}` });
}
