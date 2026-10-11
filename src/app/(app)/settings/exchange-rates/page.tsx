import { redirect } from "next/navigation";
import { audit, requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";
import { FxError, addRate, getBaseCurrency, rateOn, setBaseCurrency } from "@/lib/fx";
import { CURRENCIES } from "@/lib/money";

export const dynamic = "force-dynamic";

async function addRateAction(formData: FormData) {
  "use server";
  const user = await requirePermission("fx.manage");
  try {
    const row = await addRate(db, {
      organizationId: user.organizationId, currency: String(formData.get("currency") ?? ""), rate: String(formData.get("rate") ?? ""),
      effectiveDate: String(formData.get("effectiveDate") ?? ""), note: String(formData.get("note") ?? ""), actorId: user.id,
    });
    await audit(user, { action: "fx.rate_added", entity: "ExchangeRate", entityId: row.id, after: { currency: row.currency, rate: row.rate.toString(), effectiveDate: row.effectiveDate } });
  } catch (e) {
    if (e instanceof FxError) redirect(`/settings/exchange-rates?error=${encodeURIComponent(e.message)}`);
    throw e;
  }
  redirect("/settings/exchange-rates?saved=1");
}

async function baseAction(formData: FormData) {
  "use server";
  const user = await requirePermission("fx.manage");
  try {
    const before = await getBaseCurrency(db, user.organizationId);
    const after = await setBaseCurrency(db, { organizationId: user.organizationId, currency: String(formData.get("currency") ?? "") });
    await audit(user, { action: "fx.base_currency_set", entity: "Organization", entityId: user.organizationId, before: { baseCurrency: before }, after: { baseCurrency: after } });
  } catch (e) {
    if (e instanceof FxError) redirect(`/settings/exchange-rates?error=${encodeURIComponent(e.message)}`);
    throw e;
  }
  redirect("/settings/exchange-rates?saved=1");
}

export default async function ExchangeRates({ searchParams }: { searchParams: Promise<{ saved?: string; error?: string }> }) {
  const user = await requirePermission("reports.view");
  const sp = await searchParams;
  const canEdit = user.permissions.has("fx.manage");
  const org = user.organizationId;
  const base = await getBaseCurrency(db, org);
  const today = new Date().toISOString().slice(0, 10);
  const others = CURRENCIES.filter((c) => c !== base);
  const history = await db.exchangeRate.findMany({ where: { organizationId: org }, orderBy: [{ effectiveDate: "desc" }, { createdAt: "desc" }], take: 100 });
  const current = await Promise.all(others.map(async (c) => [c, await rateOn(db, org, c, today)] as const));
  const who = new Map((await db.user.findMany({ where: { id: { in: [...new Set(history.map((h) => h.createdById).filter(Boolean) as string[])] } }, select: { id: true, name: true } })).map((u) => [u.id, u.name]));

  return (
    <div className="space-y-6 max-w-3xl">
      <h1 className="text-2xl font-semibold tracking-tight">Exchange rates</h1>
      <p className="text-sm text-muted">
        Rates convert other currencies into the base currency for consolidated reports. Each entry says how many {base} one unit of the currency is worth from a given date.
        Entries are never edited: to correct a rate, add a new entry for the same date. Invoices, payments and the ledger always stay in their own currency.
      </p>
      {sp.saved && <p className="text-sm bg-green-600/10 text-green-700 rounded-lg px-3 py-2">Saved.</p>}
      {sp.error && <p role="alert" className="text-sm bg-brand/10 text-brand rounded-lg px-3 py-2">{sp.error}</p>}

      <section className="card space-y-2">
        <h2 className="font-semibold">Rates in force today (1 unit = ? {base})</h2>
        <ul className="text-sm">
          {current.map(([c, r]) => (
            <li key={c} className="flex justify-between border-t border-border py-1.5 first:border-0"><span>{c}</span><span>{r ? r.toString() : <em className="text-muted">No rate set. Reports cannot include {c} until one is added.</em>}</span></li>
          ))}
        </ul>
      </section>

      {canEdit && (
        <section className="card space-y-3">
          <h2 className="font-semibold">Add a rate</h2>
          <form action={addRateAction} className="grid gap-3 sm:grid-cols-4 items-end">
            <div><label className="label" htmlFor="currency">Currency</label><select id="currency" name="currency" className="input">{others.map((c) => <option key={c}>{c}</option>)}</select></div>
            <div><label className="label" htmlFor="rate">1 unit = ? {base}</label><input id="rate" name="rate" inputMode="decimal" required className="input" placeholder="e.g. 0.0036" /></div>
            <div><label className="label" htmlFor="effectiveDate">Effective from</label><input id="effectiveDate" name="effectiveDate" type="date" defaultValue={today} required className="input" /></div>
            <div><label className="label" htmlFor="note">Note (optional)</label><input id="note" name="note" maxLength={200} className="input" placeholder="e.g. State Bank rate" /></div>
            <button className="btn sm:col-span-4 sm:w-fit">Add rate</button>
          </form>
        </section>
      )}

      {canEdit && (
        <section className="card space-y-3">
          <h2 className="font-semibold">Base currency</h2>
          <form action={baseAction} className="flex flex-wrap items-end gap-3">
            <div><label className="label" htmlFor="base">Base currency</label><select id="base" name="currency" defaultValue={base} className="input">{CURRENCIES.map((c) => <option key={c}>{c}</option>)}</select></div>
            <button className="btn-ghost">Change</button>
          </form>
          <p className="text-xs text-muted">The base currency can only be changed before any rate is recorded, because every rate is relative to it.</p>
        </section>
      )}

      <section className="card overflow-x-auto">
        <h2 className="font-semibold mb-2">History</h2>
        {history.length === 0 ? <p className="text-sm text-muted">No rates recorded yet.</p> : (
          <table className="w-full text-sm">
            <thead className="bg-hover/60 text-left text-xs text-muted"><tr><th className="py-2 pr-4">Effective</th><th className="pr-4">Currency</th><th className="pr-4 text-right">Rate</th><th className="pr-4">Entered by</th><th>Note</th></tr></thead>
            <tbody>
              {history.map((h) => (
                <tr key={h.id} className="border-t border-border transition hover:bg-hover/50"><td className="py-2 pr-4">{h.effectiveDate}</td><td className="pr-4">{h.currency}</td><td className="pr-4 text-right">{h.rate.toString()}</td><td className="pr-4">{(h.createdById && who.get(h.createdById)) || ""}</td><td>{h.note}</td></tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
