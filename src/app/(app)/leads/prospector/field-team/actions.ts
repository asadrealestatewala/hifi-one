"use server";

import { redirect } from "next/navigation";
import { audit, requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";
import { CommissionError, setProductRate } from "@/lib/commissions";
import { saveProduct, setAgentProfile } from "@/lib/field-visits";
import { ProspectorError } from "@/lib/prospector";
import { createAssetsProject, linkAssetsProject, saveProductDetails } from "@/lib/product-details";

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

// ---------- product details page ----------
const detailsBase = (id: string) => `${BASE}/${encodeURIComponent(id)}`;
const detailsFlash = (id: string, kind: "error" | "ok", m: string): never => redirect(`${detailsBase(id)}?${kind}=${encodeURIComponent(m)}`);

// What agents need to pitch the product: tagline, description, who it is for, key features, pricing, demo link and pitch notes.
export async function saveProductDetailsAction(formData: FormData): Promise<void> {
  const user = await requirePermission("field.review");
  const id = s(formData, "id");
  try {
    const row = await saveProductDetails(db, user, id, {
      tagline: s(formData, "tagline"), description: s(formData, "description"), targetCustomers: s(formData, "targetCustomers"), keyFeatures: s(formData, "keyFeatures"),
      pricing: s(formData, "pricing"), demoUrl: s(formData, "demoUrl"), pitchNotes: s(formData, "pitchNotes"),
    });
    await audit(user, { action: "field.product.details", entity: "SaasProduct", entityId: row.id, after: { name: row.name } });
    return detailsFlash(id, "ok", "Details saved.");
  } catch (e) {
    if (e instanceof ProspectorError) return detailsFlash(id, "error", e.message);
    throw e;
  }
}

// Creates the project that holds this product's brand assets (the person who clicks manages it) and links it.
export async function createProductAssetsAction(formData: FormData): Promise<void> {
  const user = await requirePermission("field.review");
  const id = s(formData, "id");
  try {
    const p = await createAssetsProject(db, user, id);
    await audit(user, { action: "field.product.assets_created", entity: "SaasProduct", entityId: id, after: { project: p.id, number: p.number } });
    return detailsFlash(id, "ok", `Brand assets library ${p.number} created. Add the brand guide, logos and videos below.`);
  } catch (e) {
    if (e instanceof ProspectorError) return detailsFlash(id, "error", e.message);
    throw e;
  }
}

// Points the product at an existing project's library, or (empty choice) detaches it. The files stay in the project.
export async function linkProductAssetsAction(formData: FormData): Promise<void> {
  const user = await requirePermission("field.review");
  const id = s(formData, "id");
  const projectId = s(formData, "projectId") || null;
  try {
    await linkAssetsProject(db, user, id, projectId);
    await audit(user, { action: projectId ? "field.product.assets_linked" : "field.product.assets_unlinked", entity: "SaasProduct", entityId: id, after: { project: projectId } });
    return detailsFlash(id, "ok", projectId ? "Library linked." : "Library detached. The files stay in their project.");
  } catch (e) {
    if (e instanceof ProspectorError) return detailsFlash(id, "error", e.message);
    throw e;
  }
}
