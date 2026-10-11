import { redirect } from "next/navigation";
import { audit, requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";
import { TaxError, addTaxRate, setTaxRateActive } from "@/lib/tax";

export const dynamic = "force-dynamic";

async function add(formData: FormData) {
  "use server";
  const user = await requirePermission("settings.company.edit");
  try {
    const r = await addTaxRate(db, { organizationId: user.organizationId, name: String(formData.get("name") ?? ""), ratePercent: String(formData.get("ratePercent") ?? "") });
    await audit(user, { action: "tax_rate.add", entity: "TaxRate", entityId: r.id, after: { name: r.name, ratePercent: r.ratePercent.toString() } });
  } catch (e) {
    if (e instanceof TaxError) redirect(`/settings/tax-rates?error=${encodeURIComponent(e.message)}`);
    throw e;
  }
  redirect("/settings/tax-rates");
}

async function toggle(formData: FormData) {
  "use server";
  const user = await requirePermission("settings.company.edit");
  const id = String(formData.get("id") ?? "");
  const active = formData.get("active") === "true";
  try {
    await setTaxRateActive(db, { organizationId: user.organizationId, id, active });
    await audit(user, { action: active ? "tax_rate.enable" : "tax_rate.disable", entity: "TaxRate", entityId: id });
  } catch (e) {
    if (e instanceof TaxError) redirect(`/settings/tax-rates?error=${encodeURIComponent(e.message)}`);
    throw e;
  }
  redirect("/settings/tax-rates");
}

export default async function TaxRates({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const user = await requirePermission("settings.company.view");
  const { error } = await searchParams;
  const canEdit = user.permissions.has("settings.company.edit");
  const rates = await db.taxRate.findMany({ where: { organizationId: user.organizationId }, orderBy: [{ active: "desc" }, { name: "asc" }] });
  return (
    <div className="space-y-5 max-w-2xl">
      <h1 className="text-2xl font-bold">Tax rates</h1>
      <p className="text-sm text-muted">Named rates are offered as suggestions when you write an invoice, quotation or subscription. An invoice always keeps the percentage it was issued with, so changing this list never alters existing documents.</p>
      {error && <p role="alert" className="text-sm text-brand bg-brand/10 rounded-lg px-3 py-2">{error}</p>}
      <div className="card">
        {rates.length === 0 ? <p className="text-sm text-muted">No tax rates yet.</p> : (
          <ul className="text-sm">
            {rates.map((r) => (
              <li key={r.id} className="flex items-center justify-between border-t border-border py-2 first:border-0">
                <span className={r.active ? "" : "text-muted line-through"}>{r.name} · {r.ratePercent.toString()}%</span>
                {canEdit && <form action={toggle}><input type="hidden" name="id" value={r.id} /><input type="hidden" name="active" value={String(!r.active)} /><button className="underline text-xs">{r.active ? "Turn off" : "Turn on"}</button></form>}
              </li>
            ))}
          </ul>
        )}
      </div>
      {canEdit && (
        <form action={add} className="card flex flex-wrap items-end gap-3">
          <div><label className="label" htmlFor="name">Name</label><input id="name" name="name" required maxLength={60} className="input" placeholder="e.g. VAT 5%" /></div>
          <div><label className="label" htmlFor="ratePercent">Rate (%)</label><input id="ratePercent" name="ratePercent" required inputMode="decimal" className="input !w-28" /></div>
          <button className="btn">Add rate</button>
        </form>
      )}
    </div>
  );
}
