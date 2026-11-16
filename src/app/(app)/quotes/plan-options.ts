// Catalog plans for the proposal editor, with their prices by currency so a picked plan fills its line at once.
import { db } from "@/lib/db";
import type { PlanOpt } from "@/components/ui/LineItems";

export async function loadPlanOptions(organizationId: string): Promise<PlanOpt[]> {
  const plans = await db.servicePlan.findMany({
    where: { organizationId, active: true, category: { active: true } }, orderBy: [{ category: { sortOrder: "asc" } }, { sortOrder: "asc" }], include: { category: true, prices: true },
  });
  return plans.map((p) => ({
    id: p.id, label: `${p.category.name}: ${p.name}`, name: p.name,
    prices: Object.fromEntries(p.prices.map((x) => [x.currency, { amount: x.amount.toString(), setupFee: x.setupFee ? x.setupFee.toString() : null }])),
  }));
}
