import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { audit, requirePermission } from "@/lib/auth";
import { CatalogError, INTERVALS, addFeature, removeFeature, removePlanPrice, setPlanPrice, updatePlan } from "@/lib/catalog";
import { db } from "@/lib/db";
import { CURRENCIES, formatMoney } from "@/lib/money";
import { Notice } from "@/components/ui";

export const dynamic = "force-dynamic";

async function act(formData: FormData) {
  "use server";
  const user = await requirePermission("catalog.edit");
  const org = user.organizationId;
  const planId = String(formData.get("planId") ?? "");
  const op = String(formData.get("op") ?? "");
  const s = (k: string) => String(formData.get(k) ?? "");
  try {
    if (op === "details") {
      await updatePlan(db, { organizationId: org, planId, name: s("name"), tagline: s("tagline"), billingInterval: s("billingInterval"), isPopular: formData.get("isPopular") === "on", isPublic: formData.get("isPublic") === "on", active: formData.get("active") === "on" });
    } else if (op === "price") {
      await setPlanPrice(db, { organizationId: org, planId, currency: s("currency"), amount: s("amount").trim(), setupFee: s("setupFee").trim() || null });
    } else if (op === "removePrice") {
      await removePlanPrice(db, { organizationId: org, planId, currency: s("currency") });
    } else if (op === "feature") {
      await addFeature(db, { organizationId: org, planId, text: s("text") });
    } else if (op === "removeFeature") {
      await removeFeature(db, { organizationId: org, planId, featureId: s("featureId") });
    } else {
      redirect(`/services/${planId}?error=Unknown%20action`);
    }
    await audit(user, { action: `catalog.${op}`, entity: "ServicePlan", entityId: planId, after: { currency: s("currency") || undefined, amount: s("amount") || undefined, name: s("name") || undefined } });
  } catch (e) {
    if (e instanceof CatalogError) redirect(`/services/${planId}?error=${encodeURIComponent(e.message)}`);
    throw e;
  }
  redirect(`/services/${planId}?saved=1`);
}

export default async function PlanEditor({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string; saved?: string }> }) {
  const user = await requirePermission("catalog.view");
  const { id } = await params;
  const sp = await searchParams;
  const plan = await db.servicePlan.findFirst({ where: { id, organizationId: user.organizationId }, include: { category: true, prices: true, features: { orderBy: { sortOrder: "asc" } } } });
  if (!plan) notFound();
  const canEdit = user.permissions.has("catalog.edit");
  const hidden = (op: string, extra?: Record<string, string>) => (
    <>
      <input type="hidden" name="planId" value={plan.id} /><input type="hidden" name="op" value={op} />
      {Object.entries(extra ?? {}).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
    </>
  );
  return (
    <div className="space-y-5 max-w-3xl">
      <Link href={`/services?cat=${plan.categoryId}`} className="text-sm text-muted hover:underline">← {plan.category.name}</Link>
      <h1 className="text-2xl font-semibold tracking-tight">{plan.name} <span className="text-base font-normal text-muted">version {plan.version}{!plan.active && ", archived"}</span></h1>
      {sp.saved && <Notice kind="ok">Saved.</Notice>}
      {sp.error && <Notice kind="error">{sp.error}</Notice>}

      <form action={act} className="card grid gap-3 sm:grid-cols-2">
        {hidden("details")}
        <h2 className="font-semibold sm:col-span-2">Details</h2>
        <div><label className="label" htmlFor="name">Name</label><input id="name" name="name" defaultValue={plan.name} required maxLength={100} disabled={!canEdit} className="input" /></div>
        <div><label className="label" htmlFor="billingInterval">Billed</label>
          <select id="billingInterval" name="billingInterval" defaultValue={plan.billingInterval} disabled={!canEdit} className="input">{INTERVALS.map((i) => <option key={i} value={i}>{i.toLowerCase().replace("_", " ")}</option>)}</select></div>
        <div className="sm:col-span-2"><label className="label" htmlFor="tagline">Tagline</label><input id="tagline" name="tagline" defaultValue={plan.tagline ?? ""} disabled={!canEdit} className="input" /></div>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="isPopular" defaultChecked={plan.isPopular} disabled={!canEdit} /> Mark as most popular</label>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="isPublic" defaultChecked={plan.isPublic} disabled={!canEdit} /> Public (may be shown on pricing pages)</label>
        <label className="flex items-center gap-2 text-sm sm:col-span-2"><input type="checkbox" name="active" defaultChecked={plan.active} disabled={!canEdit} /> Active (untick to archive; archived plans cannot be added to new quotations, old ones keep their reference)</label>
        {canEdit && <div className="sm:col-span-2"><button className="btn">Save details</button></div>}
      </form>

      <section className="card space-y-3">
        <h2 className="font-semibold">Prices (one per currency, never converted)</h2>
        <ul className="text-sm">
          {CURRENCIES.map((c) => {
            const p = plan.prices.find((x) => x.currency === c);
            return (
              <li key={c} className="flex flex-wrap items-center justify-between gap-2 border-t border-border py-2 first:border-0">
                <span className="w-12 font-medium">{c}</span>
                <span className="grow">{p ? <>{formatMoney(p.amount, c)}{p.setupFee && <span className="text-muted"> + {formatMoney(p.setupFee, c)} setup</span>}</> : <em className="text-muted">Not set</em>}</span>
                {canEdit && (
                  <form action={act} className="flex flex-wrap items-center gap-2">
                    {hidden("price", { currency: c })}
                    <input name="amount" required inputMode="decimal" defaultValue={p?.amount.toString() ?? ""} placeholder="Price" aria-label={`${c} price`} className="input !w-28" />
                    <input name="setupFee" inputMode="decimal" defaultValue={p?.setupFee?.toString() ?? ""} placeholder="Setup fee" aria-label={`${c} setup fee`} className="input !w-28" />
                    <button className="btn-ghost">Set</button>
                  </form>
                )}
                {canEdit && p && <form action={act}>{hidden("removePrice", { currency: c })}<button className="underline text-xs">Remove</button></form>}
              </li>
            );
          })}
        </ul>
      </section>

      <section className="card space-y-3">
        <h2 className="font-semibold">Features</h2>
        {plan.features.length === 0 && <p className="text-sm text-muted">No features yet.</p>}
        <ul className="text-sm">
          {plan.features.map((f) => (
            <li key={f.id} className="flex items-center justify-between gap-2 border-t border-border py-1.5 first:border-0">
              <span><span aria-hidden className="text-brand">✓</span> {f.text}</span>
              {canEdit && <form action={act}>{hidden("removeFeature", { featureId: f.id })}<button className="underline text-xs">Remove</button></form>}
            </li>
          ))}
        </ul>
        {canEdit && (
          <form action={act} className="flex gap-2 border-t border-border pt-3">
            {hidden("feature")}
            <input name="text" required maxLength={200} placeholder="Add a feature" aria-label="New feature" className="input" />
            <button className="btn-ghost">Add</button>
          </form>
        )}
      </section>
    </div>
  );
}
