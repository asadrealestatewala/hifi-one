// Quotations, subscriptions and contracts.
// Quotes move DRAFT -> SENT -> ACCEPTED -> INVOICED (or DECLINED / EXPIRED / CANCELLED). Every transition is a single
// conditional update, so two people (or a double click) can never both succeed. Accepting a quote creates no ledger entry;
// it becomes money only when it is converted to a draft invoice and that invoice is issued.
// Subscriptions create one DRAFT invoice per due period (never issued automatically) and are safe to run any number of times.
import type { Prisma, PrismaClient } from "@prisma/client";
import { createDraftInvoice, LedgerError, nextNumber } from "./accounting";
import { computeInvoiceTotals, dec } from "./ledger-math";
import { CURRENCIES } from "./money";

export class SalesError extends Error {}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const validDate = (d: string) => DATE.test(d) && !Number.isNaN(Date.parse(d));
const money = /^\d{1,10}(\.\d{1,2})?$/;
type Db = PrismaClient;

// ---------- dates ----------
export function addMonths(date: string, months: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const total = (m - 1) + months;
  const ny = y + Math.floor(total / 12);
  const nm = ((total % 12) + 12) % 12;
  const last = new Date(Date.UTC(ny, nm + 1, 0)).getUTCDate();
  return `${ny}-${String(nm + 1).padStart(2, "0")}-${String(Math.min(d, last)).padStart(2, "0")}`;
}
const STEP: Record<string, number> = { MONTHLY: 1, QUARTERLY: 3, ANNUAL: 12 };
// The start of billing period n, always counted from the original start date so the day of month never drifts.
export const periodStart = (start: string, interval: string, n: number) => addMonths(start, n * STEP[interval]);
const dayBefore = (d: string) => new Date(Date.parse(d) - 86400000).toISOString().slice(0, 10);

// ---------- quotes ----------
type LineIn = { description: string; quantity: string; unitPrice: string; planId?: string; planVersion?: number };

function checkLines(lines: LineIn[]) {
  if (lines.length === 0) throw new SalesError("Add at least one line.");
  for (const [i, l] of lines.entries()) {
    if (!l.description.trim() || !money.test(l.quantity) || !money.test(l.unitPrice)) throw new SalesError(`Line ${i + 1}: enter a description, a quantity and a unit price.`);
    if (dec(l.quantity).lte(0)) throw new SalesError(`Line ${i + 1}: the quantity must be greater than zero.`);
  }
}

export async function createQuote(db: Db, p: {
  organizationId: string; clientId: string; currency: string; taxRate: string; validUntil?: string | null; notes?: string | null; terms?: string | null; createdById: string; lines: LineIn[];
}) {
  checkLines(p.lines);
  if (!(CURRENCIES as readonly string[]).includes(p.currency)) throw new SalesError("Choose a supported currency.");
  if (!/^\d{1,3}(\.\d{1,2})?$/.test(p.taxRate)) throw new SalesError("Enter a valid tax rate.");
  if (p.validUntil && !validDate(p.validUntil)) throw new SalesError("Enter a valid date for 'valid until'.");
  const client = await db.client.findFirst({ where: { id: p.clientId, organizationId: p.organizationId } });
  if (!client) throw new SalesError("Unknown client.");
  const t = computeInvoiceTotals(p.lines, p.taxRate);
  if (t.total.lte(0)) throw new SalesError("The quote total must be greater than zero.");
  return db.$transaction(async (tx) => {
    const number = await nextNumber(tx, p.organizationId, "QT", "QT");
    return tx.quote.create({
      data: {
        organizationId: p.organizationId, number, clientId: p.clientId, currency: p.currency, taxRate: p.taxRate, validUntil: p.validUntil || null,
        notes: p.notes || null, terms: p.terms || null, subtotal: t.subtotal, taxAmount: t.taxAmount, total: t.total, createdById: p.createdById,
        lines: { create: p.lines.map((l, i) => ({ description: l.description.trim(), quantity: l.quantity, unitPrice: l.unitPrice, amount: t.amounts[i], planId: l.planId ?? null, planVersion: l.planVersion ?? null })) },
      },
    });
  });
}

