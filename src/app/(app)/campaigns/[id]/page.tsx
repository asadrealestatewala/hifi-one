import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/auth";
import { campaignMetrics } from "@/lib/campaigns";
import { db } from "@/lib/db";
import { formatMoney } from "@/lib/money";
import { ConfirmButton, Notice, Stat, StatusBadge, SubmitButton } from "@/components/ui";
import CampaignFields from "../CampaignFields";
import { campaignLinksAction, updateCampaignAction } from "../actions";

export const dynamic = "force-dynamic";

export default async function CampaignPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string; msg?: string }> }) {
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
