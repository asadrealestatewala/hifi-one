import { redirect } from "next/navigation";
import { audit, requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";
import { formatMoney } from "@/lib/money";
import { YearEndError, closeYear, previewYearEnd } from "@/lib/year-end";

export const dynamic = "force-dynamic";

async function close(formData: FormData) {
  "use server";
  const user = await requirePermission("period.lock");
  const year = Number(formData.get("year"));
  try {
    const done = await closeYear(db, { organizationId: user.organizationId, year, actorId: user.id, lockBooks: formData.get("lockBooks") === "on", today: new Date().toISOString().slice(0, 10) });
    await audit(user, { action: "year_end.close", entity: "JournalEntry", after: { year, entries: done.map((d) => d.number) } });
  } catch (e) {
    if (e instanceof YearEndError) redirect(`/finance/year-end?year=${year}&error=${encodeURIComponent(e.message)}`);
    throw e;
  }
  redirect(`/finance/year-end?year=${year}&done=1`);
}

export default async function YearEnd({ searchParams }: { searchParams: Promise<{ year?: string; error?: string; done?: string }> }) {
  const user = await requirePermission("finance.view");
  const sp = await searchParams;
  const thisYear = new Date().getUTCFullYear();
  const year = /^\d{4}$/.test(sp.year ?? "") ? Number(sp.year) : thisYear - 1;
  const preview = await previewYearEnd(db, user.organizationId, year);
  const canClose = user.permissions.has("period.lock");
  const ended = `${year}-12-31` < new Date().toISOString().slice(0, 10);
  return (
    <div className="space-y-5 max-w-3xl">
      <h1 className="text-2xl font-bold">Year-End Close</h1>
      <p className="text-sm text-muted">Closing a year brings every revenue, cost and expense account back to zero and moves the profit or loss into Retained Earnings, one entry per currency, dated 31 December. Profit and loss reports for that year still show its results. Years must be closed in order, and a year can only be closed once it has ended.</p>
      {sp.done && <p className="text-sm bg-green-600/10 text-green-700 rounded-lg px-3 py-2">Year {year} is closed.</p>}
      {sp.error && <p role="alert" className="text-sm text-brand bg-brand/10 rounded-lg px-3 py-2">{sp.error}</p>}
      <form className="card flex flex-wrap items-end gap-3">
        <div><label className="label" htmlFor="year">Year</label><input id="year" name="year" type="number" min={2000} max={2100} defaultValue={year} className="input !w-28" /></div>
        <button className="btn-ghost">Preview</button>
      </form>
      <section className="card space-y-3">
        <h2 className="font-semibold">{year}</h2>
        {preview.groups.length === 0 ? <p className="text-sm text-muted">No profit and loss activity in {year}.</p> : preview.groups.map((g) => (
          <div key={g.currency} className="space-y-1">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">{g.currency}</h3>
            {g.accounts.map((a) => <div key={a.code} className="flex justify-between text-sm"><span><span className="text-muted">{a.code}</span> {a.name}</span><span>{formatMoney(a.balance.toString(), g.currency)}</span></div>)}
            <div className="flex justify-between text-sm font-bold border-t border-border pt-1"><span>{g.profit.gte(0) ? "Profit moved to Retained Earnings" : "Loss moved to Retained Earnings"}</span><span>{formatMoney(g.profit.toString(), g.currency)}</span></div>
          </div>
        ))}
        {preview.alreadyClosed.length > 0 && <p className="text-sm text-green-700">Already closed: {preview.alreadyClosed.map((e) => `${e.number} (${e.currency})`).join(", ")}.</p>}
        {canClose && ended && preview.groups.length > 0 && (
          <form action={close} className="flex flex-wrap items-center gap-3 border-t border-border pt-3">
            <input type="hidden" name="year" value={year} />
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="lockBooks" defaultChecked /> Also close the books through 31 December {year}</label>
            <button className="btn">{preview.alreadyClosed.length > 0 ? "Check again" : `Close ${year}`}</button>
          </form>
        )}
        {!ended && <p className="text-sm text-muted">{year} has not ended yet.</p>}
      </section>
    </div>
  );
}
