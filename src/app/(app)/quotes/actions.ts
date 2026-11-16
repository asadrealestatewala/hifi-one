"use server";

import { redirect } from "next/navigation";
import { audit, requirePermission } from "@/lib/auth";
import { CatalogError, resolvePlanLines } from "@/lib/catalog";
import { db } from "@/lib/db";
import { SalesError, createQuote, updateDraftQuote } from "@/lib/sales";

// Saves the proposal and quotation editor: a new draft, or changes to an existing draft. Sent quotes are refused by the service.
export async function saveQuoteAction(formData: FormData): Promise<void> {
  const user = await requirePermission("quotes.manage");
  const org = user.organizationId;
  const id = String(formData.get("id") ?? "").trim() || null;
  const back = id ? `/quotes/${id}/edit` : "/quotes/new";
  const fail = (m: string): never => redirect(`${back}?error=${encodeURIComponent(m)}`);
  const s = (k: string) => String(formData.get(k) ?? "");
  const currency = s("currency");
  type Raw = { planId?: string; description: string; quantity: string; unitPrice: string; keep?: string };
  const raw: Raw[] = [];
  for (let i = 0; i < 20; i++) {
    const description = s(`desc${i}`).replace(/\r/g, "").trim();
    const quantity = s(`qty${i}`).trim();
    const unitPrice = s(`price${i}`).trim();
    const planId = s(`plan${i}`) || undefined;
    const keep = s(`keep${i}`) || undefined;
    if (description.length > 1000) return fail(`Line ${i + 1}: keep the description under 1,000 characters.`);
    if (description || quantity || unitPrice || planId) raw.push({ planId, description, quantity, unitPrice, keep });
  }
  let saved: string;
  try {
    // Lines already saved from a plan keep their plan reference as they are; new plan lines are priced from the catalog
    const kept = new Set<string>();
    const keepIds = [...new Set(raw.filter((l) => l.keep && !l.planId).map((l) => l.keep!.split(":")[0]))];
    if (keepIds.length) for (const p of await db.servicePlan.findMany({ where: { id: { in: keepIds }, organizationId: org }, select: { id: true } })) kept.add(p.id);
    const lines: { description: string; quantity: string; unitPrice: string; planId?: string; planVersion?: number }[] = [];
    for (const l of raw) {
      if (l.planId) { lines.push(...await resolvePlanLines(db, { organizationId: org, currency, lines: [l] })); continue; }
      const [planId, ver] = (l.keep ?? "").split(":");
      lines.push({ description: l.description, quantity: l.quantity, unitPrice: l.unitPrice, ...(planId && kept.has(planId) ? { planId, planVersion: Number(ver) || undefined } : {}) });
    }
    const input = {
      organizationId: org, clientId: s("clientId"), currency, taxRate: s("taxRate") || "0", validUntil: s("validUntil") || null,
      notes: s("notes").trim().slice(0, 2000) || null, terms: s("terms").trim().slice(0, 3000) || null, templateKey: s("templateKey") || null,
      title: s("title"), introduction: s("introduction"), scope: s("scope"), timeline: s("timeline"), lines,
    };
    if (id) {
      const q = await updateDraftQuote(db, { ...input, quoteId: id });
      await audit(user, { action: "quote.update_draft", entity: "Quote", entityId: q.id, after: { total: q.total.toString(), currency: q.currency, lines: lines.length, proposal: Boolean(q.introduction || q.scope || q.timeline) } });
      saved = q.id;
    } else {
      const q = await createQuote(db, { ...input, createdById: user.id });
      await audit(user, { action: "quote.create", entity: "Quote", entityId: q.id, after: { number: q.number, total: q.total.toString(), currency: q.currency, proposal: Boolean(q.introduction || q.scope || q.timeline) } });
      saved = q.id;
    }
  } catch (e) {
    if (e instanceof SalesError || e instanceof CatalogError) return fail(e.message);
    throw e;
  }
  redirect(`/quotes/${saved}?saved=1`);
}
