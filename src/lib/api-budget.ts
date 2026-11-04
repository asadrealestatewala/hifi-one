// One guard for every paid or limited outside call. A call is written to the ApiCall ledger BEFORE it is made, inside a database
// lock, after checking the monthly money cap and the daily call cap. So two people searching at once cannot overrun the cap, and a
// refused call costs nothing. If the call then fails before Google could bill it, the reservation is released.
// Prices are Google's published list prices in USD; the free monthly allowance is ignored on purpose, so the cap is conservative.
import type { PrismaClient } from "@prisma/client";

type Db = PrismaClient;
export class BudgetError extends Error {}

export const PROVIDERS = {
  GOOGLE_PLACES: { label: "Google Places" },
  GOOGLE_PAGESPEED: { label: "Google PageSpeed" },
} as const;
export type Provider = keyof typeof PROVIDERS;

// Text Search Enterprise: asking for phone, website or rating moves the request to this SKU (USD per request)
// PageSpeed Insights is free; its calls are still written to the ledger so the daily limit is enforced
export const SKU_PRICE_USD: Record<string, number> = { PLACES_TEXT_SEARCH_ENTERPRISE: 0.035, PSI_RUN_PAGESPEED: 0 };

export type Caps = { monthlyUsd: number; dailyCalls: number };
function num(v: string | undefined, fallback: number) { const n = Number(v); return v !== undefined && v.trim() !== "" && Number.isFinite(n) && n >= 0 ? n : fallback; }
export function googleCaps(env: Record<string, string | undefined> = process.env): Caps {
  return { monthlyUsd: num(env.GOOGLE_MONTHLY_BUDGET_USD, 20), dailyCalls: Math.floor(num(env.GOOGLE_DAILY_CALL_LIMIT, 100)) };
}

// PageSpeed has no money cap, only a daily request limit (default 200). Google's own quota for a key is higher, but this keeps one click from using it all.
export function pageSpeedCaps(env: Record<string, string | undefined> = process.env): Caps {
  return { monthlyUsd: 0, dailyCalls: Math.floor(num(env.PAGESPEED_DAILY_CALL_LIMIT, 200)) };
}

const monthStart = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
const dayStart = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));

export async function usage(db: Db, organizationId: string, provider: Provider, caps: Caps, now = new Date()) {
  const [m, d] = await Promise.all([
    db.apiCall.aggregate({ where: { organizationId, provider, createdAt: { gte: monthStart(now) } }, _sum: { costUsd: true }, _count: true }),
    db.apiCall.count({ where: { organizationId, provider, createdAt: { gte: dayStart(now) } } }),
  ]);
  const spent = Number(m._sum.costUsd ?? 0);
  return { monthSpentUsd: spent, monthCalls: m._count, monthlyCapUsd: caps.monthlyUsd, monthLeftUsd: Math.max(0, caps.monthlyUsd - spent), dayCalls: d, dailyCap: caps.dailyCalls, dayLeft: Math.max(0, caps.dailyCalls - d) };
}

// Would `calls` more calls of this SKU fit under both caps right now? (Used to refuse a whole search before its first request.)
export async function canAfford(db: Db, p: { organizationId: string; provider: Provider; sku: string; calls: number; caps: Caps; now?: Date }) {
  const u = await usage(db, p.organizationId, p.provider, p.caps, p.now);
  const cost = (SKU_PRICE_USD[p.sku] ?? 0) * p.calls;
  if (u.dayCalls + p.calls > p.caps.dailyCalls) return { ok: false as const, reason: `The daily limit of ${p.caps.dailyCalls} Google requests is used up. Try again tomorrow.` };
  if (u.monthSpentUsd + cost > p.caps.monthlyUsd + 1e-9) return { ok: false as const, reason: `This would pass the monthly Google budget of $${p.caps.monthlyUsd.toFixed(2)} ($${u.monthSpentUsd.toFixed(2)} used).` };
  return { ok: true as const, costUsd: cost };
}

// Reserve one call. Throws BudgetError (and records nothing) when a cap would be passed.
export async function reserveCall(db: Db, p: { organizationId: string; provider: Provider; sku: string; userId?: string | null; caps: Caps; now?: Date }): Promise<{ id: string; costUsd: number }> {
  const price = SKU_PRICE_USD[p.sku];
  if (price === undefined) throw new BudgetError(`No price is known for ${p.sku}, so the call was not made.`);
  const now = p.now ?? new Date();
  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`apicall:${p.organizationId}:${p.provider}`}))`;
    const u = await usage(tx as unknown as Db, p.organizationId, p.provider, p.caps, now);
    if (u.dayCalls + 1 > p.caps.dailyCalls) throw new BudgetError(`The daily limit of ${p.caps.dailyCalls} Google requests is used up. Try again tomorrow.`);
    if (u.monthSpentUsd + price > p.caps.monthlyUsd + 1e-9) throw new BudgetError(`The monthly Google budget of $${p.caps.monthlyUsd.toFixed(2)} is used up.`);
    const row = await tx.apiCall.create({ data: { organizationId: p.organizationId, provider: p.provider, sku: p.sku, userId: p.userId ?? null, costUsd: price, createdAt: now } });
    return { id: row.id, costUsd: price };
  });
}

// The call failed before Google could bill it (network error, rejected key): give the reservation back.
export async function releaseCall(db: Db, id: string) { await db.apiCall.deleteMany({ where: { id } }); }
