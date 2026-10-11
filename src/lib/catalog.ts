// Service catalog editing. Every change to a plan bumps its version so a quote or deal can say which version it used.
// Prices are independent per currency (never converted from one another). Archiving hides a plan or category from
// new work without deleting it, so old quotes and leads keep their references.
import type { PrismaClient } from "@prisma/client";
import { CURRENCIES } from "./money";
import { dec } from "./ledger-math";

export class CatalogError extends Error {}
type Db = PrismaClient;

export const INTERVALS = ["ONE_TIME", "MONTHLY", "QUARTERLY", "ANNUAL", "HOURLY", "MILESTONE", "CUSTOM"] as const;
const money = /^\d{1,12}(\.\d{1,2})?$/;

export async function createCategory(db: Db, p: { organizationId: string; name: string }) {
  const name = p.name.trim();
  if (!name) throw new CatalogError("Give the category a name.");
  if (name.length > 80) throw new CatalogError("Category names are limited to 80 characters.");
  const clash = await db.serviceCategory.findUnique({ where: { organizationId_name: { organizationId: p.organizationId, name } } });
  if (clash) {
    if (clash.active) throw new CatalogError("A category with that name already exists.");
    return db.serviceCategory.update({ where: { id: clash.id }, data: { active: true } }); // bring an archived one back
  }
  const last = await db.serviceCategory.aggregate({ where: { organizationId: p.organizationId }, _max: { sortOrder: true } });
  return db.serviceCategory.create({ data: { organizationId: p.organizationId, name, sortOrder: (last._max.sortOrder ?? 0) + 1 } });
}

export async function archiveCategory(db: Db, p: { organizationId: string; categoryId: string; active: boolean }) {
  const r = await db.serviceCategory.updateMany({ where: { id: p.categoryId, organizationId: p.organizationId }, data: { active: p.active } });
  if (r.count === 0) throw new CatalogError("Category not found.");
}

type PlanFields = { name: string; tagline?: string | null; billingInterval: string; isPopular?: boolean; isPublic?: boolean };
function checkPlan(f: PlanFields) {
  if (!f.name.trim()) throw new CatalogError("Give the plan a name.");
  if (f.name.trim().length > 100) throw new CatalogError("Plan names are limited to 100 characters.");
  if (!(INTERVALS as readonly string[]).includes(f.billingInterval)) throw new CatalogError("Choose how the plan is billed.");
}

export async function createPlan(db: Db, p: PlanFields & { organizationId: string; categoryId: string }) {
  checkPlan(p);
  const cat = await db.serviceCategory.findFirst({ where: { id: p.categoryId, organizationId: p.organizationId, active: true } });
  if (!cat) throw new CatalogError("Choose an active category.");
  const last = await db.servicePlan.aggregate({ where: { categoryId: cat.id }, _max: { sortOrder: true } });
  return db.servicePlan.create({
    data: {
      organizationId: p.organizationId, categoryId: cat.id, name: p.name.trim(), tagline: p.tagline?.trim() || null, billingInterval: p.billingInterval,
      isPopular: Boolean(p.isPopular), isPublic: p.isPublic ?? true, sortOrder: (last._max.sortOrder ?? 0) + 1,
    },
  });
}

export async function updatePlan(db: Db, p: PlanFields & { organizationId: string; planId: string; active?: boolean }) {
  checkPlan(p);
  const r = await db.servicePlan.updateMany({
    where: { id: p.planId, organizationId: p.organizationId },
    data: { name: p.name.trim(), tagline: p.tagline?.trim() || null, billingInterval: p.billingInterval, isPopular: Boolean(p.isPopular), isPublic: Boolean(p.isPublic), ...(p.active === undefined ? {} : { active: p.active }), version: { increment: 1 } },
  });
  if (r.count === 0) throw new CatalogError("Plan not found.");
}