// Open quotes past their validity date can no longer be accepted.
export async function expireQuotes(db: Db, organizationId: string, today: string) {
  const r = await db.quote.updateMany({ where: { organizationId, status: "SENT", validUntil: { lt: today } }, data: { status: "EXPIRED" } });
  return r.count;
}

async function transition(db: Db, p: { organizationId: string; quoteId: string; from: string[]; data: Prisma.QuoteUpdateManyMutationInput; clientId?: string; what: string }) {
  const r = await db.quote.updateMany({
    where: { id: p.quoteId, organizationId: p.organizationId, status: { in: p.from }, ...(p.clientId ? { clientId: p.clientId } : {}) }, data: p.data,
  });
  if (r.count === 0) {
    const q = await db.quote.findFirst({ where: { id: p.quoteId, organizationId: p.organizationId, ...(p.clientId ? { clientId: p.clientId } : {}) }, select: { status: true } });
    if (!q) throw new SalesError("Quote not found.");
    throw new SalesError(`This quote is ${q.status.toLowerCase()} and cannot be ${p.what}.`);
  }
}

export async function sendQuote(db: Db, p: { organizationId: string; quoteId: string }) {
  return transition(db, { ...p, from: ["DRAFT"], data: { status: "SENT", sentAt: new Date() }, what: "sent" });
}

export async function cancelQuote(db: Db, p: { organizationId: string; quoteId: string }) {
  return transition(db, { ...p, from: ["DRAFT", "SENT"], data: { status: "CANCELLED" }, what: "cancelled" });
}

// A client decides through the portal (clientId set); staff may record a decision received by email or phone.
export async function decideQuote(db: Db, p: {
  organizationId: string; quoteId: string; decision: "ACCEPT" | "DECLINE"; byUserId: string; via: "PORTAL" | "STAFF"; clientId?: string; note?: string; today: string;
}) {
  await expireQuotes(db, p.organizationId, p.today);
  return transition(db, {
    organizationId: p.organizationId, quoteId: p.quoteId, clientId: p.clientId, from: ["SENT"], what: p.decision === "ACCEPT" ? "accepted" : "declined",
    data: { status: p.decision === "ACCEPT" ? "ACCEPTED" : "DECLINED", decidedAt: new Date(), decidedById: p.byUserId, decidedVia: p.via, decisionNote: p.note?.slice(0, 500) || null },
  });
}

export async function convertQuoteToInvoice(db: Db, p: { organizationId: string; quoteId: string; actorId: string }) {
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Quote" WHERE id = ${p.quoteId} FOR UPDATE`;
    const q = await tx.quote.findFirst({ where: { id: p.quoteId, organizationId: p.organizationId }, include: { lines: true } });
    if (!q) throw new SalesError("Quote not found.");
    if (q.status === "INVOICED" && q.invoiceId) return { invoiceId: q.invoiceId, already: true };
    if (q.status !== "ACCEPTED") throw new SalesError("Only an accepted quote can be converted to an invoice.");
    let invoice;
    try {
      invoice = await createDraftInvoice(tx as unknown as PrismaClient, {
        organizationId: p.organizationId, clientId: q.clientId, currency: q.currency, taxRate: q.taxRate.toString(), createdById: p.actorId,
        notes: [`From quotation ${q.number}`, q.notes].filter(Boolean).join("\n"),
        lines: q.lines.map((l) => ({ description: l.description, quantity: l.quantity.toString(), unitPrice: l.unitPrice.toString() })),
      });
    } catch (e) {
      if (e instanceof LedgerError) throw new SalesError(e.message);
      throw e;
    }
    await tx.quote.update({ where: { id: q.id }, data: { status: "INVOICED", invoiceId: invoice.id } });
    return { invoiceId: invoice.id, already: false };
  });
}

