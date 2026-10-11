// Named tax rates and the sales tax report. The report is built from issued invoices and the tax reversed by credit notes
// (never from the rate list), so it reflects what was actually charged. Cancelled invoices are excluded because their tax was reversed.
import type { PrismaClient } from "@prisma/client";
import { dec, round2 } from "./ledger-math";
import { CURRENCIES } from "./money";

export class TaxError extends Error {}
type Db = PrismaClient;

export async function addTaxRate(db: Db, p: { organizationId: string; name: string; ratePercent: string }) {
  const name = p.name.trim();
  if (!name) throw new TaxError("Give the rate a name.");
  if (!/^\d{1,3}(\.\d{1,2})?$/.test(p.ratePercent.trim()) || dec(p.ratePercent).gt(100)) throw new TaxError("Enter a percentage between 0 and 100 with up to two decimals.");
  if (await db.taxRate.findUnique({ where: { organizationId_name: { organizationId: p.organizationId, name } } })) throw new TaxError("A tax rate with that name already exists.");
  return db.taxRate.create({ data: { organizationId: p.organizationId, name: name.slice(0, 60), ratePercent: p.ratePercent.trim() } });
}

export async function setTaxRateActive(db: Db, p: { organizationId: string; id: string; active: boolean }) {
  const r = await db.taxRate.updateMany({ where: { id: p.id, organizationId: p.organizationId }, data: { active: p.active } });
  if (r.count === 0) throw new TaxError("Tax rate not found.");
}

const startOf = (d: string) => new Date(`${d}T00:00:00.000Z`);
const endOf = (d: string) => new Date(`${d}T23:59:59.999Z`);

export async function salesTaxReport(db: Db, organizationId: string, p: { from: string; to: string }) {
  const [invoices, notes] = await Promise.all([
    db.invoice.findMany({
      where: { organizationId, status: { in: ["ISSUED", "PARTIALLY_PAID", "PAID", "CREDITED"] }, issueDate: { gte: startOf(p.from), lte: endOf(p.to) } },
      select: { currency: true, taxRate: true, subtotal: true, taxAmount: true },
    }),
    db.creditNote.findMany({ where: { organizationId, createdAt: { gte: startOf(p.from), lte: endOf(p.to) } }, select: { currency: true, taxPortion: true } }),
  ]);
  const rows = new Map<string, { currency: string; rate: string; taxable: ReturnType<typeof dec>; tax: ReturnType<typeof dec>; count: number }>();
  for (const i of invoices) {
    const key = `${i.currency}|${i.taxRate.toString()}`;
    const r = rows.get(key) ?? { currency: i.currency, rate: i.taxRate.toString(), taxable: dec(0), tax: dec(0), count: 0 };
    r.taxable = r.taxable.add(i.subtotal.toString());
    r.tax = r.tax.add(i.taxAmount.toString());
    r.count++;
    rows.set(key, r);
  }
  const reversed = new Map<string, ReturnType<typeof dec>>();
  for (const n of notes) reversed.set(n.currency, (reversed.get(n.currency) ?? dec(0)).add(n.taxPortion.toString()));
  const order = (c: string) => (CURRENCIES as readonly string[]).indexOf(c);
  const currencies = [...new Set([...rows.values()].map((r) => r.currency).concat([...reversed.keys()]))].sort((a, b) => order(a) - order(b));
  return currencies.map((currency) => {
    const lines = [...rows.values()].filter((r) => r.currency === currency).sort((a, b) => Number(a.rate) - Number(b.rate)).map((r) => ({ ...r, taxable: round2(r.taxable), tax: round2(r.tax) }));
    const collected = lines.reduce((a, l) => a.add(l.tax), dec(0));
    const back = round2(reversed.get(currency) ?? 0);
    return { currency, lines, collected, reversed: back, net: collected.sub(back) };
  });
}
