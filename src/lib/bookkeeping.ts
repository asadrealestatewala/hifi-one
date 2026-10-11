// Accountant essentials: manual journals with approval, chart of accounts maintenance, period locking,
// credit notes and refunds of customer advances. Free of Next.js imports so it can be tested against the database.
import type { Prisma, PrismaClient } from "@prisma/client";
import { LedgerError, assertBalanced, dec, invoiceStatusAfterPayment, round2, type DraftLine } from "./ledger-math";
import { postJournal } from "./accounting";
import { periodLockMessage } from "./period-lock";

type Tx = Prisma.TransactionClient;
const MONEY = /^\d{1,12}(\.\d{1,2})?$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
export const ACCOUNT_TYPES = ["ASSET", "LIABILITY", "EQUITY", "REVENUE", "DIRECT_COST", "OPEX", "OTHER_INCOME", "OTHER_EXPENSE"] as const;

// Control accounts are owned by their sub-ledgers (customers, vendors). Manual entries would break reconciliation.
const CONTROL_KEYS = ["AR", "ACCOUNTS_PAYABLE", "CUSTOMER_ADVANCES"];

async function seq(tx: Tx, organizationId: string, key: string, prefix: string) {
  const s = await tx.numberSequence.upsert({
    where: { organizationId_key: { organizationId, key } },
    create: { organizationId, key, next: 2 },
    update: { next: { increment: 1 } },
  });
  return `${prefix}-${String(s.next - 1).padStart(6, "0")}`;
}

// ----- Manual journals -----

export type ManualLine = { accountId: string; debit?: string; credit?: string; memo?: string };

async function checkManualLines(db: Pick<PrismaClient, "account">, organizationId: string, lines: ManualLine[]) {
  const ids = [...new Set(lines.map((l) => l.accountId))];
  const accounts = await db.account.findMany({ where: { id: { in: ids }, organizationId, active: true } });
  if (accounts.length !== ids.length) throw new LedgerError("A line uses an unknown or inactive account.");
  const control = accounts.find((a) => a.systemKey && CONTROL_KEYS.includes(a.systemKey));
  if (control) throw new LedgerError(`Account ${control.code} ${control.name} is a control account. Use invoices, payments, credit notes or refunds instead of a manual entry.`);
  for (const l of lines) {
    for (const v of [l.debit, l.credit]) if (v && !MONEY.test(v)) throw new LedgerError("Amounts must be positive numbers with at most 2 decimals.");
  }
}

export async function createManualJournal(
  db: PrismaClient,
  p: { organizationId: string; date: string; memo: string; currency: string; lines: ManualLine[]; createdById: string },
) {
  if (!DATE.test(p.date)) throw new LedgerError("Enter a valid date.");
  if (p.memo.trim().length < 3) throw new LedgerError("Describe why this entry is needed.");
  if (!["PKR", "USD", "AED", "GBP"].includes(p.currency)) throw new LedgerError("Unsupported currency.");
  const lines = p.lines.filter((l) => l.accountId && (l.debit || l.credit));
  assertBalanced(lines.map((l): DraftLine => ({ accountId: l.accountId, debit: l.debit || 0, credit: l.credit || 0 })));
  await checkManualLines(db, p.organizationId, lines);
  const lock = await db.periodLock.findUnique({ where: { organizationId: p.organizationId } });
  const blocked = periodLockMessage(lock?.lockedThrough, new Date(`${p.date}T00:00:00Z`));
  if (blocked) throw new LedgerError(blocked);
  return db.manualJournal.create({ data: { organizationId: p.organizationId, date: p.date, memo: p.memo.trim(), currency: p.currency, lines: lines as never, createdById: p.createdById } });
}

