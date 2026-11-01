// Client types, retainer plans with quotas, single-service orders, quota usage and recurring revenue.
// An engagement is what a client bought. Billing itself still runs through subscriptions and invoices; the engagement
// records the scope (what is included), the price per period and the quota usage. MRR and ARR count only active
// recurring engagements, never one-time orders, and are reported per currency (never converted).
import type { PrismaClient } from "@prisma/client";
import { dec, round2 } from "./ledger-math";
import { CURRENCIES } from "./money";

export class EngagementError extends Error {}
type Db = PrismaClient;

export const CLIENT_TYPES = ["MARKETING", "SOFTWARE", "INCORPORATION", "SELLER_SERVICES", "SAAS"] as const;
export type ClientType = (typeof CLIENT_TYPES)[number];
export const CLIENT_TYPE_LABEL: Record<string, string> = {
  MARKETING: "Marketing and digital", SOFTWARE: "Software, app and AI development", INCORPORATION: "Company incorporation", SELLER_SERVICES: "Seller services", SAAS: "SaaS product customer",
};

// What a retainer can include. Ad campaigns are per platform so a plan can offer only the platforms that are enabled.
export const QUOTA_KEYS = [
  "REEL", "LONG_VIDEO", "STATIC_CREATIVE", "SEO_BLOG", "SEO_PLAN", "SOCIAL_MEDIA_MANAGEMENT",
  "AD_CAMPAIGN_META", "AD_CAMPAIGN_GOOGLE", "AD_CAMPAIGN_TIKTOK", "AD_CAMPAIGN_LINKEDIN", "AD_CAMPAIGN_SNAPCHAT",
] as const;
export const QUOTA_LABEL: Record<string, string> = {
  REEL: "Reels (short video edits)", LONG_VIDEO: "Long video edits", STATIC_CREATIVE: "Static creatives", SEO_BLOG: "SEO blogs", SEO_PLAN: "SEO plan",
  SOCIAL_MEDIA_MANAGEMENT: "Social media management", AD_CAMPAIGN_META: "Ad campaigns: Meta", AD_CAMPAIGN_GOOGLE: "Ad campaigns: Google",
  AD_CAMPAIGN_TIKTOK: "Ad campaigns: TikTok", AD_CAMPAIGN_LINKEDIN: "Ad campaigns: LinkedIn", AD_CAMPAIGN_SNAPCHAT: "Ad campaigns: Snapchat",
};
export const RECURRING = ["MONTHLY", "QUARTERLY", "ANNUAL"] as const;
export const ENGAGEMENT_INTERVALS = ["ONE_TIME", ...RECURRING] as const;
const MONEY = /^\d{1,12}(\.\d{1,2})?$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const PERIOD = /^\d{4}-(0[1-9]|1[0-2])$/;

export const currentPeriod = (d = new Date()) => d.toISOString().slice(0, 7);
const isQuotaKey = (k: string) => (QUOTA_KEYS as readonly string[]).includes(k);
const isRecurring = (i: string) => (RECURRING as readonly string[]).includes(i);

export async function setClientType(db: Db, p: { organizationId: string; clientId: string; clientType: string }) {
  if (!(CLIENT_TYPES as readonly string[]).includes(p.clientType)) throw new EngagementError("Choose a client type.");
  const r = await db.client.updateMany({ where: { id: p.clientId, organizationId: p.organizationId }, data: { clientType: p.clientType } });
  if (r.count === 0) throw new EngagementError("Client not found.");
}

// The staff member allocated to run the client's work. Must be an active employee of the same organization.
export async function setProjectManager(db: Db, p: { organizationId: string; clientId: string; userId: string | null }) {
  if (p.userId && !(await db.user.findFirst({ where: { id: p.userId, organizationId: p.organizationId, userType: "EMPLOYEE", active: true } }))) throw new EngagementError("Choose an active staff member.");
  const r = await db.client.updateMany({ where: { id: p.clientId, organizationId: p.organizationId }, data: { projectManagerId: p.userId } });
  if (r.count === 0) throw new EngagementError("Client not found.");
}

