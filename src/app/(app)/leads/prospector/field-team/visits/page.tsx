import Link from "next/link";
import { requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";
import { agentDay, fieldReport, FAST_TRAVEL_KMH } from "@/lib/field-reports";
import { listProducts, salesTeam, zoneOffsetMinutes, VISIT_OUTCOME_LABEL, type VisitOutcome } from "@/lib/field-visits";
import { companyZone } from "@/lib/mobile-api";
import { Badge, Empty, ExportLink, PageHeader, Progress, Stat } from "@/components/ui";

export const dynamic = "force-dynamic";

type SP = { product?: string; agent?: string; from?: string; to?: string; day?: string };
const BASE = "/leads/prospector/field-team/visits";
const TONE: Record<string, string> = { INTERESTED: "bg-success", DEMO_REQUESTED: "bg-success", NOT_INTERESTED: "bg-brand", NOT_AVAILABLE: "bg-muted", CLOSED: "bg-muted", OWNER_ABSENT: "bg-muted" };

// The manager's view of the field teams (decision 74): per agent and day, visits against target, outcomes, demos, leads, and the checks
// that keep the numbers honest (no location, impossible travel). One agent-day opens as the day's route.
export default async function FieldVisitsReport({ searchParams }: { searchParams: Promise<SP> }) {
  const user = await requirePermission("field.review");
  const sp = await searchParams;
  const zone = await companyZone(user.organizationId);
  const tz = zoneOffsetMinutes(zone);
  const filters = { productId: sp.product || undefined, agentId: sp.agent || undefined, from: sp.from, to: sp.to, tzOffsetMinutes: tz };
  const [report, products, team] = await Promise.all([fieldReport(db, user, filters), listProducts(db, user.organizationId), salesTeam(db, user.organizationId)]);
  const day = sp.day && sp.agent ? await agentDay(db, user, sp.agent, sp.day, { productId: filters.productId, tzOffsetMinutes: tz }) : null;
  const href = (over: Partial<SP>) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries({ product: sp.product, agent: sp.agent, from: report.range.from, to: report.range.to, day: sp.day, ...over })) if (v) p.set(k, String(v));
    const qs = p.toString();
    return `${BASE}${qs ? `?${qs}` : ""}`;
  };
  const time = (d: Date) => d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: zone });
  const dayLabel = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
  const pct = (n: number, d: number) => (d > 0 ? `${Math.round((n / d) * 100)}%` : "–");
  const fieldAgents = team.filter((m) => m.kind === "FIELD" || m.id === sp.agent);

  return (
    <div className="space-y-6">
      <PageHeader title="Field visit reports" subtitle={`${report.label}, the company's days (${zone}). A visit counts once per business per day.`} actions={<><ExportLink href={`${BASE}/export?${new URLSearchParams(Object.fromEntries(Object.entries({ product: sp.product, agent: sp.agent, from: report.range.from, to: report.range.to }).filter(([, v]) => v)) as Record<string, string>).toString()}`} /><Link className="btn-ghost" href="/leads/prospector/field-team">Team setup</Link></>} />

      <form className="card flex flex-wrap items-end gap-3" action={BASE}>
        {products.length > 1 && <div><label className="label" htmlFor="f-product">Product</label><select id="f-product" name="product" defaultValue={sp.product ?? ""} className="input"><option value="">All products</option>{products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></div>}
        <div><label className="label" htmlFor="f-agent">Agent</label><select id="f-agent" name="agent" defaultValue={sp.agent ?? ""} className="input"><option value="">All field agents</option>{fieldAgents.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</select></div>
        <div><label className="label" htmlFor="f-from">From</label><input id="f-from" name="from" type="date" defaultValue={report.range.from} className="input" /></div>
        <div><label className="label" htmlFor="f-to">To</label><input id="f-to" name="to" type="date" defaultValue={report.range.to} className="input" /></div>
        <button className="btn">Show</button>
      </form>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Stat label="Visits" value={report.totals.visits} hint={`${report.totals.businesses} businesses, ${report.totals.entries} entries`} />
        <Stat label="Against target" value={pct(report.totals.visits, report.totals.target)} hint={`${report.totals.target} expected over ${report.totals.days} agent-day${report.totals.days === 1 ? "" : "s"}`} />
        <Stat label="Interested" value={report.totals.interested} hint="interested or asked for a demo" />
        <Stat label="Demos requested" value={report.totals.demosRequested} />
        <Stat label="Leads" value={report.totals.leads} hint="businesses visited in this period that became leads" />
        <Stat label="Checks" value={report.totals.noLocation + report.totals.fastTravel} hint={`${report.totals.noLocation} without location, ${report.totals.fastTravel} too far apart`} />
      </div>

      {day && (
        <section className="card space-y-3" aria-labelledby="day-h">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div><h2 id="day-h" className="font-semibold">{day.agentName}: {dayLabel(day.day)}</h2><p className="text-sm text-muted">{day.stops.length} visit{day.stops.length === 1 ? "" : "s"}, {day.located} with a location{day.located >= 2 ? `, about ${day.distanceKm} km between stops` : ""}{day.stops.length - day.located > 0 ? `, ${day.stops.length - day.located} without` : ""}.</p></div>
            <div className="flex gap-2">{day.route && <a className="btn-ghost" href={day.route} target="_blank" rel="noreferrer">Open route in Google Maps{day.routeTruncated ? " (first 10)" : ""}</a>}<Link className="btn-ghost" href={href({ day: undefined })}>Close</Link></div>
          </div>
          {day.pins.length > 0 && (
            <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
              <svg viewBox="-6 -6 112 112" role="img" aria-label={`Where the ${day.located} located visits were, in order, relative to each other`} className="aspect-square w-full rounded-xl border border-border bg-hover/40">
                <polyline fill="none" stroke="currentColor" strokeOpacity="0.25" strokeWidth="0.8" strokeDasharray="2 2" points={day.pins.map((p) => `${(p.x * 100).toFixed(1)},${(p.y * 100).toFixed(1)}`).join(" ")} />
                {day.pins.map((p) => (
                  <g key={p.n} transform={`translate(${(p.x * 100).toFixed(1)} ${(p.y * 100).toFixed(1)})`}>
                    <circle r="4.2" className={`${(TONE[p.outcome] ?? "bg-muted").replace("bg-", "text-")} fill-current`} opacity="0.9" />
                    <text y="1.4" textAnchor="middle" fontSize="4" fill="white" fontWeight="600">{p.n}</text>
                  </g>
                ))}
              </svg>
              <ol className="divide-y divide-border text-sm">
                {day.stops.map((s) => (
                  <li key={s.id} className="flex items-start justify-between gap-3 py-2">
                    <div className="min-w-0"><p className="font-medium"><span className="mr-1.5 inline-flex h-5 w-5 items-center justify-center rounded-full bg-hover text-xs">{s.n}</span>{time(s.visitedAt)} · {s.name}</p><p className="truncate text-xs text-muted">{[s.reason, s.address, s.lat !== null ? `±${s.accuracyM ?? "?"} m` : "no location"].filter(Boolean).join(" · ")}</p></div>
                    <div className="flex shrink-0 items-center gap-2"><Badge tone={s.outcome === "INTERESTED" || s.outcome === "DEMO_REQUESTED" ? "success" : s.outcome === "NOT_INTERESTED" ? "danger" : "neutral"}>{s.outcomeLabel}</Badge>{s.lat !== null && <a className="text-xs underline" href={`https://www.google.com/maps/search/?api=1&query=${s.lat},${s.lng}`} target="_blank" rel="noreferrer">Map</a>}{s.leadId && <Link className="text-xs underline" href={`/leads/${s.leadId}`}>Lead</Link>}</div>
                  </li>
                ))}
              </ol>
            </div>
          )}
          {day.pins.length === 0 && day.stops.length > 0 && <p className="text-sm text-muted">None of these visits has a location, so there is nothing to draw. The list is in the table below.</p>}
          <p className="text-xs text-muted">The drawing shows the stops relative to each other (span about {day.spanM} m), not on a street map. Open the route in Google Maps for streets.</p>
        </section>
      )}

      {report.agents.length > 1 && !sp.agent && (
        <section className="space-y-2" aria-labelledby="agents-h">
          <h2 id="agents-h" className="font-semibold">By agent</h2>
          <div className="card !p-0 overflow-x-auto"><table className="w-full text-sm">
            <thead className="text-left text-xs text-muted"><tr><th className="py-2 pl-4 pr-4">Agent</th><th className="pr-4">Days</th><th className="pr-4">Visits</th><th className="pr-4">Target</th><th className="pr-4">Interested</th><th className="pr-4">Demos</th><th className="pr-4">Leads</th><th className="pr-4">Checks</th></tr></thead>
            <tbody>{report.agents.map((a) => (
              <tr key={a.agentId} className="border-t border-border">
                <td className="py-2 pl-4 pr-4"><Link className="font-medium text-primary hover:underline" href={href({ agent: a.agentId, day: undefined })}>{a.agentName}</Link></td>
                <td className="pr-4">{a.days}</td><td className="pr-4">{a.visits}</td><td className="pr-4">{pct(a.visits, a.target)} <span className="text-xs text-muted">of {a.target}</span></td>
                <td className="pr-4">{a.interested}</td><td className="pr-4">{a.demosRequested}</td><td className="pr-4">{a.leads}</td>
                <td className="pr-4 text-xs">{a.noLocation + a.fastTravel === 0 ? <span className="text-muted">none</span> : <>{a.noLocation > 0 && <Badge tone="warning">{a.noLocation} no location</Badge>} {a.fastTravel > 0 && <Badge tone="danger">{a.fastTravel} too far apart</Badge>}</>}</td>
              </tr>
            ))}</tbody>
          </table></div>
        </section>
      )}

      <section className="space-y-2" aria-labelledby="days-h">
        <h2 id="days-h" className="font-semibold">By day <span className="text-sm font-normal text-muted">({report.rows.length})</span></h2>
        {report.rows.length === 0 ? <Empty title="No visits in this period">Visits appear here as they are sent from their phones. Widen the dates or clear the filters.</Empty> : (
          <div className="card !p-0 overflow-x-auto"><table className="w-full text-sm">
            <thead className="text-left text-xs text-muted"><tr><th className="py-2 pl-4 pr-4">Day</th><th className="pr-4">Agent</th><th className="pr-4 min-w-44">Visits</th><th className="pr-4">Outcomes</th><th className="pr-4">Demos</th><th className="pr-4">Leads</th><th className="pr-4">Hours</th><th className="pr-4">Checks</th><th className="pr-4"></th></tr></thead>
            <tbody>{report.rows.map((d) => (
              <tr key={`${d.agentId}|${d.day}`} className="border-t border-border align-top">
                <td className="whitespace-nowrap py-2 pl-4 pr-4">{dayLabel(d.day)}</td>
                <td className="pr-4"><p className="font-medium">{d.agentName}</p>{d.productName && <p className="text-xs text-muted">{d.productName}</p>}</td>
                <td className="pr-4"><Progress value={d.visits} max={d.target || null} label={`${d.visits} of ${d.target || "no target"}`} /></td>
                <td className="pr-4"><div className="flex flex-wrap gap-1">{Object.entries(d.outcomes).map(([k, n]) => <span key={k} className="inline-flex items-center gap-1 text-xs"><span className={`inline-block h-2 w-2 rounded-full ${TONE[k] ?? "bg-muted"}`} aria-hidden="true" />{n} {VISIT_OUTCOME_LABEL[k as VisitOutcome]?.toLowerCase() ?? k}</span>)}</div></td>
                <td className="pr-4">{d.demosRequested}</td><td className="pr-4">{d.leads}</td>
                <td className="whitespace-nowrap pr-4 text-xs text-muted">{time(d.firstAt)}–{time(d.lastAt)}</td>
                <td className="pr-4 text-xs">{d.noLocation + d.fastTravel + d.needsDetails === 0 ? <span className="text-muted">none</span> : <div className="flex flex-wrap gap-1">{d.noLocation > 0 && <Badge tone="warning">{d.noLocation} no location</Badge>}{d.fastTravel > 0 && <Badge tone="danger">{d.fastTravel} over {FAST_TRAVEL_KMH} km/h</Badge>}{d.needsDetails > 0 && <Badge tone="neutral">{d.needsDetails} no phone</Badge>}</div>}</td>
                <td className="py-2 pr-4 text-right"><Link className="text-primary hover:underline" href={href({ agent: d.agentId, day: d.day })}>Route</Link></td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </section>
    </div>
  );
}