// ---------- subscriptions ----------
export async function createSubscription(db: Db, p: {
  organizationId: string; clientId: string; name: string; currency: string; amount: string; taxRate: string; interval: string; startDate: string; endDate?: string | null; createdById: string;
}) {
  if (!p.name.trim()) throw new SalesError("Give the subscription a name.");
  if (!(CURRENCIES as readonly string[]).includes(p.currency)) throw new SalesError("Choose a supported currency.");
  if (!money.test(p.amount) || dec(p.amount).lte(0)) throw new SalesError("Enter the amount charged each period.");
  if (!/^\d{1,3}(\.\d{1,2})?$/.test(p.taxRate)) throw new SalesError("Enter a valid tax rate.");
  if (!(p.interval in STEP)) throw new SalesError("Choose monthly, quarterly or annual.");
  if (!validDate(p.startDate)) throw new SalesError("Enter a valid start date.");
  if (p.endDate && (!validDate(p.endDate) || p.endDate < p.startDate)) throw new SalesError("The end date must be on or after the start date.");
  if (!(await db.client.findFirst({ where: { id: p.clientId, organizationId: p.organizationId } }))) throw new SalesError("Unknown client.");
  return db.subscription.create({
    data: {
      organizationId: p.organizationId, clientId: p.clientId, name: p.name.trim().slice(0, 120), currency: p.currency, amount: p.amount, taxRate: p.taxRate, interval: p.interval,
      startDate: p.startDate, endDate: p.endDate || null, nextBillingDate: p.startDate, createdById: p.createdById,
    },
  });
}

export async function setSubscriptionStatus(db: Db, p: { organizationId: string; subscriptionId: string; action: "PAUSE" | "RESUME" | "CANCEL"; today: string }) {
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Subscription" WHERE id = ${p.subscriptionId} FOR UPDATE`;
    const s = await tx.subscription.findFirst({ where: { id: p.subscriptionId, organizationId: p.organizationId } });
    if (!s) throw new SalesError("Subscription not found.");
    if (p.action === "PAUSE") {
      if (s.status !== "ACTIVE") throw new SalesError("Only an active subscription can be paused.");
      return tx.subscription.update({ where: { id: s.id }, data: { status: "PAUSED" } });
    }
    if (p.action === "CANCEL") {
      if (s.status === "CANCELLED" || s.status === "ENDED") throw new SalesError("This subscription has already finished.");
      return tx.subscription.update({ where: { id: s.id }, data: { status: "CANCELLED", nextBillingDate: null } });
    }
    if (s.status !== "PAUSED") throw new SalesError("Only a paused subscription can be resumed.");
    // Periods that passed while paused are skipped, not billed: billing restarts with the first period starting today or later.
    let n = s.cyclesBilled;
    while (periodStart(s.startDate, s.interval, n) < p.today) n++;
    const next = periodStart(s.startDate, s.interval, n);
    const over = s.endDate !== null && next > s.endDate;
    return tx.subscription.update({ where: { id: s.id }, data: { status: over ? "ENDED" : "ACTIVE", cyclesBilled: n, nextBillingDate: over ? null : next } });
  });
}