// Sets how many of a service a catalog plan includes each month. Zero removes the line.
export async function setPlanQuota(db: Db, p: { organizationId: string; planId: string; key: string; quantity: number }) {
  if (!isQuotaKey(p.key)) throw new EngagementError("Choose a service the plan can include.");
  if (!Number.isInteger(p.quantity) || p.quantity < 0 || p.quantity > 10000) throw new EngagementError("Enter a whole number from 0 to 10000.");
  if (!(await db.servicePlan.findFirst({ where: { id: p.planId, organizationId: p.organizationId } }))) throw new EngagementError("Plan not found.");
  if (p.quantity === 0) { await db.planQuota.deleteMany({ where: { planId: p.planId, key: p.key } }); return; }
  await db.planQuota.upsert({ where: { planId_key: { planId: p.planId, key: p.key } }, update: { quantity: p.quantity }, create: { planId: p.planId, key: p.key, quantity: p.quantity } });
}

type NewEngagement = {
  organizationId: string; clientId: string; actorId: string; startDate: string; notes?: string;
  kind: "RETAINER" | "SINGLE_SERVICE";
  // RETAINER: a catalog plan (quotas are copied) or custom quotas; the price defaults to the plan's price in the client's currency.
  planId?: string | null; name?: string; interval?: string; amount?: string; quotas?: { key: string; quantity: number }[];
  // SINGLE_SERVICE: one service, how many, and the price of each.
  serviceKey?: string; quantity?: number; unitPrice?: string;
};

export async function createEngagement(db: Db, p: NewEngagement) {
  if (!DATE.test(p.startDate)) throw new EngagementError("Enter the start date.");
  const client = await db.client.findFirst({ where: { id: p.clientId, organizationId: p.organizationId } });
  if (!client) throw new EngagementError("Client not found.");
  if (!(CURRENCIES as readonly string[]).includes(client.currency)) throw new EngagementError("The client's billing currency is not supported.");
  let name = p.name?.trim() ?? "", interval: string, amount: string, planId: string | null = null;
  let quotas: { key: string; quantity: number; period: string }[] = [];
  if (p.kind === "SINGLE_SERVICE") {
    if (!p.serviceKey || !isQuotaKey(p.serviceKey)) throw new EngagementError("Choose the service.");
    if (!Number.isInteger(p.quantity) || (p.quantity ?? 0) < 1 || (p.quantity ?? 0) > 10000) throw new EngagementError("Enter how many, as a whole number.");
    if (!p.unitPrice || !MONEY.test(p.unitPrice.trim()) || dec(p.unitPrice).lte(0)) throw new EngagementError("Enter the price of each as a positive amount.");
    interval = "ONE_TIME";
    amount = round2(dec(p.unitPrice).mul(p.quantity!)).toString();
    quotas = [{ key: p.serviceKey, quantity: p.quantity!, period: "TOTAL" }];
    if (!name) name = `${p.quantity} × ${QUOTA_LABEL[p.serviceKey]}`;
  } else {
    interval = p.interval ?? "MONTHLY";
    if (!isRecurring(interval)) throw new EngagementError("A retainer bills monthly, quarterly or annually.");
    let defaultAmount: string | null = null;
    if (p.planId) {
      const plan = await db.servicePlan.findFirst({ where: { id: p.planId, organizationId: p.organizationId, active: true }, include: { quotas: true, prices: true } });
      if (!plan) throw new EngagementError("Choose an active plan.");
      planId = plan.id;
      if (!name) name = plan.name;
      quotas = plan.quotas.map((q) => ({ key: q.key, quantity: q.quantity, period: "MONTH" }));
      defaultAmount = plan.prices.find((x) => x.currency === client.currency)?.amount.toString() ?? null;
    }
    for (const q of p.quotas ?? []) {
      if (!isQuotaKey(q.key) || !Number.isInteger(q.quantity) || q.quantity < 1) throw new EngagementError("Each included service needs a valid quantity.");
      quotas = quotas.filter((x) => x.key !== q.key).concat({ key: q.key, quantity: q.quantity, period: "MONTH" });
    }
    if (!name) throw new EngagementError("Name the retainer.");
    const a = (p.amount?.trim() || defaultAmount) ?? "";
    if (!MONEY.test(a) || dec(a).lte(0)) throw new EngagementError(`Enter the price per ${interval === "MONTHLY" ? "month" : interval === "QUARTERLY" ? "quarter" : "year"}${planId ? " (the plan has no price in " + client.currency + ")" : ""}.`);
    amount = a;
  }
  if (name.length > 120) throw new EngagementError("Names are limited to 120 characters.");
  return db.engagement.create({
    data: {
      organizationId: p.organizationId, clientId: client.id, planId, name, kind: p.kind, interval, currency: client.currency, amount, startDate: p.startDate,
      notes: p.notes?.trim().slice(0, 500) || null, createdById: p.actorId, quotas: { create: quotas },
    },
  });
}

