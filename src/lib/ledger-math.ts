// Pure money and ledger rules. No database access, so they are easy to test.
// All amounts use exact decimals, never floating point.
import { Prisma } from "@prisma/client";

type D = Prisma.Decimal;
const Decimal = Prisma.Decimal;

export const dec = (v: Prisma.Decimal.Value): D => new Decimal(v);

// Consistent rounding everywhere: 2 decimal places, half up.
export const round2 = (v: Prisma.Decimal.Value): D => dec(v).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);

export function computeInvoiceTotals(
  lines: { quantity: Prisma.Decimal.Value; unitPrice: Prisma.Decimal.Value }[],
  taxRatePercent: Prisma.Decimal.Value,
) {
  const amounts = lines.map((l) => round2(dec(l.quantity).mul(l.unitPrice)));
  const subtotal = amounts.reduce((a, b) => a.add(b), dec(0));
  const taxAmount = round2(subtotal.mul(taxRatePercent).div(100));
  return { amounts, subtotal, taxAmount, total: subtotal.add(taxAmount) };
}

export type DraftLine = { accountId: string; debit?: Prisma.Decimal.Value; credit?: Prisma.Decimal.Value; clientId?: string | null; memo?: string };

// Every posted entry must balance: total debits equal total credits.
export function assertBalanced(lines: DraftLine[]) {
  if (lines.length < 2) throw new LedgerError("A journal entry needs at least two lines.");
  let debit = dec(0);
  let credit = dec(0);
  for (const l of lines) {
    const d = round2(l.debit ?? 0);
    const c = round2(l.credit ?? 0);
    if (d.isNegative() || c.isNegative()) throw new LedgerError("Amounts cannot be negative.");
    if ((d.gt(0) && c.gt(0)) || (d.isZero() && c.isZero())) {
      throw new LedgerError("Each line must be either a debit or a credit with a non-zero amount.");
    }
    debit = debit.add(d);
    credit = credit.add(c);
  }
  if (!debit.eq(credit)) throw new LedgerError(`Entry does not balance: debits ${debit} vs credits ${credit}.`);
}

export class LedgerError extends Error {}

// Apply a payment to open invoices oldest first. Anything left over is an advance.
export function allocateFifo(amount: Prisma.Decimal.Value, open: { id: string; outstanding: Prisma.Decimal.Value }[]) {
  let remaining = round2(amount);
  const allocations: { invoiceId: string; amount: D }[] = [];
  for (const inv of open) {
    if (remaining.lte(0)) break;
    const out = round2(inv.outstanding);
    if (out.lte(0)) continue;
    const take = D_min(remaining, out);
    allocations.push({ invoiceId: inv.id, amount: take });
    remaining = remaining.sub(take);
  }
  return { allocations, unallocated: remaining };
}

const D_min = (a: D, b: D) => (a.lte(b) ? a : b);

export function invoiceStatusAfterPayment(total: Prisma.Decimal.Value, paid: Prisma.Decimal.Value) {
  const t = round2(total);
  const p = round2(paid);
  if (p.gte(t)) return "PAID" as const;
  return p.gt(0) ? ("PARTIALLY_PAID" as const) : ("ISSUED" as const);
}
