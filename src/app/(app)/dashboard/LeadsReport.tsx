import Link from "next/link";
import { Avatar, Empty, Stat } from "@/components/ui";
import { formatMoney } from "@/lib/money";
import type { loadLeadsReport } from "@/lib/leads-report";
import { Bars } from "./parts";

type Report = Awaited<ReturnType<typeof loadLeadsReport>>;

// The leads report, used on the dashboard tab and on its own page, so the two always show the same numbers.
export default function LeadsReport({ r, owners, from, to }: { r: Report; owners: Map<string, string>; from: string; to: string }) {
  const pipeline = r.pipeline.map((p) => formatMoney(p.value, p.currency)).join(" · ") || "0";
  const maxWeek = Math.max(1, ...r.weeks.map((w) => w.count));
  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Stat label="All leads" value={r.total} hint={`${r.open} still open`} />
        <Stat label="New in period" value={r.created} hint={`${from} to ${to}`} />
        <Stat label="Won" value={r.won} hint="became clients" />
        <Stat label="Conversion" value={r.conversion === null ? "No decisions yet" : `${r.conversion}%`} hint={`${r.won} won, ${r.lost} lost`} />
        <Stat label="Open pipeline" value={<span className="text-lg">{pipeline}</span>} hint="expected value, per currency" />
      </div>
      <div className="grid gap-5 lg:grid-cols-2">
        <section className="card space-y-3"><h2 className="font-semibold">Pipeline by stage</h2>
          {r.total === 0 ? <Empty title="No leads yet">Leads appear here as they are added.</Empty> : <Bars rows={r.funnel.map((f) => ({ label: f.name, value: f.count, note: `${f.count}${f.money.length ? " · " + f.money.map((m) => formatMoney(m.value, m.currency)).join(" · ") : ""}` }))} />}
        </section>
        <section className="card space-y-3"><h2 className="font-semibold">New leads per week</h2>
          {r.weeks.length === 0 ? null : (
            <div className="flex h-36 items-end gap-1.5" role="img" aria-label="New leads per week">{r.weeks.map((w) => <div key={w.start} className="flex flex-1 flex-col items-center justify-end gap-1" title={`Week of ${w.start}: ${w.count}`}><span className="text-[10px] text-muted">{w.count || ""}</span><div className="w-full rounded-t bg-primary transition-all duration-700" style={{ height: `${Math.max(w.count ? 6 : 2, (w.count / maxWeek) * 100)}%`, opacity: w.count ? 1 : 0.2 }} /><span className="text-[9px] text-muted">{w.start.slice(5)}</span></div>)}</div>
          )}
        </section>
        <section className="card !p-0"><h2 className="border-b border-border px-4 py-3 font-semibold">Where leads came from</h2>
          {r.bySource.length === 0 ? <p className="px-4 py-6 text-sm text-muted">No new leads in this period.</p> : (
            <table className="w-full text-sm"><thead className="bg-hover/60 text-left text-xs text-muted"><tr><th className="px-4 py-2">Source</th><th className="pr-4 text-right">Leads</th><th className="pr-4 text-right">Won</th><th className="pr-4 text-right">Rate</th></tr></thead>
              <tbody>{r.bySource.map((s) => <tr key={s.source} className="border-t border-border"><td className="px-4 py-2">{s.source}</td><td className="pr-4 text-right tabular-nums">{s.leads}</td><td className="pr-4 text-right tabular-nums">{s.won}</td><td className="pr-4 text-right tabular-nums text-muted">{Math.round((s.won / s.leads) * 100)}%</td></tr>)}</tbody></table>
          )}
        </section>
        <section className="card !p-0"><h2 className="border-b border-border px-4 py-3 font-semibold">Who is working them</h2>
          {r.byOwner.length === 0 ? <p className="px-4 py-6 text-sm text-muted">No new leads in this period.</p> : (
            <table className="w-full text-sm"><thead className="bg-hover/60 text-left text-xs text-muted"><tr><th className="px-4 py-2">Owner</th><th className="pr-4 text-right">New</th><th className="pr-4 text-right">Won</th></tr></thead>
              <tbody>{r.byOwner.map((o) => { const n = o.id ? owners.get(o.id) ?? "Former staff" : "Unassigned"; return <tr key={o.id ?? "none"} className="border-t border-border"><td className="px-4 py-2"><span className="flex items-center gap-2"><Avatar name={n} userId={o.id} size={22} />{n}</span></td><td className="pr-4 text-right tabular-nums">{o.leads}</td><td className="pr-4 text-right tabular-nums">{o.won}</td></tr>; })}</tbody></table>
          )}
        </section>
      </div>
      {r.recent.length > 0 && (
        <section className="card"><div className="mb-2 flex items-center justify-between"><h2 className="font-semibold">Newest leads</h2><Link href="/leads" className="text-sm text-primary hover:underline">All leads</Link></div>
          <ul className="divide-y divide-border text-sm">{r.recent.map((l) => <li key={l.id} className="flex items-center justify-between gap-3 py-2"><Link href={`/leads/${l.id}`} className="font-medium hover:underline">{l.name} <span className="text-xs font-normal text-muted">L-{l.number}</span></Link><span className="text-muted">{l.stage} · {l.createdAt.toLocaleDateString()}</span></li>)}</ul></section>
      )}
    </div>
  );
}
