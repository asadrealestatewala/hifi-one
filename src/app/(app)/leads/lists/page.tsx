import Link from "next/link";
import { requirePermission } from "@/lib/auth";
import { SYSTEM_LISTS, buildLeadWhere, cleanFilters, leadScore, visibleLists, type LeadFilters } from "@/lib/crm";
import { db } from "@/lib/db";
import { leadScope } from "@/lib/leads";
import { formatMoney } from "@/lib/money";
import { Badge, Empty, Notice, PageHeader } from "@/components/ui";
import { deleteListAction, saveListAction } from "../crm-actions";

export const dynamic = "force-dynamic";

const describe = (f: LeadFilters) => [
  f.q && `matching “${f.q}”`, f.stageNames?.length && `in ${f.stageNames.join(" or ")}`, f.openOnly && "still open", f.assignedTo && (f.assignedTo === "me" ? "assigned to me" : f.assignedTo === "unassigned" ? "unassigned" : "assigned to one person"),
  f.source && `from ${f.source}`, f.campaignId && "in one campaign", f.tag && `tagged ${f.tag}`, f.priority && `${f.priority.toLowerCase()} priority`, f.minValue && `worth ${f.minValue}+`,
  f.followUp === "overdue" && "follow-up due or overdue", f.followUp === "today" && "follow-up today", f.followUp === "none" && "no follow-up booked", f.noContactDays && `no contact for ${f.noContactDays}+ days`,
].filter(Boolean).join(", ");

