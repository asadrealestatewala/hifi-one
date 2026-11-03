import Link from "next/link";
import { requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";
import { googleCaps, usage } from "@/lib/api-budget";
import { PROSPECT_SORTS, PROSPECT_STATUSES, RESULT_CHOICES, assignableAgents, canSearch, dailyLimitFor, estimate, isManager, prospectScope, prospectWhere, searchesToday } from "@/lib/prospector";
import { countryOptions } from "@/lib/phone";
import { usersWithPermission } from "@/lib/notifications";
import { orderFor } from "@/lib/sort";
import { listHref, parseListParams } from "@/lib/list-params";
import { Badge, Chips, Empty, Notice, PageHeader, Pager, SearchBox, SubmitButton } from "@/components/ui";
import { reviewProspects, saveSearchLimits, searchProspects } from "./actions";

export const dynamic = "force-dynamic";
const BASE = "/leads/prospector";
const LABEL: Record<string, string> = { NEW: "New", REVIEWED: "Reviewed", ASSIGNED: "Assigned", SENT_TO_CRM: "Sent to CRM", DISMISSED: "Dismissed" };
const TONE: Record<string, "primary" | "warning" | "success" | "neutral"> = { NEW: "primary", REVIEWED: "warning", ASSIGNED: "primary", SENT_TO_CRM: "success", DISMISSED: "neutral" };
const usd = (n: number) => `$${n.toFixed(2)}`;

function Meter({ label, value, max, text }: { label: string; value: number; max: number; text: string }) {
  const pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 100;
  return (
    <div>
      <div className="mb-1 flex justify-between text-xs"><span className="font-medium">{label}</span><span className="text-muted">{text}</span></div>
      <div className="h-2 overflow-hidden rounded-full bg-hover" role="progressbar" aria-label={label} aria-valuenow={Math.round(value * 100) / 100} aria-valuemin={0} aria-valuemax={max}>
        <div className={`h-full rounded-full ${pct >= 90 ? "bg-brand" : pct >= 70 ? "bg-warning" : "bg-primary"}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

export default async function Prospector({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requirePermission("crm.view");
  const sp = await searchParams;
  const lp = parseListParams(sp, { sorts: Object.keys(PROSPECT_SORTS), statuses: PROSPECT_STATUSES, ids: ["search"] });
  const manager = isManager(user);
  const searcher = canSearch(user);
  const configured = Boolean(process.env.GOOGLE_PLACES_API_KEY);
  const caps = googleCaps();
  const org = user.organizationId;

  const where = prospectWhere(user, { q: lp.q, status: lp.status, searchId: lp.ids.search });
  const scope = prospectScope(user);
  const [rows, matched, counts, agents, meter, mine, limit] = await Promise.all([
    db.prospect.findMany({ where, orderBy: orderFor(lp.sort, PROSPECT_SORTS), skip: lp.page.skip, take: lp.page.take }),
    db.prospect.count({ where }),
    db.prospect.groupBy({ by: ["status"], where: scope, _count: true }),
    manager ? assignableAgents(db, org) : Promise.resolve([]),
    manager || user.permissions.has("prospector.manage") ? usage(db, org, "GOOGLE_PLACES", caps) : Promise.resolve(null),
    searcher ? searchesToday(db, org, user.id) : Promise.resolve(0),
    searcher ? dailyLimitFor(db, org, user.id) : Promise.resolve(0),
  ]);
  const byStatus = new Map(counts.map((c) => [c.status, c._count]));
  const total = counts.reduce((a, c) => a + c._count, 0);
  const names = new Map((await db.user.findMany({ where: { id: { in: rows.map((r) => r.assignedToId).filter(Boolean) as string[] } }, select: { id: true, name: true } })).map((u) => [u.id, u.name]));

  const manageLimits = user.permissions.has("prospector.manage");
  const searchers = manageLimits ? await db.user.findMany({ where: { id: { in: await usersWithPermission(db, org, "prospector.use") } }, select: { id: true, name: true }, orderBy: { name: "asc" } }) : [];
  const overrides = manageLimits ? await db.prospectorUserLimit.findMany({ where: { organizationId: org } }) : [];
  const defaultLimit = manageLimits ? await dailyLimitFor(db, org, "none") : 0;

  const cur = { q: lp.q, status: lp.status, search: lp.ids.search, sort: lp.sortChosen ? lp.sort.key : undefined, dir: lp.sortChosen ? lp.sort.dir : undefined };
  const href = (over: Record<string, string | undefined>) => listHref(BASE, cur, over);
  const countries = countryOptions();
  const e20 = estimate(20).costUsd;

  return (
    <div className="space-y-6">
      <PageHeader title="Prospector" subtitle="Find businesses by type and city, review them, and hand them to the sales team. A business found here is a prospect, not a lead: it becomes a lead only when it is sent to the CRM." />
      {sp.error && <Notice kind="error">{sp.error}</Notice>}
      {sp.ok && <Notice kind="ok">{sp.ok}</Notice>}

      {(meter || searcher) && (
        <section className="card space-y-3" aria-label="Usage">
          <h2 className="font-semibold">Usage</h2>
          <div className="grid gap-4 sm:grid-cols-3">
            {meter && <Meter label="Google budget this month" value={meter.monthSpentUsd} max={meter.monthlyCapUsd} text={`${usd(meter.monthSpentUsd)} of ${usd(meter.monthlyCapUsd)}`} />}
            {meter && <Meter label="Google requests today" value={meter.dayCalls} max={meter.dailyCap} text={`${meter.dayCalls} of ${meter.dailyCap}`} />}
            {searcher && <Meter label="Your searches today" value={mine} max={limit} text={`${mine} of ${limit}`} />}
          </div>
          {meter && <p className="text-xs text-muted">Counted at Google&apos;s list price, before its free monthly allowance, so the real bill is usually lower. The caps are set on the server and cannot be passed.</p>}
        </section>
      )}

      {searcher && (configured ? (
        <form action={searchProspects} className="card grid gap-3 sm:grid-cols-2 lg:grid-cols-5" aria-label="Search for businesses">
          <h2 className="font-semibold sm:col-span-2 lg:col-span-5">Find businesses</h2>
          <div className="lg:col-span-2"><label className="label" htmlFor="businessType">Type of business</label><input id="businessType" name="businessType" required minLength={2} maxLength={80} placeholder="Dentist, restaurant, real estate agent…" className="input" /></div>
          <div><label className="label" htmlFor="city">City</label><input id="city" name="city" required minLength={2} maxLength={80} placeholder="Lahore" className="input" /></div>
          <div><label className="label" htmlFor="country">Country</label>
            <select id="country" name="country" defaultValue="PK" className="input">{countries.map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}</select></div>
          <div><label className="label" htmlFor="maxResults">How many</label>
            <select id="maxResults" name="maxResults" defaultValue="20" className="input">{RESULT_CHOICES.map((n) => <option key={n} value={n}>Up to {n} (~${estimate(n).costUsd.toFixed(3)})</option>)}</select></div>
          <div className="flex flex-wrap items-center gap-3 sm:col-span-2 lg:col-span-5">
            <SubmitButton pendingText="Searching…">Search</SubmitButton>
            <p className="text-xs text-muted">Each batch of 20 results costs about ${e20.toFixed(3)} of the Google budget. Businesses already known to us are not added twice.</p>
          </div>
        </form>
      ) : (
        <Notice kind="error">Google Places is not configured, so searching is switched off. The administrator needs to set GOOGLE_PLACES_API_KEY on the server.</Notice>
      ))}

      <div className="flex flex-wrap items-center gap-3">
        <Chips current={lp.status ?? "ALL"} items={[{ key: "ALL", label: "All", count: total, href: href({ status: undefined, page: undefined }) }, ...PROSPECT_STATUSES.map((st) => ({ key: st, label: LABEL[st], count: byStatus.get(st) ?? 0, href: href({ status: st, page: undefined }) }))]} />
        <SearchBox q={lp.q} placeholder="Search name, address, phone, website" hidden={{ status: lp.status, search: lp.ids.search }} />
      </div>

      {manager && <form id="bulk" action={reviewProspects} className="card flex flex-wrap items-end gap-3" aria-label="Actions for ticked prospects">
        <div><label className="label" htmlFor="agentId">Assign ticked to</label>
          <select id="agentId" name="agentId" className="input" defaultValue=""><option value="" disabled>Choose a person</option>{agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></div>
        <button className="btn" name="op" value="assign">Assign</button>
        <button className="btn-ghost" name="op" value="review">Mark reviewed</button>
        <button className="btn-ghost" name="op" value="dismiss">Dismiss</button>
        <button className="btn-ghost" name="op" value="restore">Restore</button>
      </form>}

      <div className="card !p-0 overflow-x-auto">
        {rows.length === 0 ? (
          <div className="p-6"><Empty title={total === 0 ? "No prospects yet" : "No prospects match"}>{total === 0 ? (searcher ? "Use the search above to find businesses." : manager ? "Ask for search access, or wait for a colleague to run a search." : "Prospects assigned to you will appear here.") : "Try another status or search."}</Empty></div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-hover/60 text-left text-xs text-muted"><tr>
              {manager && <th className="w-8 py-2 pl-4"><span className="sr-only">Select</span></th>}
              <th className="py-2 pl-4 pr-4">Business</th><th className="pr-4">Phone</th><th className="pr-4">Website</th><th className="pr-4">Rating</th><th className="pr-4">Status</th><th className="pr-4">Assigned to</th>
            </tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-t border-border align-top transition hover:bg-hover/50">
                  {manager && <td className="py-2 pl-4">{r.status !== "SENT_TO_CRM" && <input type="checkbox" form="bulk" name="ids" value={r.id} aria-label={`Select ${r.name}`} />}</td>}
                  <td className="py-2 pl-4 pr-4"><p className="font-medium">{r.name}</p><p className="max-w-xs text-xs text-muted">{r.address}</p>{r.mapsUrl && <a className="text-xs text-primary hover:underline" href={r.mapsUrl} target="_blank" rel="noopener noreferrer">Open in Google Maps</a>}</td>
                  <td className="pr-4 whitespace-nowrap">{r.phone ? <a className="hover:underline" href={`tel:${r.phone}`}>{r.phone}</a> : <span className="text-muted">None listed</span>}</td>
                  <td className="pr-4">{r.website ? <a className="break-all text-primary hover:underline" href={r.website} target="_blank" rel="noopener noreferrer">{r.website.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "").slice(0, 32)}</a> : <span className="text-muted">No website</span>}</td>
                  <td className="pr-4 whitespace-nowrap">{r.rating ? `${r.rating} (${r.ratingCount ?? 0})` : <span className="text-muted">No reviews</span>}</td>
                  <td className="pr-4"><Badge tone={TONE[r.status] ?? "neutral"}>{LABEL[r.status] ?? r.status}</Badge></td>
                  <td className="pr-4">{r.assignedToId ? names.get(r.assignedToId) ?? "Unknown" : <span className="text-muted">Nobody</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <Pager page={lp.page.page} size={lp.page.size} total={matched} href={(n) => href({ page: n > 1 ? String(n) : undefined })} />
      </div>
      <p className="text-xs text-muted">Business details come from Google Maps. Phone numbers are shown in international format. {lp.ids.search && <Link className="text-primary hover:underline" href={href({ search: undefined, page: undefined })}>Show all searches</Link>}</p>

      {manageLimits && (
        <form action={saveSearchLimits} className="card space-y-3" aria-label="Search limits">
          <div><h2 className="font-semibold">Who can search, and how often</h2><p className="text-xs text-muted">Give a colleague search access in Roles (permission Prospector: run searches). Leave a person&apos;s box empty to use the default.</p></div>
          <div className="max-w-xs"><label className="label" htmlFor="defaultLimit">Default searches per person per day</label><input id="defaultLimit" name="defaultLimit" type="number" min={0} max={500} defaultValue={defaultLimit} className="input" /></div>
          {searchers.length > 0 && <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {searchers.map((p) => <div key={p.id}><label className="label" htmlFor={`l-${p.id}`}>{p.name}</label><input id={`l-${p.id}`} name={`limit:${p.id}`} type="number" min={0} max={500} defaultValue={overrides.find((o) => o.userId === p.id)?.dailySearches ?? ""} placeholder={`Default (${defaultLimit})`} className="input" /></div>)}
          </div>}
          <SubmitButton>Save limits</SubmitButton>
        </form>
      )}
    </div>
  );
}
