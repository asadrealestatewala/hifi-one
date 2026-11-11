"use server";

import { redirect } from "next/navigation";
import { audit, requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";
import { CommissionError, setProductRate } from "@/lib/commissions";
import { saveProduct, setAgentProfile } from "@/lib/field-visits";
import { ProspectorError } from "@/lib/prospector";

const BASE = "/leads/prospector/field-team";
const s = (f: FormData, k: string) => String(f.get(k) ?? "");
const flash = (kind: "error" | "ok", m: string): never => redirect(`${BASE}?${kind}=${encodeURIComponent(m)}`);

// Add or change a SaaS product (name, what a prospect is called, website, daily visit target, on or off). Sales managers only.
export async function saveProductAction(formData: FormData): Promise<void> {
  const user = await requirePermission("field.review");
  try {
    const row = await saveProduct(db, user, {
      id: s(formData, "id") || undefined, code: s(formData, "code"), name: s(formData, "name"), businessLabel: s(formData, "businessLabel"), website: s(formData, "website"),
      dailyVisitTarget: s(formData, "dailyVisitTarget") || undefined, active: formData.get("active") === "on", sortOrder: s(formData, "sortOrder") || 0,
    });
    await audit(user, { action: "field.product.save", entity: "SaasProduct", entityId: row.id, after: { code: row.code, name: row.name, dailyVisitTarget: row.dailyVisitTarget, active: row.active } });
    return flash("ok", `${row.name} saved.`);
  } catch (e) {
    if (e instanceof ProspectorError) return flash("error", e.message);
    throw e;
  }
}

// Put a salesperson on a product, as an office or field agent, with their own daily target if it differs from the product's.
export async function saveAgentAction(formData: FormData): Promise<void> {
  const user = await requirePermission("field.review");
  const userId = s(formData, "userId");
  try {
    const row = await setAgentProfile(db, user, { userId, productId: s(formData, "productId") || null, kind: s(formData, "kind"), dailyVisitTarget: s(formData, "dailyVisitTarget") || null });
    await audit(user, { action: "field.agent.save", entity: "SalesAgentProfile", entityId: userId, after: { productId: row.productId, kind: row.kind, dailyVisitTarget: row.dailyVisitTarget } });
    return flash("ok", "Saved.");
  } catch (e) {
    if (e instanceof ProspectorError) return flash("error", e.message);
    throw e;
  }
}

// What a product pays the sales agent and manager on a client's first subscription invoice (not renewals). Needs the commissions permission as well,
// because it decides what people are paid.
export async function saveProductCommissionAction(formData: FormData): Promise<void> {
  const user = await requirePermission("commissions.manage");
  const productId = s(formData, "productId");
  try {
    for (const [role, field] of [["SALES_AGENT", "agentPercent"], ["SALES_MANAGER", "managerPercent"]] as const) {
      const v = s(formData, field).trim();
      const r = await setProductRate(db, { organizationId: user.organizationId, productId, role, ratePercent: v === "" ? "0" : v, active: v !== "" && Number(v) > 0, actorId: user.id });
      await audit(user, { action: "commission.product_rate", entity: "ProductCommissionRate", entityId: r.row.id, before: r.before ? { rate: r.before.ratePercent.toString(), active: r.before.active } : null, after: { productId, role, rate: r.row.ratePercent.toString(), active: r.row.active } });
    }
    return flash("ok", "Commission saved. It applies to first subscription payments received from now on.");
  } catch (e) {
    if (e instanceof CommissionError) return flash("error", e.message);
    throw e;
  }
}