export async function approveManualJournal(db: PrismaClient, p: { organizationId: string; id: string; approverId: string }) {
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "ManualJournal" WHERE id = ${p.id} FOR UPDATE`;
    const j = await tx.manualJournal.findFirst({ where: { id: p.id, organizationId: p.organizationId } });
    if (!j) throw new LedgerError("Journal not found.");
    if (j.status === "POSTED") return j; // idempotent
    if (j.status !== "PENDING") throw new LedgerError("This journal was already decided.");
    if (j.createdById === p.approverId) throw new LedgerError("You cannot approve a journal you prepared.");
    const lines = j.lines as unknown as ManualLine[];
    await checkManualLines(tx as never, p.organizationId, lines); // accounts may have changed since it was prepared
    const entry = await postJournal(tx, {
      organizationId: p.organizationId, date: new Date(`${j.date}T00:00:00Z`), memo: j.memo, currency: j.currency, sourceType: "MANUAL", sourceId: j.id,
      idempotencyKey: `manual:${j.id}`, postedById: p.approverId,
      lines: lines.map((l) => ({ accountId: l.accountId, debit: l.debit || 0, credit: l.credit || 0, memo: l.memo })),
    });
    return tx.manualJournal.update({ where: { id: j.id }, data: { status: "POSTED", decidedById: p.approverId, journalEntryId: entry.id } });
  });
}

export async function rejectManualJournal(db: PrismaClient, p: { organizationId: string; id: string; deciderId: string; note: string }) {
  if (!p.note.trim()) throw new LedgerError("A reason is required.");
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "ManualJournal" WHERE id = ${p.id} FOR UPDATE`;
    const j = await tx.manualJournal.findFirst({ where: { id: p.id, organizationId: p.organizationId } });
    if (!j) throw new LedgerError("Journal not found.");
    if (j.status !== "PENDING") throw new LedgerError("This journal was already decided.");
    return tx.manualJournal.update({ where: { id: j.id }, data: { status: "REJECTED", decidedById: p.deciderId, decisionNote: p.note.trim() } });
  });
}