// Creates a draft invoice for every billing period that has come due. Running it again creates nothing new.
export async function generateDueInvoices(db: Db, p: { organizationId: string; today: string; actorId: string }) {
  const due = await db.subscription.findMany({
    where: { organizationId: p.organizationId, status: "ACTIVE", nextBillingDate: { lte: p.today } }, select: { id: true },
  });
  const created: { subscriptionId: string; invoiceId: string; periodStart: string }[] = [];
  for (const { id } of due) {
    await db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Subscription" WHERE id = ${id} FOR UPDATE`;
      for (let guard = 0; guard < 12; guard++) {
        const s = await tx.subscription.findUniqueOrThrow({ where: { id } });
        if (s.status !== "ACTIVE" || !s.nextBillingDate || s.nextBillingDate > p.today) break;
        const start = s.nextBillingDate;
        if (s.endDate && start > s.endDate) { await tx.subscription.update({ where: { id }, data: { status: "ENDED", nextBillingDate: null } }); break; }
        const nextCycle = s.cyclesBilled + 1;
        const nextStart = periodStart(s.startDate, s.interval, nextCycle);
        const inv = await createDraftInvoice(tx as unknown as PrismaClient, {
          organizationId: s.organizationId, clientId: s.clientId, currency: s.currency, taxRate: s.taxRate.toString(), createdById: p.actorId,
          notes: `Subscription: ${s.name}`,
          lines: [{ description: `${s.name} (${start} to ${dayBefore(nextStart)})`, quantity: "1", unitPrice: s.amount.toString() }],
        });
        await tx.subscriptionInvoice.create({ data: { subscriptionId: id, periodStart: start, invoiceId: inv.id } });
        const finished = s.endDate !== null && nextStart > s.endDate;
        await tx.subscription.update({ where: { id }, data: { cyclesBilled: nextCycle, nextBillingDate: finished ? null : nextStart, status: finished ? "ENDED" : "ACTIVE" } });
        created.push({ subscriptionId: id, invoiceId: inv.id, periodStart: start });
      }
    });
  }
  return created;
}

// ---------- contracts ----------
export async function createContract(db: Db, p: {
  organizationId: string; clientId: string; title: string; startDate?: string | null; endDate?: string | null; renewalNoticeDays?: number; currency?: string | null; value?: string | null; notes?: string | null; createdById: string;
}) {
  if (!p.title.trim()) throw new SalesError("Give the contract a title.");
  if (p.startDate && !validDate(p.startDate)) throw new SalesError("Enter a valid start date.");
  if (p.endDate && !validDate(p.endDate)) throw new SalesError("Enter a valid end date.");
  if (p.startDate && p.endDate && p.endDate < p.startDate) throw new SalesError("The end date must be on or after the start date.");
  const notice = p.renewalNoticeDays ?? 30;
  if (!Number.isInteger(notice) || notice < 0 || notice > 365) throw new SalesError("Renewal notice must be between 0 and 365 days.");
  if (p.value && (!money.test(p.value) || !p.currency || !(CURRENCIES as readonly string[]).includes(p.currency))) throw new SalesError("Enter the contract value with a currency.");
  if (!(await db.client.findFirst({ where: { id: p.clientId, organizationId: p.organizationId } }))) throw new SalesError("Unknown client.");
  return db.contract.create({
    data: {
      organizationId: p.organizationId, clientId: p.clientId, title: p.title.trim().slice(0, 160), startDate: p.startDate || null, endDate: p.endDate || null, renewalNoticeDays: notice,
      currency: p.value ? p.currency! : null, value: p.value || null, notes: p.notes?.slice(0, 2000) || null, createdById: p.createdById,
    },
  });
}

const CONTRACT_NEXT: Record<string, string[]> = { DRAFT: ["ACTIVE", "TERMINATED"], ACTIVE: ["TERMINATED", "EXPIRED"], EXPIRED: ["ACTIVE"], TERMINATED: [] };
export async function setContractStatus(db: Db, p: { organizationId: string; contractId: string; to: string }) {
  const c = await db.contract.findFirst({ where: { id: p.contractId, organizationId: p.organizationId } });
  if (!c) throw new SalesError("Contract not found.");
  if (!CONTRACT_NEXT[c.status]?.includes(p.to)) throw new SalesError(`A ${c.status.toLowerCase()} contract cannot become ${p.to.toLowerCase()}.`);
  const r = await db.contract.updateMany({ where: { id: c.id, status: c.status }, data: { status: p.to } });
  if (r.count === 0) throw new SalesError("The contract changed while you were editing. Reload and try again.");
}

// Active contracts whose end date has passed are marked expired.
export async function expireContracts(db: Db, organizationId: string, today: string) {
  const r = await db.contract.updateMany({ where: { organizationId, status: "ACTIVE", endDate: { lt: today } }, data: { status: "EXPIRED" } });
  return r.count;
}

export const daysUntil = (date: string, today: string) => Math.round((Date.parse(date) - Date.parse(today)) / 86400000);
