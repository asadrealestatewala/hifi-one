// Campaign spend and performance. Spend is entered by hand (there is no ad-platform connection), so every figure says where it comes
// from: spend entries, leads tagged with the campaign, and won deals. Money is never mixed across currencies. Free of Next.js imports.
import type { PrismaClient } from "@prisma/client";
import { CURRENCIES } from "./money";

export class SpendError extends Error {}
type Db = PrismaClient;

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const nonNeg = (v: string | null | undefined) => { const t = (v ?? "").trim().replace(/,/g, ""); if (!t) return null; if (!/^\d{1,9}$/.test(t)) throw new SpendError("Impressions, clicks and results must be whole numbers."); return Number(t); };

export async function addSpend(db: Db, p: { organizationId: string; campaignId: string; actorId: string; date: string; platform: string; amount: string; currency: string; impressions?: string; clicks?: string; results?: string; note?: string; today?: string }) {
  const c = await db.campaign.findFirst({ where: { id: p.campaignId, organizationId: p.organizationId } });
  if (!c) throw new SpendError("Campaign not found.");
  if (!DAY.test(p.date) || Number.isNaN(Date.parse(`${p.date}T00:00:00Z`))) throw new SpendError("Enter the date the money was spent.");
  if (p.date > (p.today ?? new Date().toISOString().slice(0, 10))) throw new SpendError("The date cannot be in the future.");
  const platform = p.platform.trim().slice(0, 40);
  if (platform.length < 2) throw new SpendError("Say where the money was spent, for example Meta, Google, TikTok or Print.");
  const amount = p.amount.trim().replace(/,/g, "");
  if (!/^\d{1,12}(\.\d{1,2})?$/.test(amount) || Number(amount) <= 0) throw new SpendError("Enter the amount as a positive number.");
  if (!(CURRENCIES as readonly string[]).includes(p.currency)) throw new SpendError("Choose a supported currency.");
  const impressions = nonNeg(p.impressions), clicks = nonNeg(p.clicks), results = nonNeg(p.results);
  if (impressions !== null && clicks !== null && clicks > impressions) throw new SpendError("Clicks cannot be more than impressions.");
  return db.campaignSpend.create({ data: { organizationId: p.organizationId, campaignId: c.id, date: p.date, platform, amount, currency: p.currency, impressions, clicks, results, note: p.note?.trim().slice(0, 300) || null, enteredById: p.actorId } });
}

export async function deleteSpend(db: Db, p: { organizationId: string; id: string }) {
  const r = await db.campaignSpend.deleteMany({ where: { id: p.id, organizationId: p.organizationId } });
  if (r.count === 0) throw new SpendError("Entry not found.");
}

export type CurrencyFigure = { currency: string; amount: number };
export type Performance = {
  from: string | null; to: string | null;
  spend: CurrencyFigure[]; byPlatform: { platform: string; currency: string; amount: number; clicks: number; impressions: number; results: number }[];
  impressions: number; clicks: number; results: number; ctr: number | null;
  leads: number; won: number; conversion: number | null; wonValue: CurrencyFigure[];
  costPerLead: CurrencyFigure[]; costPerWon: CurrencyFigure[]; roi: { currency: string; percent: number }[];
};

const r2 = (n: number) => Math.round(n * 100) / 100;

export async function performance(db: Db, organizationId: string, campaignId: string, range: { from?: string; to?: string } = {}): Promise<Performance> {
  const from = range.from && DAY.test(range.from) ? range.from : null, to = range.to && DAY.test(range.to) ? range.to : null;
  const spendWhere = { organizationId, campaignId, ...(from || to ? { date: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } : {}) };
  const created = from || to ? { gte: from ? new Date(`${from}T00:00:00.000Z`) : undefined, lte: to ? new Date(`${to}T23:59:59.999Z`) : undefined } : undefined;
  const [spend, byPlatform, totals, leads, won, wonValue] = await Promise.all([
    db.campaignSpend.groupBy({ by: ["currency"], where: spendWhere, _sum: { amount: true } }),
    db.campaignSpend.groupBy({ by: ["platform", "currency"], where: spendWhere, _sum: { amount: true, clicks: true, impressions: true, results: true } }),
    db.campaignSpend.aggregate({ where: spendWhere, _sum: { impressions: true, clicks: true, results: true } }),
    db.lead.count({ where: { organizationId, campaignId, ...(created ? { createdAt: created } : {}) } }),
    db.lead.count({ where: { organizationId, campaignId, OR: [{ clientId: { not: null } }, { stage: { isWon: true } }], ...(created ? { createdAt: created } : {}) } }),
    db.lead.groupBy({ by: ["currency"], where: { organizationId, campaignId, dealValue: { not: null }, OR: [{ clientId: { not: null } }, { stage: { isWon: true } }], ...(created ? { createdAt: created } : {}) }, _sum: { dealValue: true } }),
  ]);
  const spendF = spend.map((s) => ({ currency: s.currency, amount: r2(Number(s._sum.amount ?? 0)) }));
  const wonF = wonValue.map((w) => ({ currency: w.currency, amount: r2(Number(w._sum.dealValue ?? 0)) }));
  const impressions = totals._sum.impressions ?? 0, clicks = totals._sum.clicks ?? 0;
  return {
    from, to, spend: spendF,
    byPlatform: byPlatform.map((b) => ({ platform: b.platform, currency: b.currency, amount: r2(Number(b._sum.amount ?? 0)), clicks: b._sum.clicks ?? 0, impressions: b._sum.impressions ?? 0, results: b._sum.results ?? 0 })).sort((a, b) => b.amount - a.amount),
    impressions, clicks, results: totals._sum.results ?? 0, ctr: impressions > 0 ? r2((clicks / impressions) * 100) : null,
    leads, won, conversion: leads > 0 ? Math.round((won / leads) * 100) : null, wonValue: wonF,
    costPerLead: leads > 0 ? spendF.map((s) => ({ currency: s.currency, amount: r2(s.amount / leads) })) : [],
    costPerWon: won > 0 ? spendF.map((s) => ({ currency: s.currency, amount: r2(s.amount / won) })) : [],
    // Return on spend only where the won deals and the spend are in the same currency
    roi: spendF.filter((s) => s.amount > 0 && wonF.some((w) => w.currency === s.currency)).map((s) => ({ currency: s.currency, percent: Math.round(((wonF.find((w) => w.currency === s.currency)!.amount - s.amount) / s.amount) * 100) })),
  };
}