// Posted entries are never edited. A wrong manual entry is corrected by a reversing entry dated today.
export async function reverseManualEntry(db: PrismaClient, p: { organizationId: string; entryId: string; actorId: string; reason: string }) {
  if (p.reason.trim().length < 3) throw new LedgerError("Give a reason for the reversal.");
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "JournalEntry" WHERE id = ${p.entryId} FOR UPDATE`;
    const e = await tx.journalEntry.findFirst({ where: { id: p.entryId, organizationId: p.organizationId }, include: { lines: true } });
    if (!e) throw new LedgerError("Entry not found.");
    if (e.sourceType !== "MANUAL") throw new LedgerError("Only manual entries can be reversed here. Invoices, payments and other documents are corrected by their own cancel, credit or refund actions.");
    const done = await tx.journalEntry.findUnique({ where: { reversalOfId: e.id } });
    if (done) return done; // already reversed
    const rev = await postJournal(tx, {
      organizationId: p.organizationId, date: new Date(), memo: `Reversal of ${e.number}: ${p.reason.trim()}`, currency: e.currency, sourceType: "REVERSAL", sourceId: e.id,
      idempotencyKey: `reverse:${e.id}`, postedById: p.actorId, reversalOfId: e.id,
      lines: e.lines.map((l) => ({ accountId: l.accountId, debit: l.credit, credit: l.debit, memo: l.memo ?? undefined })),
    });
    await tx.journalEntry.update({ where: { id: e.id }, data: { status: "REVERSED" } });
    return rev;
  });
}

// ----- Chart of accounts -----

export async function createAccount(db: PrismaClient, p: { organizationId: string; code: string; name: string; type: string }) {
  const code = p.code.trim();
  if (!/^[0-9A-Za-z.-]{2,12}$/.test(code)) throw new LedgerError("Account code: 2 to 12 letters, digits, dots or dashes.");
  if (p.name.trim().length < 2) throw new LedgerError("Enter an account name.");
  if (!(ACCOUNT_TYPES as readonly string[]).includes(p.type)) throw new LedgerError("Choose an account type.");
  if (await db.account.findUnique({ where: { organizationId_code: { organizationId: p.organizationId, code } } })) throw new LedgerError(`Account code ${code} already exists.`);
  return db.account.create({ data: { organizationId: p.organizationId, code, name: p.name.trim(), type: p.type } });
}

export async function accountBalances(db: PrismaClient, accountId: string) {
  return db.$queryRaw<{ currency: string; balance: string }[]>`
    SELECT e.currency, (COALESCE(SUM(l.debit), 0) - COALESCE(SUM(l.credit), 0))::text AS balance
    FROM "JournalLine" l JOIN "JournalEntry" e ON e.id = l."entryId" WHERE l."accountId" = ${accountId} GROUP BY e.currency`;
}

// The type and code never change once an account exists: history would no longer mean what it said.
export async function updateAccount(db: PrismaClient, p: { organizationId: string; id: string; name?: string; active?: boolean }) {
  const a = await db.account.findFirst({ where: { id: p.id, organizationId: p.organizationId } });
  if (!a) throw new LedgerError("Account not found.");
  const data: { name?: string; active?: boolean } = {};
  if (p.name !== undefined) {
    if (p.name.trim().length < 2) throw new LedgerError("Enter an account name.");
    data.name = p.name.trim();
  }
  if (p.active === false && a.active) {
    if (a.systemKey) throw new LedgerError("This account is used by automatic postings and cannot be deactivated.");
    const live = (await accountBalances(db, a.id)).filter((b) => !dec(b.balance).isZero());
    if (live.length) throw new LedgerError("This account has a balance. Move the balance elsewhere with a journal entry first.");
    if (await db.bankAccount.findFirst({ where: { ledgerAccountId: a.id, active: true } })) throw new LedgerError("An active bank account uses this ledger account.");
    data.active = false;
  } else if (p.active === true) data.active = true;
  return db.account.update({ where: { id: a.id }, data });
}

// ----- Period lock -----

export async function setPeriodLock(db: PrismaClient, p: { organizationId: string; lockedThrough: string; actorId: string; reopenReason?: string; today?: string }) {
  if (!DATE.test(p.lockedThrough)) throw new LedgerError("Enter a valid date.");
  const today = p.today ?? new Date().toISOString().slice(0, 10);
  if (p.lockedThrough > today) throw new LedgerError("You cannot close a period that has not ended yet.");
  const cur = await db.periodLock.findUnique({ where: { organizationId: p.organizationId } });
  if (cur && p.lockedThrough < cur.lockedThrough && !p.reopenReason?.trim()) throw new LedgerError("Reopening a closed period needs a written reason.");
  return db.periodLock.upsert({
    where: { organizationId: p.organizationId },
    create: { organizationId: p.organizationId, lockedThrough: p.lockedThrough, lockedById: p.actorId },
    update: { lockedThrough: p.lockedThrough, lockedById: p.actorId },
  });
}

// ----- Credit notes and refunds -----

export async function issueCreditNote(db: PrismaClient, p: { organizationId: string; invoiceId: string; amount: string; reason: string; actorId: string; idempotencyKey: string }) {
  if (!MONEY.test(p.amount) || Number(p.amount) <= 0) throw new LedgerError("Enter the credit amount.");
  if (p.reason.trim().length < 3) throw new LedgerError("Give a reason for the credit note.");
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Invoice" WHERE id = ${p.invoiceId} FOR UPDATE`;
    // Checked after taking the lock, so a simultaneous duplicate request sees the first one's result
    const prior = await tx.creditNote.findUnique({ where: { idempotencyKey: p.idempotencyKey } });
    if (prior) return prior;
    const inv = await tx.invoice.findFirst({ where: { id: p.invoiceId, organizationId: p.organizationId } });
    if (!inv) throw new LedgerError("Invoice not found.");
    if (!["ISSUED", "PARTIALLY_PAID"].includes(inv.status)) throw new LedgerError("Only an issued invoice with a balance can be credited.");
    const outstanding = inv.total.sub(inv.amountPaid).sub(inv.creditedAmount);
    const amount = round2(p.amount);
    if (amount.gt(outstanding)) throw new LedgerError(`The credit exceeds the balance due (${outstanding.toString()} ${inv.currency}).`);
    // Reverse revenue and tax in the same proportion as the original invoice
    const taxPortion = inv.total.gt(0) ? round2(amount.mul(inv.taxAmount).div(inv.total)) : dec(0);
    const revenuePortion = amount.sub(taxPortion);
    const ar = await tx.account.findFirstOrThrow({ where: { organizationId: p.organizationId, systemKey: "AR" } });
    const revenue = await tx.account.findFirstOrThrow({ where: { organizationId: p.organizationId, systemKey: "REVENUE_SERVICE" } });
    const number = await seq(tx, p.organizationId, "CN", "CN");
    const lines: DraftLine[] = [{ accountId: revenue.id, debit: revenuePortion, memo: number }, { accountId: ar.id, credit: amount, clientId: inv.clientId, memo: number }];
    if (taxPortion.gt(0)) lines.splice(1, 0, { accountId: (await tx.account.findFirstOrThrow({ where: { organizationId: p.organizationId, systemKey: "TAX_PAYABLE" } })).id, debit: taxPortion, memo: number });
    const entry = await postJournal(tx, {
      organizationId: p.organizationId, date: new Date(), memo: `Credit note ${number} against ${inv.number}: ${p.reason.trim()}`, currency: inv.currency,
      sourceType: "CREDIT_NOTE", sourceId: inv.id, idempotencyKey: `credit-note:${p.idempotencyKey}`, postedById: p.actorId, lines,
    });
    const credited = inv.creditedAmount.add(amount);
    await tx.invoice.update({ where: { id: inv.id }, data: { creditedAmount: credited, status: invoiceStatusAfterPayment(inv.total, inv.amountPaid, credited) } });
    return tx.creditNote.create({
      data: { organizationId: p.organizationId, number, invoiceId: inv.id, clientId: inv.clientId, amount, taxPortion, currency: inv.currency, reason: p.reason.trim(), idempotencyKey: p.idempotencyKey, journalEntryId: entry.id, createdById: p.actorId },
    });
  });
}