export default async function SmartLists({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requirePermission("crm.view");
  const sp = await searchParams;
  const one = (k: string) => (Array.isArray(sp[k]) ? sp[k]![0] : (sp[k] as string | undefined)) ?? "";
  const org = user.organizationId;
  const [saved, stages, campaigns, agents] = await Promise.all([
    visibleLists(db, org, user.id),
    db.pipelineStage.findMany({ where: { organizationId: org }, orderBy: { sortOrder: "asc" } }),
    db.campaign.findMany({ where: { organizationId: org }, orderBy: { name: "asc" } }),
    user.permissions.has("crm.view_all") ? db.user.findMany({ where: { organizationId: org, userType: "EMPLOYEE", active: true }, orderBy: { name: "asc" }, select: { id: true, name: true } }) : Promise.resolve([]),
  ]);

  // Which list is open: a built-in, a saved one, or the ad-hoc filter form
  const listId = one("list");
  const sys = SYSTEM_LISTS.find((l) => l.id === listId);
  const mine = saved.find((l) => l.id === listId);
  const adhoc = Boolean(one("custom"));
  const filters: LeadFilters = sys ? sys.filters : mine ? cleanFilters(mine.filters) : adhoc
    ? cleanFilters({ q: one("q"), stageNames: [sp.stageNames].flat().filter(Boolean), source: one("source"), campaignId: one("campaignId"), assignedTo: one("assignedTo"), tag: one("tag"), priority: one("priority"), minValue: one("minValue"), followUp: one("followUp"), noContactDays: one("noContactDays"), openOnly: one("openOnly") === "on" })
    : {};
  const hasList = Boolean(sys || mine || adhoc);
  const leads = hasList ? await db.lead.findMany({ where: buildLeadWhere(filters, { userId: user.id, scope: leadScope(user) }), orderBy: [{ nextFollowUp: "asc" }, { createdAt: "desc" }], take: 200, include: { stage: true } }) : [];
  const title = sys?.name ?? mine?.name ?? (adhoc ? "Custom filter" : "Choose a list");

  return (
    <div className="space-y-6">
      <PageHeader title="Smart Lists" subtitle="Live views of your leads. Built-in lists answer the everyday questions; build your own filter, save it, and share it with the team." actions={<Link href="/leads" className="btn-ghost">All leads</Link>} />
      {one("error") && <Notice kind="error">{one("error")}</Notice>}
      <div className="grid gap-6 lg:grid-cols-[18rem_1fr]">
        <aside className="space-y-4">
          <section className="card !p-3">
            <p className="px-2 pb-1 text-[11px] font-semibold uppercase tracking-wide text-muted">Built-in</p>
            <ul className="text-sm">{SYSTEM_LISTS.map((l) => <li key={l.id}><Link href={`/leads/lists?list=${l.id}`} className={`block rounded-lg px-2 py-1.5 hover:bg-hover ${l.id === listId ? "bg-primary/10 font-medium text-primary" : ""}`} title={l.description}>{l.name}</Link></li>)}</ul>
          </section>
          <section className="card !p-3">
            <p className="px-2 pb-1 text-[11px] font-semibold uppercase tracking-wide text-muted">Saved</p>
            {saved.length === 0 ? <p className="px-2 text-xs text-muted">None yet.</p> : (
              <ul className="text-sm">{saved.map((l) => (
                <li key={l.id} className="flex items-center justify-between rounded-lg hover:bg-hover">
                  <Link href={`/leads/lists?list=${l.id}`} className={`flex-1 px-2 py-1.5 ${l.id === listId ? "font-medium text-primary" : ""}`}>{l.name}{l.shared && <span className="ml-1"><Badge tone="primary">shared</Badge></span>}</Link>
                  {l.ownerId === user.id && <form action={deleteListAction}><input type="hidden" name="id" value={l.id} /><button className="px-2 text-xs text-muted hover:text-brand" aria-label={`Delete ${l.name}`}>×</button></form>}
                </li>
              ))}</ul>
            )}
          </section>
        </aside>

        <div className="space-y-4">
          <details open={!hasList || adhoc} className="card">
            <summary className="cursor-pointer text-sm font-semibold">Build a filter</summary>
            <form className="mt-3 grid gap-3 sm:grid-cols-3" action="/leads/lists">
              <input type="hidden" name="custom" value="1" />
              <div><label className="label" htmlFor="f-q">Search</label><input id="f-q" name="q" defaultValue={one("q")} className="input" /></div>
              <div><label className="label" htmlFor="f-stage">Stage</label><select id="f-stage" name="stageNames" className="input" defaultValue={one("stageNames")}><option value="">Any</option>{stages.map((s) => <option key={s.id}>{s.name}</option>)}</select></div>
              <div><label className="label" htmlFor="f-camp">Campaign</label><select id="f-camp" name="campaignId" className="input" defaultValue={one("campaignId")}><option value="">Any</option>{campaigns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
              <div><label className="label" htmlFor="f-src">Source</label><input id="f-src" name="source" defaultValue={one("source")} className="input" placeholder="e.g. LinkedIn" /></div>
              <div><label className="label" htmlFor="f-tag">Tag</label><input id="f-tag" name="tag" defaultValue={one("tag")} className="input" /></div>
              <div><label className="label" htmlFor="f-pri">Priority</label><select id="f-pri" name="priority" className="input" defaultValue={one("priority")}><option value="">Any</option><option>HIGH</option><option>MEDIUM</option><option>LOW</option></select></div>
              <div><label className="label" htmlFor="f-own">Owner</label><select id="f-own" name="assignedTo" className="input" defaultValue={one("assignedTo")}><option value="">Anyone</option><option value="me">Me</option><option value="unassigned">Unassigned</option>{agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></div>
              <div><label className="label" htmlFor="f-fu">Follow-up</label><select id="f-fu" name="followUp" className="input" defaultValue={one("followUp")}><option value="">Any</option><option value="today">Today</option><option value="overdue">Due or overdue</option><option value="none">None booked</option></select></div>
              <div><label className="label" htmlFor="f-nc">No contact for (days)</label><input id="f-nc" name="noContactDays" inputMode="numeric" defaultValue={one("noContactDays")} className="input" /></div>
              <div><label className="label" htmlFor="f-val">Worth at least</label><input id="f-val" name="minValue" inputMode="decimal" defaultValue={one("minValue")} className="input" /></div>
              <label className="flex items-center gap-2 self-end pb-2 text-sm"><input type="checkbox" name="openOnly" defaultChecked={one("openOnly") === "on"} /> Open leads only</label>
              <div className="flex items-end gap-2"><button className="btn">Show leads</button></div>
            </form>
            {adhoc && (
              <form action={saveListAction} className="mt-4 flex flex-wrap items-end gap-3 border-t border-border pt-4">
                {Object.entries({ q: one("q"), source: one("source"), campaignId: one("campaignId"), assignedTo: one("assignedTo"), tag: one("tag"), priority: one("priority"), minValue: one("minValue"), followUp: one("followUp"), noContactDays: one("noContactDays") }).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
                {one("stageNames") && <input type="hidden" name="stageNames" value={one("stageNames")} />}
                {one("openOnly") === "on" && <input type="hidden" name="openOnly" value="on" />}
                <div><label className="label" htmlFor="sl-name">Save this filter as</label><input id="sl-name" name="name" required maxLength={80} className="input !w-64" /></div>
                <label className="flex items-center gap-2 pb-2 text-sm"><input type="checkbox" name="shared" /> Share with the team</label>
                <button className="btn-ghost">Save list</button>
              </form>
            )}
          </details>

          {hasList && (
            <section className="card overflow-x-auto">
              <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2"><h2 className="font-semibold">{title}</h2><span className="text-xs text-muted">{leads.length} lead{leads.length === 1 ? "" : "s"}{describe(filters) && ` · ${describe(filters)}`}</span></div>
              {leads.length === 0 ? <Empty title="No leads match">Nothing in your view fits this list right now.</Empty> : (
                <table className="w-full text-sm">
                  <thead className="text-left"><tr><th className="py-2 pr-4">Lead</th><th className="pr-4">Stage</th><th className="pr-4">Score</th><th className="pr-4">Value</th><th className="pr-4">Last contact</th><th>Next follow-up</th></tr></thead>
                  <tbody>{leads.map((l) => {
                    const sc = leadScore(l);
                    return (
                      <tr key={l.id} className="border-t border-border">
                        <td className="py-2 pr-4"><Link className="font-medium hover:underline" href={`/leads/${l.id}`}>{l.name}</Link><span className="block text-xs text-muted">{l.company}</span></td>
                        <td className="pr-4">{l.stage.name}</td>
                        <td className="pr-4"><Badge tone={sc.score >= 60 ? "success" : sc.score >= 30 ? "warning" : "neutral"}>{sc.score}</Badge></td>
                        <td className="pr-4">{l.dealValue ? formatMoney(l.dealValue, l.currency) : ""}</td>
                        <td className="pr-4">{l.lastContactAt ? l.lastContactAt.toLocaleDateString() : <span className="text-muted">never</span>}</td>
                        <td>{l.nextFollowUp ? l.nextFollowUp.toLocaleDateString() : ""}</td>
                      </tr>
                    );
                  })}</tbody>
                </table>
              )}
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