export async function setPlanPrice(db: Db, p: { organizationId: string; planId: string; currency: string; amount: string; setupFee?: string | null }) {
  if (!(CURRENCIES as readonly string[]).includes(p.currency)) throw new CatalogError("Choose a supported currency.");
  if (!money.test(p.amount) || dec(p.amount).lte(0)) throw new CatalogError("Enter the price as a positive amount.");
  if (p.setupFee && !money.test(p.setupFee)) throw new CatalogError("Enter the setup fee as an amount, or leave it empty.");
  const plan = await db.servicePlan.findFirst({ where: { id: p.planId, organizationId: p.organizationId } });
  if (!plan) throw new CatalogError("Plan not found.");
  const setupFee = p.setupFee && dec(p.setupFee).gt(0) ? p.setupFee : null;
  await db.planPrice.upsert({
    where: { planId_currency: { planId: plan.id, currency: p.currency } },
    update: { amount: p.amount, setupFee }, create: { planId: plan.id, currency: p.currency, amount: p.amount, setupFee },
  });
  await db.servicePlan.update({ where: { id: plan.id }, data: { version: { increment: 1 } } });
}

export async function removePlanPrice(db: Db, p: { organizationId: string; planId: string; currency: string }) {
  const plan = await db.servicePlan.findFirst({ where: { id: p.planId, organizationId: p.organizationId } });
  if (!plan) throw new CatalogError("Plan not found.");
  await db.planPrice.deleteMany({ where: { planId: plan.id, currency: p.currency } });
  await db.servicePlan.update({ where: { id: plan.id }, data: { version: { increment: 1 } } });
}

export async function addFeature(db: Db, p: { organizationId: string; planId: string; text: string; included?: boolean }) {
  const text = p.text.trim();
  if (!text) throw new CatalogError("Enter the feature text.");
  if (text.length > 200) throw new CatalogError("Features are limited to 200 characters.");
  const plan = await db.servicePlan.findFirst({ where: { id: p.planId, organizationId: p.organizationId } });
  if (!plan) throw new CatalogError("Plan not found.");
  const last = await db.planFeature.aggregate({ where: { planId: plan.id }, _max: { sortOrder: true } });
  await db.planFeature.create({ data: { planId: plan.id, text, included: p.included ?? true, sortOrder: (last._max.sortOrder ?? 0) + 1 } });
  await db.servicePlan.update({ where: { id: plan.id }, data: { version: { increment: 1 } } });
}

export async function removeFeature(db: Db, p: { organizationId: string; planId: string; featureId: string }) {
  const plan = await db.servicePlan.findFirst({ where: { id: p.planId, organizationId: p.organizationId } });
  if (!plan) throw new CatalogError("Plan not found.");
  const r = await db.planFeature.deleteMany({ where: { id: p.featureId, planId: plan.id } });
  if (r.count > 0) await db.servicePlan.update({ where: { id: plan.id }, data: { version: { increment: 1 } } });
}

// Turns "plan chosen" lines into quote lines using the plan's price in the quote currency, plus a setup-fee line when one is set.
// A plan without a price in that currency is refused rather than guessed or converted.
export async function resolvePlanLines(
  db: Db, p: { organizationId: string; currency: string; lines: { planId?: string; description: string; quantity: string; unitPrice: string }[] },
) {
  const out: { description: string; quantity: string; unitPrice: string; planId?: string; planVersion?: number }[] = [];
  for (const l of p.lines) {
    if (!l.planId) { out.push({ description: l.description, quantity: l.quantity, unitPrice: l.unitPrice }); continue; }
    const plan = await db.servicePlan.findFirst({ where: { id: l.planId, organizationId: p.organizationId, active: true }, include: { prices: true } });
    if (!plan) throw new CatalogError("That plan is no longer available.");
    const price = plan.prices.find((x) => x.currency === p.currency);
    if (!price) throw new CatalogError(`${plan.name} has no ${p.currency} price. Set one in the Service Catalog first.`);
    const qty = l.quantity.trim() || "1";
    out.push({ description: l.description.trim() || plan.name, quantity: qty, unitPrice: l.unitPrice.trim() || price.amount.toString(), planId: plan.id, planVersion: plan.version });
    if (price.setupFee && price.setupFee.gt(0)) out.push({ description: `Setup fee: ${plan.name}`, quantity: "1", unitPrice: price.setupFee.toString(), planId: plan.id, planVersion: plan.version });
  }
  return out;
}
