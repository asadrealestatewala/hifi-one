// Accounting service: the only place that creates journal entries, issues invoices
// and records payments. Everything runs in a database transaction and is idempotent.
// Deliberately free of Next.js imports so it can be tested directly against the database.
import { Prisma, type PrismaClient } from "@prisma/client";
import { periodLockMessage } from "./period-lock";
import {
  LedgerError, allocateFifo, assertBalanced, computeInvoiceTotals, dec, invoiceStatusAfterPayment, round2, type DraftLine,
} from "./ledger-math";

type Tx = Prisma.TransactionClient;
export { LedgerError };

export async function nextNumber(tx: Tx, organizationId: string, key: string, prefix: string) {
  const seq = await tx.numberSequence.upsert({
    where: { organizationId_key: { organizationId, key } },
    create: { organizationId, key, next: 2 },
    update: { next: { increment: 1 } },
  });
  return `${prefix}-${String(seq.next - 1).padStart(6, "0")}`;
}

async function systemAccount(tx: Tx, organizationId: string, systemKey: string) {
  const a = await tx.account.findFirst({ where: { organizationId, systemKey, active: true } });
  if (!a) throw new LedgerError(`Chart of accounts is missing the ${systemKey} account.`);
  return a;
}

export async function postJournal(
  tx: Tx,
  p: {
    organizationId: string;
    date: Date;
    memo?: string;
    currency: string;
    sourceType: string;
    sourceId?: string;
    idempotencyKey: string;
    postedById?: string;
    lines: DraftLine[];
    reversalOfId?: string;
  },
) {
  const existing = await tx.journalEntry.findUnique({ where: { idempotencyKey: p.idempotencyKey } });
  if (existing) return existing; // retry: return the original, never post twice
  assertBalanced(p.lines);
  // A closed period accepts no new postings, whatever module they come from
  const lock = await tx.periodLock.findUnique({ where: { organizationId: p.organizationId } });
  const blocked = periodLockMessage(lock?.lockedThrough, p.date);
  if (blocked) throw new LedgerError(blocked);
  const ids = [...new Set(p.lines.map((l) => l.accountId))];
  const found = await tx.account.count({ where: { id: { in: ids }, organizationId: p.organizationId, active: true } });
  if (found !== ids.length) throw new LedgerError("A line uses an unknown or inactive account.");
  const number = await nextNumber(tx, p.organizationId, "JE", "JE");
  return tx.journalEntry.create({
    data: {
      organizationId: p.organizationId, number, date: p.date, memo: p.memo, currency: p.currency,
      sourceType: p.sourceType, sourceId: p.sourceId, idempotencyKey: p.idempotencyKey,
      postedById: p.postedById, reversalOfId: p.reversalOfId,
      lines: {
        create: p.lines.map((l) => ({
          accountId: l.accountId, clientId: l.clientId ?? null, vendorId: l.vendorId ?? null, memo: l.memo,
          debit: round2(l.debit ?? 0), credit: round2(l.credit ?? 0),
        })),
      },
    },
  });
}

export async function createDraftInvoice(
  db: PrismaClient,
  p: {
    organizationId: string; clientId: string; currency: string; taxRate: string; notes?: string | null; createdById: string;
    lines: { description: string; quantity: string; unitPrice: string }[];
  },
) {
  if (p.lines.length === 0) throw new LedgerError("Add at least one line.");
  const client = await db.client.findFirst({ where: { id: p.clientId, organizationId: p.organizationId } });
  if (!client) throw new LedgerError("Unknown client.");
  const t = computeInvoiceTotals(p.lines, p.taxRate);
  if (t.total.lte(0)) throw new LedgerError("Invoice total must be greater than zero.");
  return db.invoice.create({
    data: {
      organizationId: p.organizationId, clientId: p.clientId, currency: p.currency, taxRate: p.taxRate, notes: p.notes,
      subtotal: t.subtotal, taxAmount: t.taxAmount, total: t.total, createdById: p.createdById,
      lines: {
        create: p.lines.map((l, i) => ({
          description: l.description, quantity: l.quantity, unitPrice: l.unitPrice, amount: t.amounts[i],
        })),
      },
    },
  });
}