export async function setEngagementStatus(db: Db, p: { organizationId: string; engagementId: string; status: string; endDate?: string | null }) {
  if (!["ACTIVE", "PAUSED", "ENDED", "CANCELLED"].includes(p.status)) throw new EngagementError("Choose a status.");
  if (p.endDate && !DATE.test(p.endDate)) throw new EngagementError("Enter the end date.");
  const r = await db.engagement.updateMany({ where: { id: p.engagementId, organizationId: p.organizationId }, data: { status: p.status, ...(p.status === "ENDED" || p.status === "CANCELLED" ? { endDate: p.endDate ?? new Date().toISOString().slice(0, 10) } : {}) } });
  if (r.count === 0) throw new EngagementError("Engagement not found.");
}

export async function logUsage(db: Db, p: { organizationId: string; engagementId: string; key: string; quantity: number; period?: string; note?: string; actorId: string }) {
  if (!Number.isInteger(p.quantity) || p.quantity < 1 || p.quantity > 1000) throw new EngagementError("Enter how many were delivered, as a whole number.");
  const period = p.period ?? currentPeriod();
  if (!PERIOD.test(period)) throw new EngagementError("Enter the month as YYYY-MM.");
  const e = await db.engagement.findFirst({ where: { id: p.engagementId, organizationId: p.organizationId }, include: { quotas: true } });
  if (!e) throw new EngagementError("Engagement not found.");
  if (e.status !== "ACTIVE") throw new EngagementError("Only an active engagement can have work counted against it.");
  if (!e.quotas.some((q) => q.key === p.key)) throw new EngagementError("That service is not part of this engagement.");
  return db.quotaUsage.create({ data: { engagementId: e.id, key: p.key, quantity: p.quantity, period, note: p.note?.trim().slice(0, 300) || null, createdById: p.actorId } });
}

export async function voidUsage(db: Db, p: { organizationId: string; usageId: string }) {
  const r = await db.quotaUsage.updateMany({ where: { id: p.usageId, voided: false, engagement: { organizationId: p.organizationId } }, data: { voided: true } });
  if (r.count === 0) throw new EngagementError("Usage entry not found.");
}

export type QuotaLine = { key: string; label: string; period: string; limit: number; used: number; remaining: number; over: number };

// Used against included, per service. Monthly quotas count the given month only; total quotas count everything.
export async function quotaSummary(db: Db, organizationId: string, engagementId: string, month = currentPeriod()): Promise<QuotaLine[]> {
  const e = await db.engagement.findFirst({ where: { id: engagementId, organizationId }, include: { quotas: true } });
  if (!e) return [];
  const usage = await db.quotaUsage.groupBy({ by: ["key", "period"], where: { engagementId, voided: false }, _sum: { quantity: true } });
  return e.quotas.sort((a, b) => a.key.localeCompare(b.key)).map((q) => {
    const used = usage.filter((u) => u.key === q.key && (q.period === "TOTAL" || u.period === month)).reduce((n, u) => n + (u._sum.quantity ?? 0), 0);
    return { key: q.key, label: QUOTA_LABEL[q.key] ?? q.key, period: q.period, limit: q.quantity, used, remaining: Math.max(0, q.quantity - used), over: Math.max(0, used - q.quantity) };
  });
}

export type Recurring = { currency: string; mrr: string; arr: string; engagements: number };

// Monthly and annual recurring revenue from active recurring engagements, per currency. One-time orders never count.
export async function recurringRevenue(db: Db, organizationId: string, today = new Date().toISOString().slice(0, 10)): Promise<Recurring[]> {
  const rows = await db.engagement.findMany({ where: { organizationId, status: "ACTIVE", interval: { in: [...RECURRING] }, startDate: { lte: today }, OR: [{ endDate: null }, { endDate: { gte: today } }] } });
  const by = new Map<string, { annual: ReturnType<typeof dec>; n: number }>();
  for (const r of rows) {
    const perYear = dec(r.amount.toString()).mul(r.interval === "MONTHLY" ? 12 : r.interval === "QUARTERLY" ? 4 : 1);
    const cur = by.get(r.currency) ?? { annual: dec(0), n: 0 };
    cur.annual = cur.annual.add(perYear); cur.n += 1;
    by.set(r.currency, cur);
  }
  return [...by.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([currency, v]) => ({ currency, mrr: round2(v.annual.div(12)).toString(), arr: round2(v.annual).toString(), engagements: v.n }));
}
