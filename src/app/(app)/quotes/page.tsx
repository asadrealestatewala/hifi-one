import Link from "next/link";
import { redirect } from "next/navigation";
import { audit, requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";
import { formatMoney } from "@/lib/money";
import { SalesError, createQuote, expireQuotes } from "@/lib/sales";

export const dynamic = "force-dynamic";

async function create(formData: FormData) {
  "use server";
  const user = await requirePermission("quotes.manage");
  const fail = (m: string) => redirect(`/quotes?error=${encodeURIComponent(m)}`);
  const lines: { description: string; quantity: string; unitPrice: string }[] = [];
  for (let i = 0; i < 6; i++) {
    const description = String(formData.get(`desc${i}`) ?? "").trim();
    const quantity = String(formData.get(`qty${i}`) ?? "").trim();
    const unitPrice = String(formData.get(`price${i}`) ?? "").trim();
    if (description || quantity || unitPrice) lines.push({ description, quantity, unitPrice });
  }
  let id: string;
  try {
    const q = await createQuote(db, {
      organizationId: user.organizationId, clientId: String(formData.get("clientId") ?? ""), currency: String(formData.get("currency") ?? ""),
      taxRate: String(formData.get("taxRate") || "0"), validUntil: String(formData.get("validUntil") ?? "") || null,
      notes: String(formData.get("notes") ?? "").trim() || null, terms: String(formData.get("terms") ?? "").trim() || null, createdById: user.id, lines,
    });
    id = q.id;
    await audit(user, { action: "quote.create", entity: "Quote", entityId: q.id, after: { number: q.number, total: q.total.toString(), currency: q.currency } });
  } catch (e) {
    if (e instanceof SalesError) return fail(e.message);
    throw e;
  }
  redirect(`/quotes/${id}`);
}

export default async function Quotes({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const user = await requirePermission("quotes.view");
  const { error } = await searchParams;
  const org = user.organizationId;
  await expireQuotes(db, org, new Date().toISOString().slice(0, 10));
  const canManage = user.permissions.has("quotes.manage");
  const [quotes, clients] = await Promise.all([
    db.quote.findMany({ where: { organizationId: org }, orderBy: { createdAt: "desc" }, take: 200, include: { client: true } }),
    db.client.findMany({ where: { organizationId: org, active: true }, orderBy: { name: "asc" } }),
  ]);
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Quotations</h1>
      <div className="card overflow-x-auto">
        {quotes.length === 0 ? <p className="text-sm text-muted">No quotations yet.</p> : (
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-muted"><tr><th className="py-2 pr-4">Number</th><th className="pr-4">Client</th><th className="pr-4">Status</th><th className="pr-4">Valid until</th><th className="text-right">Total</th></tr></thead>
            <tbody>
              {quotes.map((q) => (
                <tr key={q.id} className="border-t border-border">
                  <td className="py-2 pr-4"><Link className="hover:underline font-medium" href={`/quotes/${q.id}`}>{q.number}</Link></td>
                  <td className="pr-4">{q.client.name}</td><td className="pr-4">{q.status.toLowerCase()}</td><td className="pr-4">{q.validUntil ?? ""}</td>
                  <td className="text-right">{formatMoney(q.total, q.currency)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {canManage && (
        <form action={create} className="card grid gap-4 sm:grid-cols-4">
          <h2 className="font-semibold sm:col-span-4">New quotation (saved as draft)</h2>
          {error && <p role="alert" className="sm:col-span-4 text-sm text-brand bg-brand/10 rounded-lg px-3 py-2">{error}</p>}
          <div><label className="label" htmlFor="clientId">Client</label>
            <select id="clientId" name="clientId" required className="input"><option value="">Choose…</option>{clients.map((c) => <option key={c.id} value={c.id}>{c.name} ({c.currency})</option>)}</select></div>
          <div><label className="label" htmlFor="currency">Currency</label>
            <select id="currency" name="currency" className="input" defaultValue="USD">{["PKR", "USD", "AED", "GBP"].map((c) => <option key={c}>{c}</option>)}</select></div>
          <div><label className="label" htmlFor="taxRate">Tax rate (%)</label><input id="taxRate" name="taxRate" defaultValue="0" className="input" /></div>
          <div><label className="label" htmlFor="validUntil">Valid until</label><input id="validUntil" name="validUntil" type="date" className="input" /></div>
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="sm:col-span-4 grid gap-2 grid-cols-[1fr_5rem_8rem]">
              <input name={`desc${i}`} placeholder={i === 0 ? "Description" : "Description (optional)"} aria-label={`Line ${i + 1} description`} className="input" />
              <input name={`qty${i}`} placeholder="Qty" aria-label={`Line ${i + 1} quantity`} className="input" />
              <input name={`price${i}`} placeholder="Unit price" aria-label={`Line ${i + 1} unit price`} className="input" />
            </div>
          ))}
          <div className="sm:col-span-2"><label className="label" htmlFor="notes">Notes</label><textarea id="notes" name="notes" rows={2} className="input" /></div>
          <div className="sm:col-span-2"><label className="label" htmlFor="terms">Terms</label><textarea id="terms" name="terms" rows={2} className="input" placeholder="e.g. 50% upfront, balance on delivery" /></div>
          <div className="sm:col-span-4"><button className="btn">Save draft</button></div>
        </form>
      )}
    </div>
  );
}