export async function issueInvoice(db: PrismaClient, p: { organizationId: string; invoiceId: string; actorId: string }) {
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Invoice" WHERE id = ${p.invoiceId} FOR UPDATE`;
    const inv = await tx.invoice.findFirst({
      where: { id: p.invoiceId, organizationId: p.organizationId },
      include: { client: true, lines: true },
    });
    if (!inv) throw new LedgerError("Invoice not found.");
    if (inv.status !== "DRAFT") return inv; // already issued: idempotent
    const ar = await systemAccount(tx, p.organizationId, "AR");
    const revenue = await systemAccount(tx, p.organizationId, "REVENUE_SERVICE");
    const issueDate = new Date();
    const dueDate = new Date(issueDate.getTime() + inv.client.paymentTermsDays * 86400000);
    const profile = await tx.companyProfile.findFirst({ where: { organizationId: p.organizationId, isDefault: true } });
    const bank = await tx.bankAccount.findFirst({
      where: { organizationId: p.organizationId, currency: inv.currency, active: true, isDefault: true },
    });
    const tpl = await tx.documentSetting.findUnique({ where: { organizationId_docType: { organizationId: p.organizationId, docType: "INVOICE" } } });
    const number = await nextNumber(tx, p.organizationId, "INV", "INV");
    const lines: DraftLine[] = [{ accountId: ar.id, debit: inv.total, clientId: inv.clientId, memo: number }];
    lines.push({ accountId: revenue.id, credit: inv.subtotal, memo: number });
    if (inv.taxAmount.gt(0)) {
      const tax = await systemAccount(tx, p.organizationId, "TAX_PAYABLE");
      lines.push({ accountId: tax.id, credit: inv.taxAmount, memo: number });
    }
    const entry = await postJournal(tx, {
      organizationId: p.organizationId, date: issueDate, memo: `Invoice ${number} to ${inv.client.name}`,
      currency: inv.currency, sourceType: "INVOICE", sourceId: inv.id, idempotencyKey: `invoice-issue:${inv.id}`,
      postedById: p.actorId, lines,
    });
    return tx.invoice.update({
      where: { id: inv.id },
      data: {
        status: "ISSUED", number, issueDate, dueDate, journalEntryId: entry.id,
        // Snapshots keep this invoice's details fixed even if settings change later
        companySnapshot: profile ? JSON.parse(JSON.stringify({ ...profile, _template: { config: tpl?.config ?? null, version: tpl?.version ?? 0 } })) : undefined,
        bankSnapshot: bank
          ? { bankName: bank.bankName, accountHolder: bank.accountHolder, accountNumber: bank.accountNumber, iban: bank.iban, swift: bank.swift, routingCode: bank.routingCode, currency: bank.currency, paymentInstructions: bank.paymentInstructions }
          : undefined,
      },
    });
  });
}

// Corrections never edit posted history: an unpaid invoice is cancelled by a reversing entry.
export async function cancelInvoice(db: PrismaClient, p: { organizationId: string; invoiceId: string; actorId: string }) {
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Invoice" WHERE id = ${p.invoiceId} FOR UPDATE`;
    const inv = await tx.invoice.findFirst({ where: { id: p.invoiceId, organizationId: p.organizationId } });
    if (!inv) throw new LedgerError("Invoice not found.");
    if (inv.status === "CANCELLED") return inv;
    if (inv.status === "DRAFT") return tx.invoice.update({ where: { id: inv.id }, data: { status: "CANCELLED" } });
    if (!inv.amountPaid.isZero() || !inv.creditedAmount.isZero()) throw new LedgerError("This invoice has payments or credit notes. Use a credit note instead of cancelling.");
    const original = await tx.journalEntry.findUniqueOrThrow({ where: { id: inv.journalEntryId! }, include: { lines: true } });
    await postJournal(tx, {
      organizationId: p.organizationId, date: new Date(), memo: `Reversal of ${original.number} (cancelled invoice ${inv.number})`,
      currency: inv.currency, sourceType: "REVERSAL", sourceId: inv.id, idempotencyKey: `invoice-cancel:${inv.id}`,
      postedById: p.actorId, reversalOfId: original.id,
      lines: original.lines.map((l) => ({ accountId: l.accountId, clientId: l.clientId, debit: l.credit, credit: l.debit })),
    });
    await tx.journalEntry.update({ where: { id: original.id }, data: { status: "REVERSED" } });
    return tx.invoice.update({ where: { id: inv.id }, data: { status: "CANCELLED" } });
  });
}