export async function advanceBalance(db: Pick<PrismaClient, "$queryRaw">, organizationId: string, clientId: string, currency: string) {
  const rows = await db.$queryRaw<{ balance: string }[]>`
    SELECT (COALESCE(SUM(l.credit), 0) - COALESCE(SUM(l.debit), 0))::text AS balance
    FROM "JournalLine" l JOIN "JournalEntry" e ON e.id = l."entryId" JOIN "Account" a ON a.id = l."accountId"
    WHERE e."organizationId" = ${organizationId} AND a."systemKey" = 'CUSTOMER_ADVANCES' AND l."clientId" = ${clientId} AND e.currency = ${currency}`;
  return dec(rows[0]?.balance ?? 0);
}

// Pays back money a client has on account (an advance or overpayment). Never more than they hold.
export async function refundAdvance(
  db: PrismaClient,
  p: { organizationId: string; clientId: string; bankAccountId: string; amount: string; reason: string; actorId: string; idempotencyKey: string },
) {
  if (!MONEY.test(p.amount) || Number(p.amount) <= 0) throw new LedgerError("Enter the refund amount.");
  if (p.reason.trim().length < 3) throw new LedgerError("Give a reason for the refund.");
  return db.$transaction(async (tx) => {
    const key = `refund:${p.idempotencyKey}`;
    await tx.$queryRaw`SELECT id FROM "Client" WHERE id = ${p.clientId} FOR UPDATE`; // serialise refunds for one client
    const prior = await tx.journalEntry.findUnique({ where: { idempotencyKey: key } });
    if (prior) return prior;
    const bank = await tx.bankAccount.findFirst({ where: { id: p.bankAccountId, organizationId: p.organizationId, active: true } });
    if (!bank?.ledgerAccountId) throw new LedgerError("Choose an active bank account linked to the ledger.");
    const client = await tx.client.findFirst({ where: { id: p.clientId, organizationId: p.organizationId } });
    if (!client) throw new LedgerError("Unknown client.");
    const held = await advanceBalance(tx, p.organizationId, p.clientId, bank.currency);
    if (dec(p.amount).gt(held)) throw new LedgerError(`${client.name} holds only ${held.toString()} ${bank.currency} on account.`);
    const adv = await tx.account.findFirstOrThrow({ where: { organizationId: p.organizationId, systemKey: "CUSTOMER_ADVANCES" } });
    return postJournal(tx, {
      organizationId: p.organizationId, date: new Date(), memo: `Refund to ${client.name}: ${p.reason.trim()}`, currency: bank.currency, sourceType: "REFUND",
      sourceId: client.id, idempotencyKey: key, postedById: p.actorId,
      lines: [{ accountId: adv.id, debit: p.amount, clientId: client.id }, { accountId: bank.ledgerAccountId, credit: p.amount }],
    });
  });
}
