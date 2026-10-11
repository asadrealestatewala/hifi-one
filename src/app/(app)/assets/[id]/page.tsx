import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { audit, requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";
import { LedgerError } from "@/lib/ledger-math";
import { AssetError, assetValue, assignAsset, disposeAsset } from "@/lib/assets";
import { formatMoney } from "@/lib/money";

export const dynamic = "force-dynamic";

const back = (id: string, m: string): never => redirect(`/assets/${id}?error=${encodeURIComponent(m)}`);

async function assign(formData: FormData) {
  "use server";
  const user = await requirePermission("assets.manage");
  const id = String(formData.get("id"));
  try {
    await assignAsset(db, { organizationId: user.organizationId, assetId: id, userId: String(formData.get("userId") ?? "") || null });
    await audit(user, { action: "asset.assign", entity: "Asset", entityId: id });
  } catch (e) {
    if (e instanceof AssetError) back(id, e.message);
    throw e;
  }
  redirect(`/assets/${id}`);
}

async function dispose(formData: FormData) {
  "use server";
  const user = await requirePermission("assets.post");
  const id = String(formData.get("id"));
  try {
    await disposeAsset(db, {
      organizationId: user.organizationId, assetId: id, date: String(formData.get("date")), proceeds: String(formData.get("proceeds") || "0"),
      bankAccountId: String(formData.get("bankAccountId") ?? "") || undefined, actorId: user.id,
    });
    await audit(user, { action: "asset.dispose", entity: "Asset", entityId: id });
  } catch (e) {
    if (e instanceof AssetError || e instanceof LedgerError) back(id, e.message);
    throw e;
  }
  redirect(`/assets/${id}`);
}

export default async function AssetPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string }> }) {
  const user = await requirePermission("assets.view");
  const { id } = await params;
  const { error } = await searchParams;
  const exists = await db.asset.findFirst({ where: { id, organizationId: user.organizationId } });
  if (!exists) notFound();
  const [v, schedule, history, people, banks] = await Promise.all([
    assetValue(db, id),
    db.depreciationEntry.findMany({ where: { assetId: id }, orderBy: { period: "asc" } }),
    db.assetAssignment.findMany({ where: { assetId: id }, orderBy: { assignedAt: "desc" } }),
    db.user.findMany({ where: { organizationId: user.organizationId, active: true, userType: "EMPLOYEE" }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    db.bankAccount.findMany({ where: { organizationId: user.organizationId, active: true, currency: exists.currency, ledgerAccountId: { not: null } } }),
  ]);
  const a = v.asset;
  const name = (i: string | null) => people.find((p) => p.id === i)?.name ?? "";
  return (
    <div className="space-y-6">
      <Link href="/assets" className="text-sm text-muted hover:underline">← All assets</Link>
      <h1 className="text-2xl font-semibold tracking-tight">{a.name} <span className="text-base font-normal text-muted">{a.number} · {a.status.toLowerCase()}</span></h1>
      {error && <p role="alert" className="text-sm text-brand bg-brand/10 rounded-lg px-3 py-2">{error}</p>}
      <section className="card grid grid-cols-3 gap-y-1 text-sm max-w-2xl">
        {([["Category", a.category], ["Serial number", a.serialNumber], ["Supplier", a.supplier], ["Purchased", a.purchaseDate], ["Cost", formatMoney(a.cost, a.currency)],
          ["Salvage value", formatMoney(a.salvageValue, a.currency)], ["Useful life", `${a.usefulLifeMonths} months`], ["Accumulated depreciation", formatMoney(v.accumulated, a.currency)],
          ["Net book value", a.status === "DISPOSED" ? "Disposed" : formatMoney(v.netBookValue, a.currency)], ["Assigned to", name(a.assignedToId)], ["Location", a.location],
          ["Disposed", a.disposedDate ? `${a.disposedDate} for ${formatMoney(a.disposalProceeds ?? 0, a.currency)}` : null]] as [string, string | null][]).filter(([, x]) => x).map(([k, x]) => (
          <div key={k} className="contents"><span className="text-muted">{k}</span><span className="col-span-2">{x}</span></div>
        ))}
      </section>
      {a.status === "ACTIVE" && user.permissions.has("assets.manage") && (
        <form action={assign} className="card flex flex-wrap items-end gap-2">
          <input type="hidden" name="id" value={a.id} />
          <div><label className="label" htmlFor="userId">Assign to employee (or return)</label>
            <select id="userId" name="userId" className="input"><option value="">Return to stock</option>{people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></div>
          <button className="btn-ghost">Update assignment</button>
        </form>
      )}
      {a.status === "ACTIVE" && user.permissions.has("assets.post") && (
        <form action={dispose} className="card grid gap-3 sm:grid-cols-4">
          <input type="hidden" name="id" value={a.id} />
          <h2 className="font-semibold sm:col-span-4">Dispose of this asset</h2>
          <div><label className="label" htmlFor="date">Disposal date</label><input id="date" name="date" type="date" required className="input" /></div>
          <div><label className="label" htmlFor="proceeds">Sale proceeds (0 if scrapped)</label><input id="proceeds" name="proceeds" inputMode="decimal" defaultValue="0" className="input" /></div>
          <div className="sm:col-span-2"><label className="label" htmlFor="bankAccountId">Proceeds received into</label>
            <select id="bankAccountId" name="bankAccountId" className="input"><option value="">No proceeds</option>{banks.map((b) => <option key={b.id} value={b.id}>{b.internalName}</option>)}</select></div>
          <p className="text-xs text-muted sm:col-span-4">Depreciation must be posted through the disposal month first. The difference between proceeds and net book value is booked as a gain or loss.</p>
          <div className="sm:col-span-4"><button className="btn">Dispose</button></div>
        </form>
      )}
      <section className="card">
        <h2 className="font-semibold mb-2">Depreciation posted</h2>
        {schedule.length === 0 ? <p className="text-sm text-muted">Nothing posted yet.</p> : (
          <ul className="text-sm grid sm:grid-cols-3 gap-x-4">{schedule.map((d) => <li key={d.id}>{d.period}: {formatMoney(d.amount, a.currency)}</li>)}</ul>
        )}
      </section>
      <section className="card">
        <h2 className="font-semibold mb-2">Assignment history</h2>
        {history.length === 0 ? <p className="text-sm text-muted">Never assigned.</p> : (
          <ul className="text-sm">{history.map((h) => <li key={h.id}>{name(h.userId)}: {h.assignedAt.toLocaleDateString()} to {h.returnedAt ? h.returnedAt.toLocaleDateString() : "now"}</li>)}</ul>
        )}
      </section>
    </div>
  );
}
