import Link from "next/link";
import { redirect } from "next/navigation";
import { audit, requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";
import { LedgerError } from "@/lib/ledger-math";
import { AssetError, registerAsset, runDepreciation } from "@/lib/assets";
import { formatMoney } from "@/lib/money";

export const dynamic = "force-dynamic";

async function register(formData: FormData) {
  "use server";
  const user = await requirePermission("assets.manage");
  const bankAccountId = String(formData.get("bankAccountId") ?? "");
  let id: string;
  try {
    const a = await registerAsset(db, {
      organizationId: user.organizationId, actorId: user.id, name: String(formData.get("name") ?? ""), category: String(formData.get("category") ?? ""),
      serialNumber: String(formData.get("serialNumber") ?? ""), supplier: String(formData.get("supplier") ?? ""), purchaseDate: String(formData.get("purchaseDate")),
      cost: String(formData.get("cost") ?? ""), salvageValue: String(formData.get("salvageValue") ?? ""), currency: String(formData.get("currency")),
      usefulLifeMonths: Number(formData.get("usefulLifeMonths")), location: String(formData.get("location") ?? ""),
      payment: bankAccountId ? { kind: "BANK", bankAccountId } : { kind: "PAYABLE" },
    });
    id = a.id;
    await audit(user, { action: "asset.register", entity: "Asset", entityId: a.id, after: { number: a.number, cost: a.cost.toString(), currency: a.currency } });
  } catch (e) {
    if (e instanceof AssetError || e instanceof LedgerError) redirect(`/assets?error=${encodeURIComponent(e.message)}`);
    throw e;
  }
  redirect(`/assets/${id}`);
}

async function depreciate(formData: FormData) {
  "use server";
  const user = await requirePermission("assets.post");
  let n: number;
  try {
    const r = await runDepreciation(db, { organizationId: user.organizationId, upTo: String(formData.get("upTo")), actorId: user.id });
    n = r.postedLines;
    await audit(user, { action: "asset.run_depreciation", entity: "Asset", after: { upTo: String(formData.get("upTo")), lines: n } });
  } catch (e) {
    if (e instanceof AssetError || e instanceof LedgerError) redirect(`/assets?error=${encodeURIComponent(e.message)}`);
    throw e;
  }
  redirect(`/assets?done=${n}`);
}

export default async function Assets({ searchParams }: { searchParams: Promise<{ error?: string; done?: string }> }) {
  const user = await requirePermission("assets.view");
  const { error, done } = await searchParams;
  const [assets, banks, dep] = await Promise.all([
    db.asset.findMany({ where: { organizationId: user.organizationId }, orderBy: { number: "asc" } }),
    db.bankAccount.findMany({ where: { organizationId: user.organizationId, active: true, ledgerAccountId: { not: null } } }),
    db.depreciationEntry.groupBy({ by: ["assetId"], _sum: { amount: true } }),
  ]);
  const accumulated = new Map(dep.map((d) => [d.assetId, d._sum.amount?.toString() ?? "0"]));
  const month = new Date().toISOString().slice(0, 7);
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">Fixed Assets</h1>
      <p className="text-sm text-muted">Purchases here are capitalised, not expensed. Straight-line depreciation starts in the month of purchase. Items below your capitalisation threshold belong in expense vouchers; a threshold setting is not built yet.</p>
      {done && <p className="text-sm bg-green-600/10 text-green-700 rounded-lg px-3 py-2">Depreciation posted ({done} asset-months). Running it again only adds missing months.</p>}
      {error && <p role="alert" className="text-sm text-brand bg-brand/10 rounded-lg px-3 py-2">{error}</p>}
      <div className="card overflow-x-auto">
        {assets.length === 0 ? <p className="text-sm text-muted">No assets yet.</p> : (
          <table className="w-full text-sm">
            <thead className="bg-hover/60 text-left text-xs text-muted"><tr><th className="py-2 pr-4">No.</th><th className="pr-4">Asset</th><th className="pr-4">Purchased</th><th className="pr-4 text-right">Cost</th><th className="pr-4 text-right">Net book value</th><th>Status</th></tr></thead>
            <tbody>
              {assets.map((a) => (
                <tr key={a.id} className="border-t border-border transition hover:bg-hover/50">
                  <td className="py-2 pr-4 text-muted">{a.number}</td>
                  <td className="pr-4 font-medium"><Link className="hover:underline" href={`/assets/${a.id}`}>{a.name}</Link></td>
                  <td className="pr-4">{a.purchaseDate}</td><td className="pr-4 text-right">{formatMoney(a.cost, a.currency)}</td>
                  <td className="pr-4 text-right">{a.status === "DISPOSED" ? "" : formatMoney(Number(a.cost) - Number(accumulated.get(a.id) ?? 0), a.currency)}</td>
                  <td>{a.status.toLowerCase()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {user.permissions.has("assets.post") && (
        <form action={depreciate} className="card flex flex-wrap items-end gap-3">
          <div><label className="label" htmlFor="upTo">Post depreciation up to month</label><input id="upTo" name="upTo" type="month" defaultValue={month} required className="input" /></div>
          <button className="btn">Run depreciation</button>
        </form>
      )}
      {user.permissions.has("assets.manage") && (
        <form action={register} className="card grid gap-4 sm:grid-cols-3">
          <h2 className="font-semibold sm:col-span-3">Register an asset purchase</h2>
          <div><label className="label" htmlFor="name">Name</label><input id="name" name="name" required className="input" /></div>
          <div><label className="label" htmlFor="category">Category</label><input id="category" name="category" placeholder="Laptop, Furniture…" className="input" /></div>
          <div><label className="label" htmlFor="serialNumber">Serial number</label><input id="serialNumber" name="serialNumber" className="input" /></div>
          <div><label className="label" htmlFor="supplier">Supplier</label><input id="supplier" name="supplier" className="input" /></div>
          <div><label className="label" htmlFor="purchaseDate">Purchase date</label><input id="purchaseDate" name="purchaseDate" type="date" required className="input" /></div>
          <div><label className="label" htmlFor="location">Location</label><input id="location" name="location" className="input" /></div>
          <div><label className="label" htmlFor="cost">Cost</label><input id="cost" name="cost" required inputMode="decimal" className="input" /></div>
          <div><label className="label" htmlFor="salvageValue">Salvage value</label><input id="salvageValue" name="salvageValue" inputMode="decimal" defaultValue="0" className="input" /></div>
          <div><label className="label" htmlFor="usefulLifeMonths">Useful life (months)</label><input id="usefulLifeMonths" name="usefulLifeMonths" type="number" defaultValue={36} min={1} className="input" /></div>
          <div><label className="label" htmlFor="currency">Currency</label><select id="currency" name="currency" className="input">{["USD", "PKR", "AED", "GBP"].map((c) => <option key={c}>{c}</option>)}</select></div>
          <div className="sm:col-span-2"><label className="label" htmlFor="bankAccountId">Paid from (leave empty if still owed to the supplier)</label>
            <select id="bankAccountId" name="bankAccountId" className="input"><option value="">Not paid yet (record as payable)</option>{banks.map((b) => <option key={b.id} value={b.id}>{b.internalName} ({b.currency})</option>)}</select></div>
          <div className="sm:col-span-3"><button className="btn">Register asset</button></div>
        </form>
      )}
    </div>
  );
}