export async function recordPayment(
  db: PrismaClient,
  p: {
    organizationId: string; actorId: string; clientId: string; bankAccountId: string; amount: string; date: Date;
    method: string; reference?: string | null; idempotencyKey: string; invoiceIds?: string[];
  },
) {
  return db.$transaction(async (tx) => {
    // Lock the client first so two identical requests (a double click) run one after the other
    await tx.$queryRaw`SELECT id FROM "Client" WHERE id = ${p.clientId} FOR UPDATE`;
    const done = await tx.payment.findUnique({ where: { idempotencyKey: p.idempotencyKey } });
    if (done) return done; // retried request: same payment, no duplicates
    const amount = round2(p.amount);
    if (amount.lte(0)) throw new LedgerError("Payment amount must be greater than zero.");
    const bank = await tx.bankAccount.findFirst({ where: { id: p.bankAccountId, organizationId: p.organizationId, active: true } });
    if (!bank) throw new LedgerError("Choose an active bank account.");
    if (!bank.ledgerAccountId) throw new LedgerError("This bank account is not linked to a ledger account.");
    const client = await tx.client.findFirst({ where: { id: p.clientId, organizationId: p.organizationId } });
    if (!client) throw new LedgerError("Unknown client.");

    const open = await tx.$queryRaw<{ id: string; total: Prisma.Decimal; amountPaid: Prisma.Decimal; creditedAmount: Prisma.Decimal }[]>`
      SELECT id, total, "amountPaid", "creditedAmount" FROM "Invoice"
      WHERE "organizationId" = ${p.organizationId} AND "clientId" = ${p.clientId} AND currency = ${bank.currency}
        AND status IN ('ISSUED', 'PARTIALLY_PAID')
        ${p.invoiceIds?.length ? Prisma.sql`AND id IN (${Prisma.join(p.invoiceIds)})` : Prisma.empty}
      ORDER BY "issueDate" ASC, id ASC FOR UPDATE`;
    const { allocations, unallocated } = allocateFifo(
      amount,
      open.map((i) => ({ id: i.id, outstanding: dec(i.total).sub(i.amountPaid).sub(i.creditedAmount) })),
    );
    const allocated = amount.sub(unallocated);

    const ar = await systemAccount(tx, p.organizationId, "AR");
    const number = await nextNumber(tx, p.organizationId, "RCT", "RCT");
    const lines: DraftLine[] = [{ accountId: bank.ledgerAccountId, debit: amount, memo: number }];
    if (allocated.gt(0)) lines.push({ accountId: ar.id, credit: allocated, clientId: p.clientId, memo: number });
    if (unallocated.gt(0)) {
      const adv = await systemAccount(tx, p.organizationId, "CUSTOMER_ADVANCES");
      lines.push({ accountId: adv.id, credit: unallocated, clientId: p.clientId, memo: `${number} advance` });
    }
    const entry = await postJournal(tx, {
      organizationId: p.organizationId, date: p.date, memo: `Receipt ${number} from ${client.name}`, currency: bank.currency,
      sourceType: "PAYMENT", idempotencyKey: `payment:${p.idempotencyKey}`, postedById: p.actorId, lines,
    });
    const payment = await tx.payment.create({
      data: {
        organizationId: p.organizationId, number, clientId: p.clientId, bankAccountId: bank.id, currency: bank.currency,
        amount, unallocated, date: p.date, method: p.method, reference: p.reference, idempotencyKey: p.idempotencyKey,
        journalEntryId: entry.id, receivedById: p.actorId,
        bankSnapshot: { internalName: bank.internalName, bankName: bank.bankName, accountHolder: bank.accountHolder },
        allocations: { create: allocations.map((a) => ({ invoiceId: a.invoiceId, amount: a.amount })) },
      },
    });
    for (const a of allocations) {
      const inv = await tx.invoice.findUniqueOrThrow({ where: { id: a.invoiceId } });
      const paid = inv.amountPaid.add(a.amount);
      await tx.invoice.update({ where: { id: inv.id }, data: { amountPaid: paid, status: invoiceStatusAfterPayment(inv.total, paid, inv.creditedAmount) } });
    }
    return payment;
  });
}

export type TrialBalanceRow = { code: string; name: string; type: string; currency: string; debit: string; credit: string };

export async function trialBalance(db: PrismaClient, organizationId: string): Promise<TrialBalanceRow[]> {
  return db.$queryRaw<TrialBalanceRow[]>`
    SELECT a.code, a.name, a.type, e.currency,
           COALESCE(SUM(l.debit), 0)::text AS debit, COALESCE(SUM(l.credit), 0)::text AS credit
    FROM "JournalLine" l
    JOIN "JournalEntry" e ON e.id = l."entryId"
    JOIN "Account" a ON a.id = l."accountId"
    WHERE e."organizationId" = ${organizationId}
    GROUP BY a.code, a.name, a.type, e.currency
    ORDER BY e.currency, a.code`;
}

export async function clientStatement(db: PrismaClient, organizationId: string, clientId: string) {
  const ar = await db.account.findFirst({ where: { organizationId, systemKey: "AR" } });
  if (!ar) return { rows: [], advances: [] };
  const lines = await db.journalLine.findMany({
    where: { clientId, accountId: ar.id, entry: { organizationId } },
    orderBy: [{ entry: { date: "asc" } }, { entry: { number: "asc" } }],
    include: { entry: true },
  });
  const running = new Map<string, Prisma.Decimal>();
  const rows = lines.map((l) => {
    const cur = l.entry.currency;
    const bal = (running.get(cur) ?? dec(0)).add(l.debit).sub(l.credit);
    running.set(cur, bal);
    return { date: l.entry.date, number: l.entry.number, description: l.entry.memo ?? "", debit: l.debit, credit: l.credit, balance: bal, currency: cur };
  });
  const adv = await db.account.findFirst({ where: { organizationId, systemKey: "CUSTOMER_ADVANCES" } });
  const advLines = adv
    ? await db.journalLine.findMany({ where: { clientId, accountId: adv.id, entry: { organizationId } }, include: { entry: true } })
    : [];
  const advances = new Map<string, Prisma.Decimal>();
  for (const l of advLines) advances.set(l.entry.currency, (advances.get(l.entry.currency) ?? dec(0)).add(l.credit).sub(l.debit));
  return { rows, advances: [...advances.entries()].filter(([, v]) => !v.isZero()).map(([currency, amount]) => ({ currency, amount })) };
}
