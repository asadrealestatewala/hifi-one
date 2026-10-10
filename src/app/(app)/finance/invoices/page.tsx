import Link from "next/link";
import { redirect } from "next/navigation";
import { z } from "zod";
import { audit, requirePermission } from "@/lib/auth";
import { createDraftInvoice, LedgerError } from "@/lib/accounting";
import { db } from "@/lib/db";
import { formatMoney } from "@/lib/money";

export const dynamic = "force-dynamic";

const num = z.string().regex(/^\d{1,10}(\.\d{1,2})?$/);

async function createInvoice(formData: FormData) {
  "use server";
  const user = await requirePermission("finance.post");
  const fail = (m: string) => redirect(`/finance/invoices?error=${encodeURIComponent(m)}`);
  const clientId = String(formData.get("clientId") ?? "");
  const currency = z.enum(["PKR", "USD", "AED", "GBP"]).safeParse(formData.get("currency"));
  const taxRate = z.string().regex(/^\d{1,3}(\.\d{1,2})?$/).safeParse(formData.get("taxRate") || "0");
  if (!clientId || !currency.success || !taxRate.success) return fail("Choose a client, a currency and a valid tax rate.");
  const lines: { description: string; quantity: string; unitPrice: string }[] = [];
  for (let i = 0; i < 6; i++) {
    const description = String(formData.get(`desc${i}`) ?? "").trim();
    const quantity = String(formData.get(`qty${i}`) ?? "").trim();
    const unitPrice = String(formData.get(`price${i}`) ?? "").trim();
    if (!description && !quantity && !unitPrice) continue;
    if (!description || !num.safeParse(quantity).success || !num.safeParse(unitPrice).success) {
      return fail(`Line ${i + 1}: enter a description, a quantity and a unit price.`);
    }
    lines.push({ description, quantity, unitPrice });
  }
  let id: string;
  try {
    const inv = await createDraftInvoice(db, {
      organizationId: user.organizationId, clientId, currency: currency.data, taxRate: taxRate.data,
      notes: String(formData.get("notes") ?? "").trim() || null, createdById: user.id, lines,
    });
    id = inv.id;
    await audit(user, { action: "invoice.create_draft", entity: "Invoice", entityId: inv.id, after: { total: inv.total.toString(), currency } });
  } catch (e) {
    if (e instanceof LedgerError) return fail(e.message);
    throw e;
  }
  redirect(`/finance/invoices/${id}`);
}

export default async function Invoices({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const user = await requirePermission("finance.view");
  const { error } = await searchParams;
  const canPost = user.permissions.has("finance.post");
  const [invoices, clients] = await Promise.all([
    db.invoice.findMany({ where: { organizationId: user.organizationId }, orderBy: { createdAt: "desc" }, take: 200, include: { client: true } }),
    db.client.findMany({ where: { organizationId: user.organizationId, active: true }, orderBy: { name: "asc" } }),
  ]);
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Invoices</h1>
      <div className="card overflow-x-auto">
        {invoices.length === 0 ? <p className="text-sm text-muted">No invoices yet.</p> : (
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-muted">
              <tr><th className="py-2 pr-4">Number</th><th className="pr-4">Client</th><th className="pr-4">Status</th><th className="pr-4 text-right">Total</th><th className="text-right">Outstanding</th></tr>
            </thead>
            <tbody>
              {invoices.map((i) => (
                <tr key={i.id} className="border-t border-border">
                  <td className="py-2 pr-4"><Link className="hover:underline font-medium" href={`/finance/invoices/${i.id}`}>{i.number ?? "Draft"}</Link></td>
                  <td className="pr-4">{i.client.name}</td>
                  <td className="pr-4">{i.status.replace("_", " ")}</td>
                  <td className="pr-4 text-right">{formatMoney(i.total, i.currency)}</td>
                  <td className="text-right">{i.status === "DRAFT" || i.status === "CANCELLED" ? "" : formatMoney(i.total.sub(i.amountPaid), i.currency)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {canPost && (
        <form action={createInvoice} className="card grid gap-4 sm:grid-cols-3">
          <h2 className="font-semibold sm:col-span-3">New invoice (saved as draft)</h2>
          {error && <p role="alert" className="sm:col-span-3 text-sm text-brand bg-brand/10 rounded-lg px-3 py-2">{error}</p>}
          <div>
            <label className="label" htmlFor="clientId">Client</label>
            <select id="clientId" name="clientId" required className="input">
              <option value="">Choose…</option>
              {clients.map((c) => <option key={c.id} value={c.id}>{c.name} ({c.currency})</option>)}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="currency">Currency</label>
            <select id="currency" name="currency" className="input" defaultValue="USD">
              {["PKR", "USD", "AED", "GBP"].map((c) => <option key={c}>{c}</option>)}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="taxRate">Tax rate (%)</label>
            <input id="taxRate" name="taxRate" defaultValue="0" className="input" />
          </div>
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="sm:col-span-3 grid gap-2 grid-cols-[1fr_5rem_8rem]">
              <input name={`desc${i}`} placeholder={i === 0 ? "Description" : "Description (optional)"} aria-label={`Line ${i + 1} description`} className="input" />
              <input name={`qty${i}`} placeholder="Qty" aria-label={`Line ${i + 1} quantity`} className="input" />
              <input name={`price${i}`} placeholder="Unit price" aria-label={`Line ${i + 1} unit price`} className="input" />
            </div>
          ))}
          <div className="sm:col-span-3">
            <label className="label" htmlFor="notes">Notes</label>
            <textarea id="notes" name="notes" rows={2} className="input" />
          </div>
          <div className="sm:col-span-3"><button className="btn">Save draft</button></div>
        </form>
      )}
    </div>
  );
}
