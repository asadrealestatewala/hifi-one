// Exchange rates and consolidation into the organization's base currency.
// A rate says: 1 unit of the currency = `rate` units of the base currency, from `effectiveDate` onward.
// Rates are append-only (a correction is a newer row for the same date), conversions use exact decimals,
// and a currency without a rate is reported as missing, never silently treated as 1 or left out.
import type { Prisma, PrismaClient } from "@prisma/client";
import { CURRENCIES } from "./money";
import { dec, round2 } from "./ledger-math";
import type { BalanceRow } from "./statements";
import { buildBalanceSheet } from "./statements";

type D = ReturnType<typeof dec>;

export class FxError extends Error {}

const DATE = /^\d{4}-\d{2}-\d{2}$/;

export async function getBaseCurrency(db: PrismaClient, organizationId: string): Promise<string> {
  const org = await db.organization.findUniqueOrThrow({ where: { id: organizationId }, select: { baseCurrency: true } });
  return org.baseCurrency;
}

// The base currency can only change while no rates exist, because every stored rate is relative to it.
export async function setBaseCurrency(db: PrismaClient, p: { organizationId: string; currency: string }) {
  if (!(CURRENCIES as readonly string[]).includes(p.currency)) throw new FxError("Choose one of the supported currencies.");
  const current = await getBaseCurrency(db, p.organizationId);
  if (current === p.currency) return current;
  if ((await db.exchangeRate.count({ where: { organizationId: p.organizationId } })) > 0) {
    throw new FxError("Rates are already recorded against the current base currency. The base currency cannot change once rates exist.");
  }
  await db.organization.update({ where: { id: p.organizationId }, data: { baseCurrency: p.currency } });
  return p.currency;
}

export async function addRate(db: PrismaClient, p: { organizationId: string; currency: string; rate: string; effectiveDate: string; note?: string; actorId: string }) {
  const base = await getBaseCurrency(db, p.organizationId);
  if (!(CURRENCIES as readonly string[]).includes(p.currency)) throw new FxError("Choose one of the supported currencies.");
  if (p.currency === base) throw new FxError(`${base} is the base currency; its rate is always 1.`);
  if (!DATE.test(p.effectiveDate) || Number.isNaN(Date.parse(p.effectiveDate))) throw new FxError("Enter a valid date.");
  if (!/^\d+(\.\d{1,8})?$/.test(p.rate.trim())) throw new FxError("Enter the rate as a positive number with up to 8 decimals.");
  const rate = dec(p.rate.trim());
  if (rate.lte(0)) throw new FxError("The rate must be greater than zero.");
  if (rate.gte("1000000000")) throw new FxError("That rate is unrealistically large; check the entry.");
  return db.exchangeRate.create({
    data: { organizationId: p.organizationId, currency: p.currency, rate: rate.toString(), effectiveDate: p.effectiveDate, note: p.note?.slice(0, 200) || null, createdById: p.actorId },
  });
}

// The rate in force on a date: the latest effective date on or before it (later entries for the same date win).
export async function rateOn(db: PrismaClient, organizationId: string, currency: string, date: string): Promise<D | null> {
  const base = await getBaseCurrency(db, organizationId);
  if (currency === base) return dec(1);
  const row = await db.exchangeRate.findFirst({
    where: { organizationId, currency, effectiveDate: { lte: date } },
    orderBy: [{ effectiveDate: "desc" }, { createdAt: "desc" }],
  });
  return row ? dec(row.rate.toString()) : null;
}

export async function ratesOn(db: PrismaClient, organizationId: string, currencies: string[], date: string): Promise<Map<string, D | null>> {
  const m = new Map<string, D | null>();
  for (const c of currencies) m.set(c, await rateOn(db, organizationId, c, date));
  return m;
}

export function convert(amount: Prisma.Decimal.Value, rate: D): D {
  return round2(dec(amount).mul(rate));
}

// Convert per-currency account balances into one list in the base currency, summing accounts that appear in several
// currencies. Rows in a currency with no rate are returned in `missing` and are not included.
export function consolidateRows(rows: BalanceRow[], base: string, rates: Map<string, D | null>) {
  const missing = new Set<string>();
  const merged = new Map<string, { code: string; name: string; type: string; debit: D; credit: D }>();
  for (const r of rows) {
    const rate = r.currency === base ? dec(1) : rates.get(r.currency) ?? null;
    if (!rate) { missing.add(r.currency); continue; }
    const cur = merged.get(r.code) ?? { code: r.code, name: r.name, type: r.type, debit: dec(0), credit: dec(0) };
    cur.debit = cur.debit.add(dec(r.debit).mul(rate));
    cur.credit = cur.credit.add(dec(r.credit).mul(rate));
    merged.set(r.code, cur);
  }
  const out: BalanceRow[] = [...merged.values()].sort((a, b) => a.code.localeCompare(b.code)).map((m) => ({
    code: m.code, name: m.name, type: m.type, currency: base, debit: round2(m.debit).toString(), credit: round2(m.credit).toString(),
  }));
  return { rows: out, missing: [...missing].sort() };
}

// Converting each account separately can leave a few cents of rounding. It is shown on its own line, never hidden;
// a difference of a whole unit or more is reported as out of balance.
export function consolidatedBalanceSheet(rows: BalanceRow[]) {
  const b = buildBalanceSheet(rows);
  const diff = b.totals.assets.sub(b.totals.liabilitiesAndEquity);
  const rounding = diff.abs().lt(1) ? diff : dec(0);
  return { ...b, rounding, balanced: diff.abs().lt(1) };
}
