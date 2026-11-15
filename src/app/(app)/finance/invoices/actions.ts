"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { audit, requirePermission } from "@/lib/auth";
import { createDraftInvoice, LedgerError, updateDraftInvoice } from "@/lib/accounting";
import { db } from "@/lib/db";
import { TEMPLATE_KEYS } from "@/lib/pdf";

const num = z.string().regex(/^\d{1,10}(\.\d{1,2})?$/);

// Saves the invoice editor: a new draft, or changes to an existing draft. Issued invoices are refused by the service.
export async function saveInvoiceAction(formData: FormData): Promise<void> {
  const user = await requirePermission("finance.post");
  const id = String(formData.get("id") ?? "").trim() || null;
  const back = id ? `/finance/invoices/${id}/edit` : "/finance/invoices/new";
  const fail = (m: string): never => redirect(`${back}?error=${encodeURIComponent(m)}`);
  const clientId = String(formData.get("clientId") ?? "");
  const currency = z.enum(["PKR", "USD", "AED", "GBP"]).safeParse(formData.get("currency"));
  const taxRate = z.string().regex(/^\d{1,3}(\.\d{1,2})?$/).safeParse(formData.get("taxRate") || "0");
  if (!clientId || !currency.success || !taxRate.success) return fail("Choose a client, a currency and a valid tax rate.");
  const lines: { description: string; quantity: string; unitPrice: string }[] = [];
  for (let i = 0; i < 20; i++) {
    const description = String(formData.get(`desc${i}`) ?? "").replace(/\r/g, "").trim();
    const quantity = String(formData.get(`qty${i}`) ?? "").trim();
    const unitPrice = String(formData.get(`price${i}`) ?? "").trim();
    if (!description && !quantity && !unitPrice) continue;
    if (!description || !num.safeParse(quantity).success || !num.safeParse(unitPrice).success) return fail(`Line ${i + 1}: enter a description, a quantity and a unit price.`);
    if (description.length > 1000) return fail(`Line ${i + 1}: keep the description under 1,000 characters.`);
    lines.push({ description, quantity, unitPrice });
  }
  const notes = String(formData.get("notes") ?? "").trim().slice(0, 2000) || null;
  const tk = String(formData.get("templateKey") ?? "");
  const templateKey = TEMPLATE_KEYS.includes(tk) ? tk : null;
  let saved: string;
  try {
    if (id) {
      const inv = await updateDraftInvoice(db, { organizationId: user.organizationId, invoiceId: id, clientId, currency: currency.data, taxRate: taxRate.data, notes, templateKey, lines });
      await audit(user, { action: "invoice.update_draft", entity: "Invoice", entityId: inv.id, after: { total: inv.total.toString(), currency: inv.currency, template: templateKey, lines: lines.length } });
      saved = inv.id;
    } else {
      const inv = await createDraftInvoice(db, { organizationId: user.organizationId, clientId, currency: currency.data, taxRate: taxRate.data, notes, createdById: user.id, lines });
      if (templateKey) await db.invoice.update({ where: { id: inv.id }, data: { templateKey } });
      await audit(user, { action: "invoice.create_draft", entity: "Invoice", entityId: inv.id, after: { total: inv.total.toString(), currency: inv.currency, template: templateKey } });
      saved = inv.id;
    }
  } catch (e) {
    if (e instanceof LedgerError) return fail(e.message);
    throw e;
  }
  redirect(`/finance/invoices/${saved}?saved=1`);
}
