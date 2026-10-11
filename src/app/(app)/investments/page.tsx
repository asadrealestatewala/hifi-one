import { randomUUID } from "node:crypto";
import { redirect } from "next/navigation";
import { audit, requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";
import { LedgerError } from "@/lib/ledger-math";
import { AssetError, createInvestment, investmentPosition, recordInvestmentTransaction } from "@/lib/assets";
import { formatMoney } from "@/lib/money";

export const dynamic = "force-dynamic";

const fail = (m: string): never => redirect(`/investments?error=${encodeURIComponent(m)}`);

async function create(formData: FormData) {
  "use server";
  const user = await requirePermission("investments.manage");
  try {
    const i = await createInvestment(db, {
      organizationId: user.organizationId, name: String(formData.get("name") ?? ""), category: String(formData.get("category") ?? ""), investee: String(formData.get("investee") ?? ""),
      currency: String(formData.get("currency")), investmentDate: String(formData.get("investmentDate")), ownershipPct: String(formData.get("ownershipPct") ?? ""),
      expectedReturn: String(formData.get("expectedReturn") ?? ""),
    });
    await audit(user, { action: "investment.create", entity: "Investment", entityId: i.id, after: { number: i.number, name: i.name } });
  } catch (e) {
    if (e instanceof AssetError) fail(e.message);
    throw e;
  }
  redirect("/investments");
}

async function record(formData: FormData) {
  "use server";
  const user = await requirePermission("investments.manage");
  const kind = String(formData.get("kind"));
  if (!["CAPITAL", "INCOME_RECOGNISED", "INCOME_RECEIVED"].includes(kind)) redirect("/investments");
  try {
    const t = await recordInvestmentTransaction(db, {
      organizationId: user.organizationId, investmentId: String(formData.get("investmentId")), kind: kind as "CAPITAL", amount: String(formData.get("amount") ?? ""),
      date: String(formData.get("date")), bankAccountId: String(formData.get("bankAccountId") ?? "") || undefined, note: String(formData.get("note") ?? ""),
      requestKey: String(formData.get("requestKey")), actorId: user.id,
    });
    await audit(user, { action: `investment.${kind.toLowerCase()}`, entity: "Investment", entityId: t.investmentId, after: { amount: t.amount.toString() } });
  } catch (e) {
    if (e instanceof AssetError || e instanceof LedgerError) fail(e.message);
    throw e;
  }
  redirect("/investments");
}

export default async function Investments({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const user = await requirePermission("investments.view");
  const { error } = await searchParams;
  const canManage = user.permissions.has("investments.manage");
  const [investments, banks] = await Promise.all([
    db.investment.findMany({ where: { organizationId: user.organizationId }, orderBy: { number: "asc" } }),
    db.bankAccount.findMany({ where: { organizationId: user.organizationId, active: true, ledgerAccountId: { not: null } } }),
  ]);
  const positions = await Promise.all(investments.map((i) => investmentPosition(db, i.id)));
  const today = new Date().toISOString().slice(0, 10);
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">Investments</h1>
      <p className="text-sm text-muted">Income recognised and cash actually received are recorded separately. The gap is shown as outstanding. Partnerships and joint ventures are not built yet.</p>
      {error && <p role="alert" className="text-sm text-brand bg-brand/10 rounded-lg px-3 py-2">{error}</p>}
      {investments.length === 0 && <div className="card text-sm text-muted">No investments yet.</div>}
      {investments.map((inv, i) => {
        const p = positions[i];
        const cur = inv.currency;
        return (
          <article key={inv.id} className="card space-y-3">
            <div className="flex justify-between gap-2"><h2 className="font-semibold">{inv.number} · {inv.name}</h2><span className="text-xs text-muted">{inv.investee}{inv.ownershipPct && ` · ${inv.ownershipPct.toString()}% owned`}</span></div>
            <dl className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-sm">
              <div><dt className="text-xs text-muted">Capital invested</dt><dd className="font-semibold">{formatMoney(p.capital, cur)}</dd></div>
              <div><dt className="text-xs text-muted">Income recognised</dt><dd className="font-semibold">{formatMoney(p.recognised, cur)}</dd></div>
              <div><dt className="text-xs text-muted">Cash received</dt><dd className="font-semibold">{formatMoney(p.received, cur)}</dd></div>
              <div><dt className="text-xs text-muted">Outstanding</dt><dd className="font-semibold">{formatMoney(p.outstanding, cur)}</dd></div>
            </dl>
            {canManage && (
              <form action={record} className="flex flex-wrap items-end gap-2 border-t border-border pt-3">
                <input type="hidden" name="investmentId" value={inv.id} />
                <input type="hidden" name="requestKey" value={randomUUID()} />
                <div><label className="label" htmlFor={`k${inv.id}`}>Record</label>
                  <select id={`k${inv.id}`} name="kind" className="input"><option value="CAPITAL">Capital paid in</option><option value="INCOME_RECOGNISED">Income recognised</option><option value="INCOME_RECEIVED">Cash received</option></select></div>
                <div><label className="label" htmlFor={`a${inv.id}`}>Amount ({cur})</label><input id={`a${inv.id}`} name="amount" required inputMode="decimal" className="input !w-32" /></div>
                <div><label className="label" htmlFor={`d${inv.id}`}>Date</label><input id={`d${inv.id}`} name="date" type="date" defaultValue={today} required className="input" /></div>
                <div><label className="label" htmlFor={`b${inv.id}`}>Bank (for capital or cash)</label>
                  <select id={`b${inv.id}`} name="bankAccountId" className="input"><option value="">None</option>{banks.filter((b) => b.currency === cur).map((b) => <option key={b.id} value={b.id}>{b.internalName}</option>)}</select></div>
                <button className="btn">Record</button>
              </form>
            )}
          </article>
        );
      })}
      {canManage && (
        <form action={create} className="card grid gap-4 sm:grid-cols-3">
          <h2 className="font-semibold sm:col-span-3">New investment</h2>
          <div><label className="label" htmlFor="name">Name</label><input id="name" name="name" required className="input" /></div>
          <div><label className="label" htmlFor="investee">Investee entity</label><input id="investee" name="investee" required className="input" /></div>
          <div><label className="label" htmlFor="category">Category / industry</label><input id="category" name="category" className="input" /></div>
          <div><label className="label" htmlFor="investmentDate">Investment date</label><input id="investmentDate" name="investmentDate" type="date" required className="input" /></div>
          <div><label className="label" htmlFor="ownershipPct">Ownership %</label><input id="ownershipPct" name="ownershipPct" inputMode="decimal" className="input" /></div>
          <div><label className="label" htmlFor="currency">Currency</label><select id="currency" name="currency" className="input">{["USD", "PKR", "AED", "GBP"].map((c) => <option key={c}>{c}</option>)}</select></div>
          <div className="sm:col-span-3"><label className="label" htmlFor="expectedReturn">Expected return (notes)</label><input id="expectedReturn" name="expectedReturn" className="input" /></div>
          <div className="sm:col-span-3"><button className="btn">Create investment</button></div>
        </form>
      )}
    </div>
  );
}
