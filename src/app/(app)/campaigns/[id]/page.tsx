import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/auth";
import { campaignMetrics } from "@/lib/campaigns";
import { performance } from "@/lib/campaign-performance";
import { parseRange } from "@/lib/date-range";
import { db } from "@/lib/db";
import { formatMoney } from "@/lib/money";
import { ConfirmButton, DateRangeForm, DownloadButtons, Notice, Stat, StatusBadge, SubmitButton } from "@/components/ui";
import CampaignFields from "../CampaignFields";
import { campaignLinksAction, spendAction, updateCampaignAction } from "../actions";

export const dynamic = "force-dynamic";

export default async function CampaignPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string; msg?: string; from?: string; to?: string }> }) {
  const user = await requirePermission("campaigns.view");
  const { id } = await params;
  const sp = await searchParams;
  const org = user.organizationId;
  const c = await db.campaign.findFirst({ where: { id, organizationId: org }, include: { category: true, members: { include: { user: { select: { id: true, name: true, active: true } } } }, clients: { include: { client: { select: { id: true, name: true, code: true } } } }, projects: { select: { id: true, number: true, name: true, status: true } } } });
  if (!c) notFound();
  const canManage = user.permissions.has("campaigns.manage");
  const canClients = user.permissions.has("clients.view");
  const canProjects = user.permissions.has("projects.view_all") || user.permissions.has("projects.view");
  const [metrics, owner, categories, staff, clients, freeProjects, recentLeads] = await Promise.all([
    campaignMetrics(db, org, [c.id]),
    c.ownerId ? db.user.findUnique({ where: { id: c.ownerId }, select: { name: true } }) : null,
    canManage ? db.serviceCategory.findMany({ where: { organizationId: org, active: true }, orderBy: { sortOrder: "asc" }, select: { id: true, name: true } }) : Promise.resolve([]),
    canManage ? db.user.findMany({ where: { organizationId: org, userType: "EMPLOYEE", active: true }, orderBy: { name: "asc" }, select: { id: true, name: true } }) : Promise.resolve([]),
    canManage ? db.client.findMany({ where: { organizationId: org, active: true }, orderBy: { name: "asc" }, select: { id: true, name: true } }) : Promise.resolve([]),
    canManage ? db.project.findMany({ where: { organizationId: org, campaignId: null, status: { in: ["ACTIVE", "ON_HOLD"] } }, orderBy: { number: "asc" }, select: { id: true, number: true, name: true } }) : Promise.resolve([]),
    user.permissions.has("crm.view_all") ? db.lead.findMany({ where: { organizationId: org, campaignId: c.id }, orderBy: { createdAt: "desc" }, take: 5, select: { id: true, name: true, number: true, stage: { select: { name: true } } } }) : Promise.resolve([]),
  ]);
  const deliverables = await db.deliverable.findMany({ where: { organizationId: org, campaignId: c.id }, orderBy: { createdAt: "desc" }, take: 8, select: { id: true, title: true, status: true, version: true, projectId: true } });
  const range = parseRange(sp.from, sp.to);
  const perf = await performance(db, org, c.id, range);
  const spendRows = await db.campaignSpend.findMany({ where: { organizationId: org, campaignId: c.id, ...(range.from || range.to ? { date: { ...(range.from ? { gte: range.from } : {}), ...(range.to ? { lte: range.to } : {}) } } : {}) }, orderBy: [{ date: "desc" }, { id: "asc" }], take: 50 });
  const today = new Date().toISOString().slice(0, 10);
  const monthFrom = `${today.slice(0, 7)}-01`;
  const money = (f: { currency: string; amount: number }[]) => f.map((x) => formatMoney(x.amount, x.currency)).join(" · ") || "none";
  const m = metrics.get(c.id)!;
  const members = new Set(c.members.map((x) => x.userId));
  const linkedClients = new Set(c.clients.map((x) => x.clientId));
  const op = (v: string) => <><input type="hidden" name="id" value={c.id} /><input type="hidden" name="op" value={v} /></>;
  return (
    <div className="space-y-5">
      <Link href="/campaigns" className="text-sm text-muted hover:underline">← All campaigns</Link>
      {sp.error && <Notice kind="error">{sp.error}</Notice>}
      {sp.msg && <Notice kind="ok">{sp.msg}</Notice>}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{c.name} <span className="text-base font-normal text-muted">{c.code}</span></h1>
          <p className="text-sm text-muted">{c.category?.name ?? "No category"}{owner && ` · owned by ${owner.name}`}{c.startDate && ` · ${c.startDate}${c.endDate ? ` to ${c.endDate}` : ""}`}</p>
          <div className="mt-1">{c.archivedAt ? <StatusBadge status="ARCHIVED" /> : <StatusBadge status={c.status} />}</div>
        </div>
        {canManage && (
          <form action={campaignLinksAction}>{op(c.archivedAt ? "restore" : "archive")}
            <ConfirmButton title={c.archivedAt ? "Restore this campaign?" : "Archive this campaign?"} message={c.archivedAt ? "It returns to the campaign list." : "It leaves the campaign list and lead forms. Its leads, projects and history are kept."} confirmLabel={c.archivedAt ? "Restore" : "Archive"}>{c.archivedAt ? "Restore" : "Archive"}</ConfirmButton>
          </form>
        )}
      </div>
      {c.description && <p className="max-w-3xl whitespace-pre-wrap text-sm">{c.description}</p>}
      {c.objectives && <section className="card max-w-3xl text-sm"><h2 className="mb-1 font-semibold">Objectives</h2><p className="whitespace-pre-wrap">{c.objectives}</p></section>}

      <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Stat label="Team" value={m.team} href={user.permissions.has("hr.view") ? `/hr/employees?campaign=${c.id}` : undefined} />
        <Stat label="Clients" value={m.clients} />
        <Stat label="Leads" value={m.leads} href={user.permissions.has("crm.view") ? `/leads?campaign=${c.id}` : undefined} />
        <Stat label="Won" value={m.won} hint={m.leads ? `${Math.round((m.won / m.leads) * 100)}% of leads` : undefined} />
        <Stat label="Projects" value={m.projects} href={canProjects ? `/projects?campaign=${c.id}` : undefined} />
        <Stat label="Open tasks" value={m.openTasks} hint="in linked projects" />
      </div>
      {c.budget && <p className="text-sm text-muted">Budget: {formatMoney(c.budget, c.currency)}{m.leads ? ` · ${formatMoney(Number(c.budget) / m.leads, c.currency)} per lead` : ""}</p>}

      <div className="grid gap-5 lg:grid-cols-2">
        <section className="card space-y-3">
          <h2 className="font-semibold">Team</h2>
          {c.members.length === 0 ? <p className="text-sm text-muted">Nobody assigned yet.</p> : <ul className="text-sm">{c.members.map((x) => <li key={x.userId}>{x.user.name}{x.userId === c.ownerId && <span className="text-xs text-muted"> · owner</span>}{!x.user.active && <span className="text-xs text-muted"> · inactive</span>}</li>)}</ul>}
          {canManage && (
            <details>
              <summary className="cursor-pointer text-sm text-primary">Change the team</summary>
              <form action={campaignLinksAction} className="mt-2 space-y-2">{op("team")}
                <div className="grid max-h-56 gap-1 overflow-y-auto text-sm sm:grid-cols-2">{staff.map((u) => <label key={u.id} className="flex items-center gap-2"><input type="checkbox" name="userIds" value={u.id} defaultChecked={members.has(u.id)} />{u.name}</label>)}</div>
                <SubmitButton className="btn-ghost">Save team</SubmitButton>
              </form>
            </details>
          )}
        </section>
        <section className="card space-y-3">
          <h2 className="font-semibold">Clients</h2>
          {c.clients.length === 0 ? <p className="text-sm text-muted">No client linked.</p> : <ul className="text-sm">{c.clients.map((x) => <li key={x.clientId}>{canClients ? <Link className="hover:underline" href={`/clients/${x.client.id}`}>{x.client.name}</Link> : x.client.name} <span className="text-xs text-muted">{x.client.code}</span></li>)}</ul>}
          {canManage && (
            <details>
              <summary className="cursor-pointer text-sm text-primary">Change clients</summary>
              <form action={campaignLinksAction} className="mt-2 space-y-2">{op("clients")}
                <div className="grid max-h-56 gap-1 overflow-y-auto text-sm sm:grid-cols-2">{clients.map((x) => <label key={x.id} className="flex items-center gap-2"><input type="checkbox" name="clientIds" value={x.id} defaultChecked={linkedClients.has(x.id)} />{x.name}</label>)}{clients.length === 0 && <p className="text-muted">No active clients.</p>}</div>
                <SubmitButton className="btn-ghost">Save clients</SubmitButton>
              </form>
            </details>
          )}
        </section>
        <section className="card space-y-3">
          <h2 className="font-semibold">Projects</h2>
          {c.projects.length === 0 ? <p className="text-sm text-muted">No project linked. Tasks are tracked inside projects.</p> : (
            <ul className="space-y-1 text-sm">{c.projects.map((p) => (
              <li key={p.id} className="flex items-center justify-between gap-2"><span>{canProjects ? <Link className="hover:underline" href={`/projects/${p.id}`}>{p.name}</Link> : p.name} <span className="text-xs text-muted">{p.number}</span> <StatusBadge status={p.status} /></span>
                {canManage && <form action={campaignLinksAction}>{op("unlink_project")}<input type="hidden" name="projectId" value={p.id} /><SubmitButton className="text-xs underline" pendingText="…">Unlink</SubmitButton></form>}</li>
            ))}</ul>
          )}
          {canManage && freeProjects.length > 0 && (
            <form action={campaignLinksAction} className="flex flex-wrap gap-2">{op("link_project")}
              <select name="projectId" required aria-label="Project to link" className="input !w-auto"><option value="">Link a project…</option>{freeProjects.map((p) => <option key={p.id} value={p.id}>{p.number} {p.name}</option>)}</select>
              <SubmitButton className="btn-ghost">Link</SubmitButton>
            </form>
          )}
        </section>
        <section className="card space-y-2">
          <h2 className="font-semibold">Latest leads</h2>
          {recentLeads.length === 0 ? <p className="text-sm text-muted">{user.permissions.has("crm.view_all") ? "No leads tagged with this campaign yet. Tag a lead with its campaign on the lead page." : "Lead details are visible to sales managers."}</p> : <ul className="text-sm">{recentLeads.map((l) => <li key={l.id}><Link className="hover:underline" href={`/leads/${l.id}`}>{l.name}</Link> <span className="text-xs text-muted">L-{l.number} · {l.stage.name}</span></li>)}</ul>}
          <h3 className="pt-2 text-sm font-semibold">Deliverables</h3>
          {deliverables.length === 0 ? <p className="text-xs text-muted">None yet. Add them inside a linked project; clients approve them in their portal.</p> : <ul className="text-sm">{deliverables.map((d) => <li key={d.id} className="flex items-center justify-between border-t border-border py-1 first:border-0"><Link className="hover:underline" href={`/projects/${d.projectId}#deliverables`}>{d.title} <span className="text-xs text-muted">v{d.version}</span></Link><StatusBadge status={d.status} /></li>)}</ul>}
        </section>
      </div>

      <section id="performance" className="card space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="font-semibold">Performance</h2>
          <span className="flex flex-wrap items-center gap-2"><DownloadButtons report="campaign" params={{ campaign: c.id, from: range.from ?? monthFrom, to: range.to ?? today }} /><DownloadButtons report="campaign_client" params={{ campaign: c.id, from: range.from ?? monthFrom, to: range.to ?? today }} /></span></div>
        <p className="text-xs text-muted">First pair: internal report with spend. Second pair: client report without any spend or budget, to send to the client. Both cover the dates chosen below (this month by default).</p>
        <DateRangeForm from={range.from} to={range.to} hidden={{}} label="Show" />
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Stat label="Spend entered" value={<span className="text-lg">{money(perf.spend)}</span>} />
          <Stat label="Leads" value={perf.leads} hint={perf.conversion === null ? undefined : `${perf.won} won · ${perf.conversion}%`} href={user.permissions.has("crm.view") ? `/leads?campaign=${c.id}${range.from ? `&from=${range.from}` : ""}${range.to ? `&to=${range.to}` : ""}` : undefined} />
          <Stat label="Cost per lead" value={<span className="text-lg">{money(perf.costPerLead)}</span>} hint={perf.costPerWon.length ? `${money(perf.costPerWon)} per win` : undefined} />
          <Stat label="Won deal value" value={<span className="text-lg">{money(perf.wonValue)}</span>} hint={perf.roi.length ? `return ${perf.roi.map((x) => `${x.percent}% ${x.currency}`).join(", ")}` : undefined} />
        </div>
        {(perf.impressions > 0 || perf.clicks > 0 || perf.results > 0) && <p className="text-sm text-muted">{perf.impressions.toLocaleString()} impressions · {perf.clicks.toLocaleString()} clicks{perf.ctr !== null && ` (${perf.ctr}% click-through)`} · {perf.results.toLocaleString()} results reported</p>}
        {perf.byPlatform.length > 0 && <div className="overflow-x-auto"><table className="w-full text-sm"><thead className="bg-hover/60 text-left text-xs text-muted"><tr><th className="px-3 py-2">Platform</th><th className="pr-3 text-right">Spend</th><th className="pr-3 text-right">Clicks</th><th className="pr-3 text-right">Results</th></tr></thead><tbody>{perf.byPlatform.map((b) => <tr key={b.platform + b.currency} className="border-t border-border"><td className="px-3 py-1.5">{b.platform}</td><td className="pr-3 text-right tabular-nums">{formatMoney(b.amount, b.currency)}</td><td className="pr-3 text-right tabular-nums">{b.clicks}</td><td className="pr-3 text-right tabular-nums">{b.results}</td></tr>)}</tbody></table></div>}
        <p className="text-xs text-muted">Spend, impressions, clicks and results are entered by hand below; no advertising account is connected. Leads and wins come from the CRM.</p>
        <div>
          <h3 className="mb-1 text-sm font-semibold">Spend entries</h3>
          {spendRows.length === 0 ? <p className="text-sm text-muted">No spend entered for these dates.</p> : <ul className="text-sm">{spendRows.map((e) => <li key={e.id} className="flex flex-wrap items-center justify-between gap-2 border-t border-border py-1.5 first:border-0"><span>{e.date} · {e.platform}{e.note && <span className="text-muted"> · {e.note}</span>}</span><span className="flex items-center gap-3">{formatMoney(e.amount, e.currency)}{canManage && <form action={spendAction}><input type="hidden" name="id" value={c.id} /><input type="hidden" name="op" value="delete" /><input type="hidden" name="spendId" value={e.id} /><ConfirmButton className="text-xs text-muted underline" title="Delete this spend entry?" message="The entry is removed from this campaign's figures." confirmLabel="Delete">Delete</ConfirmButton></form>}</span></li>)}</ul>}
        </div>
        {canManage && (
          <details><summary className="cursor-pointer text-sm text-primary">Add spend</summary>
            <form action={spendAction} className="mt-2 grid gap-2 sm:grid-cols-3">
              <input type="hidden" name="id" value={c.id} />
              <div><label className="label" htmlFor="sp-date">Date</label><input id="sp-date" name="date" type="date" max={today} defaultValue={today} required className="input" /></div>
              <div><label className="label" htmlFor="sp-plat">Platform</label><input id="sp-plat" name="platform" required maxLength={40} placeholder="Meta, Google, TikTok, Print" className="input" /></div>
              <div className="grid grid-cols-[1fr_5.5rem] gap-2"><div><label className="label" htmlFor="sp-amt">Amount</label><input id="sp-amt" name="amount" inputMode="decimal" required className="input" /></div><div><label className="label" htmlFor="sp-cur">Currency</label><select id="sp-cur" name="currency" defaultValue={c.currency} className="input">{["PKR", "USD", "AED", "GBP"].map((x) => <option key={x}>{x}</option>)}</select></div></div>
              <div><label className="label" htmlFor="sp-imp">Impressions</label><input id="sp-imp" name="impressions" inputMode="numeric" className="input" /></div>
              <div><label className="label" htmlFor="sp-clk">Clicks</label><input id="sp-clk" name="clicks" inputMode="numeric" className="input" /></div>
              <div><label className="label" htmlFor="sp-res">Results</label><input id="sp-res" name="results" inputMode="numeric" className="input" /></div>
              <div className="sm:col-span-3"><label className="label" htmlFor="sp-note">Note</label><input id="sp-note" name="note" maxLength={300} className="input" /></div>
              <SubmitButton className="btn-ghost">Add spend</SubmitButton>
            </form>
          </details>
        )}
      </section>

      {canManage && (
        <form action={updateCampaignAction} className="card space-y-4">
          <h2 className="font-semibold">Edit campaign</h2>
          <input type="hidden" name="id" value={c.id} />
          <CampaignFields categories={categories} staff={staff} v={{ ...c, budget: c.budget?.toString() ?? null }} />
          <SubmitButton>Save changes</SubmitButton>
        </form>
      )}
    </div>
  );
}
