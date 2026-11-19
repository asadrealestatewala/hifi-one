import Tabs from "@/components/ui/Tabs";
import Link from "next/link";
import { requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";
import { projectScope } from "@/lib/projects";
import { projectProgress } from "@/lib/project-rules";
import { createProject } from "./actions";
import { AppliedFilters, Avatar, Badge, Chips, Empty, NewButton, Notice, PageHeader, PanelForm, SearchBox, Stat, StatusBadge, ListToolbar } from "@/components/ui";
import Drawer from "@/components/ui/Drawer";
import { isOverdue } from "@/lib/project-rules";
import TasksView from "./TasksView";
import WorkloadView from "./WorkloadView";
import TemplatesView from "./TemplatesView";
import PlannerView from "./PlannerView";
import { parseTemplateBody } from "@/lib/project-templates";
import { HEALTH_LABEL, HEALTH_TONE, STALE_UPDATE_DAYS, loadProjectHealth } from "@/lib/project-health";
import { dateInZone } from "@/lib/hr-rules";

export const dynamic = "force-dynamic";

const STATUSES = ["ACTIVE", "ON_HOLD", "COMPLETED", "CANCELLED"];
type SP = { deleted?: string; error?: string; status?: string; q?: string; new?: string; client?: string; campaign?: string; from?: string; view?: string; who?: string; tstatus?: string; priority?: string; project?: string; due?: string; page?: string; person?: string; template?: string; ok?: string; week?: string };

export default async function Projects({ searchParams }: { searchParams: Promise<SP> }) {
  const user = await requirePermission("projects.view");
  const sp = await searchParams;
  const canManage = user.permissions.has("projects.manage");
  // Workload is for whoever assigns work: project management rights, or the manager of at least one project
  const canWorkload = canManage || (await db.project.count({ where: { organizationId: user.organizationId, managerId: user.id } })) > 0;
  const view = sp.view === "tasks" ? "tasks" : sp.view === "planner" ? "planner" : sp.view === "workload" && canWorkload ? "workload" : sp.view === "templates" && canManage ? "templates" : "projects";
  const tabs = <Tabs current={view} items={[{ key: "projects", label: "Projects", href: "/projects" }, { key: "tasks", label: "Tasks", href: "/projects?view=tasks" }, { key: "planner", label: "Planner", href: "/projects?view=planner" }, ...(canWorkload ? [{ key: "workload", label: "Workload", href: "/projects?view=workload" }] : []), ...(canManage ? [{ key: "templates", label: "Templates", href: "/projects?view=templates" }] : [])]} />;
  if (view === "tasks") return <TasksView user={user} sp={sp} tabs={tabs} />;
  if (view === "planner") return <PlannerView user={user} sp={{ week: sp.week }} tabs={tabs} canPlan={canWorkload} />;
  if (view === "workload") return <WorkloadView user={user} sp={{ person: sp.person, page: sp.page }} tabs={tabs} />;
  if (view === "templates") return <TemplatesView user={user} sp={{ ok: sp.ok, status: sp.status }} tabs={tabs} />;
  const status = STATUSES.includes(sp.status ?? "") || sp.status === "ARCHIVED" || sp.status === "ATTENTION" ? sp.status! : "all";
  const q = sp.q?.trim();
  const [rows, clients, staff, templates] = await Promise.all([
    db.project.findMany({ where: projectScope(user), orderBy: { createdAt: "desc" }, include: { tasks: { select: { status: true, dueDate: true, parentId: true } } } }),
    db.client.findMany({ where: { organizationId: user.organizationId, active: true }, orderBy: { name: "asc" } }),
    canManage && sp.new ? db.user.findMany({ where: { organizationId: user.organizationId, active: true, userType: "EMPLOYEE" }, orderBy: { name: "asc" }, select: { id: true, name: true } }) : Promise.resolve([]),
    canManage && sp.new ? db.projectTemplate.findMany({ where: { organizationId: user.organizationId, archivedAt: null }, orderBy: { name: "asc" }, select: { id: true, name: true, body: true, roleDefaults: true, defaultManagerId: true } }) : Promise.resolve([]),
  ]);
  // New project can start from a template: ?template=<id> shows a person picker for each of its roles
  const chosen = templates.find((t) => t.id === sp.template);
  const chosenBody = chosen ? parseTemplateBody(chosen.body) : null;
  const clientName = new Map(clients.map((c) => [c.id, c.name]));
  // Archived projects (closed ones put away) only show under their own chip
  const archived = rows.filter((p) => p.archivedAt);
  const all = rows.filter((p) => !p.archivedAt);
  const count = (s: string) => all.filter((p) => p.status === s).length;
  // Health of every open project: red or amber with the reasons, so trouble shows without asking the team
  const profile = await db.companyProfile.findFirst({ where: { organizationId: user.organizationId, isDefault: true }, select: { timezone: true } });
  const health = await loadProjectHealth(db, { organizationId: user.organizationId, projects: all, today: dateInZone(new Date(), profile?.timezone ?? "UTC"), withBudget: user.permissions.has("projects.costs") });
  const rank = (id: string) => ({ RED: 0, AMBER: 1 } as Record<string, number>)[health.get(id)?.health ?? ""] ?? 2;
  const attention = all.filter((p) => rank(p.id) < 2);
  const atRisk = attention.filter((p) => rank(p.id) === 0).length;
  const lateTasks = all.filter((p) => p.status === "ACTIVE").reduce((n, p) => n + p.tasks.filter((t) => isOverdue(t)).length, 0);
  // ?campaign=linked shows projects that belong to any campaign; ?campaign=<id> one campaign's projects
  const camp = sp.campaign;
  const campaignName = camp && camp !== "linked" ? (await db.campaign.findFirst({ where: { id: camp, organizationId: user.organizationId }, select: { name: true } }))?.name ?? "unknown" : null;
  const projects = (status === "ARCHIVED" ? archived : status === "ATTENTION" ? [...attention].sort((a, b) => rank(a.id) - rank(b.id)) : all).filter((p) => (!camp || (camp === "linked" ? p.campaignId !== null : p.campaignId === camp)) && (status === "all" || status === "ARCHIVED" || status === "ATTENTION" || p.status === status) && (!q || `${p.name} ${p.number} ${p.clientId ? clientName.get(p.clientId) ?? "" : "internal"}`.toLowerCase().includes(q.toLowerCase())));
  const href = (over: Record<string, string | undefined>) => { const p = new URLSearchParams(); for (const [k, v] of Object.entries({ status: status === "all" ? undefined : status, q, campaign: camp, from: sp.from, ...over })) if (v) p.set(k, v); const t = p.toString(); return `/projects${t ? `?${t}` : ""}`; };
  return (
    <div className="space-y-5">
      <PageHeader title="Projects" subtitle="Delivery work, progress and deadlines in one place." actions={canManage ? <NewButton href={href({ new: "1" })}>New project</NewButton> : undefined} />
      {tabs}
      {sp.deleted && <Notice kind="ok">Deleted {sp.deleted}. The audit log keeps a record of it.</Notice>}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Active" value={count("ACTIVE")} href={href({ status: "ACTIVE" })} />
        <Stat label="Needs attention" value={attention.length} hint={attention.length ? [atRisk ? `${atRisk} at risk` : "", attention.length - atRisk ? `${attention.length - atRisk} to watch` : ""].filter(Boolean).join(", ") : "every open project is on track"} href={href({ status: "ATTENTION" })} />
        <Stat label="On hold" value={count("ON_HOLD")} href={href({ status: "ON_HOLD" })} />
        <Stat label="Overdue tasks" value={lateTasks} hint="across active projects" href="/projects?view=tasks&who=all&due=overdue" />
      </div>
      <AppliedFilters items={camp ? [{ label: camp === "linked" ? "Linked to a campaign" : `Campaign: ${campaignName}`, removeHref: href({ campaign: undefined }) }] : []} clearHref="/projects" backHref={sp.from === "dashboard" ? "/dashboard?tab=campaigns" : undefined} />
      <ListToolbar>
        <SearchBox q={q} placeholder="Search project, number or client" hidden={{ status: status === "all" ? undefined : status, campaign: camp, from: sp.from }} />
        <Chips current={status} items={[{ key: "all", label: "All", count: all.length, href: href({ status: undefined }) }, { key: "ATTENTION", label: "Needs attention", count: attention.length, href: href({ status: "ATTENTION" }) }, ...STATUSES.map((s) => ({ key: s, label: s.toLowerCase().replace("_", " ").replace(/^./, (c) => c.toUpperCase()), count: count(s), href: href({ status: s }) })), ...(archived.length ? [{ key: "ARCHIVED", label: "Archived", count: archived.length, href: href({ status: "ARCHIVED" }) }] : [])]} />
      </ListToolbar>
      {projects.length === 0 ? (status === "ATTENTION" && !q && !camp ? <Empty title="Every open project is on track">Nothing is overdue, near its deadline, over budget or quiet for {STALE_UPDATE_DAYS} days.</Empty> : <Empty title={q || status !== "all" ? "No projects match" : "No projects yet"}>{canManage ? "Start one with New project." : "Projects you work on will appear here."}</Empty>) : (
        <div className="card overflow-x-auto !p-0">
          <table className="w-full text-sm">
            <thead className="bg-hover/60 text-left text-xs text-muted"><tr><th className="px-4 py-2.5">Project</th><th className="pr-4">Client</th><th className="pr-4">Status</th><th className="pr-4">Health</th><th className="pr-4">Deadline</th><th className="pr-4">Progress</th></tr></thead>
            <tbody>
              {projects.map((p) => {
                const h = health.get(p.id);
                const pct = projectProgress(p.tasks), late = p.status === "ACTIVE" && p.deadline && p.deadline < new Date();
                return (
                  <tr key={p.id} className="border-t border-border transition hover:bg-hover/50">
                    <td className="px-4 py-3"><Link href={`/projects/${p.id}`} className="flex items-center gap-3"><Avatar name={p.name} /><span><span className="block font-medium hover:underline">{p.name}</span><span className="text-xs text-muted">{p.number}</span></span></Link></td>
                    <td className="pr-4">{p.clientId ? clientName.get(p.clientId) : <span className="text-muted">Internal</span>}</td>
                    <td className="pr-4"><StatusBadge status={p.status} /></td>
                    <td className="max-w-64 py-2 pr-4">{h ? <><Badge tone={HEALTH_TONE[h.health]}>{HEALTH_LABEL[h.health]}</Badge>{h.health !== "PAUSED" && h.reasons.length > 0 && <span className="mt-0.5 block truncate text-xs text-muted" title={h.reasons.join(" · ")}>{h.reasons.join(" · ")}</span>}</> : <span className="text-muted">—</span>}</td>
                    <td className={`pr-4 ${late ? "font-medium text-brand" : "text-muted"}`}>{p.deadline ? p.deadline.toLocaleDateString() : ""}{late ? " · late" : ""}</td>
                    <td className="pr-4"><div className="flex w-32 items-center gap-2"><div className="h-1.5 flex-1 overflow-hidden rounded-full bg-hover" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}><div className={`h-full rounded-full ${pct === 100 ? "bg-success" : "bg-primary"}`} style={{ width: `${pct}%` }} /></div><span className="w-9 text-right text-xs text-muted">{pct}%</span></div></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {canManage && sp.new && (
        <Drawer title="New project" closeTo={href({ new: undefined })}>
          <PanelForm action={createProject} closeTo={href({ new: undefined })} submit="Create project" error={sp.error}>
            {templates.length > 0 && (
              <nav aria-label="Start from" className="space-y-1.5">
                <p className="label">Start from</p>
                <div className="flex flex-wrap gap-2">
                  {[{ id: "", name: "Blank project" }, ...templates].map((t) => {
                    const on = (sp.template ?? "") === t.id || (!chosen && !t.id);
                    return <Link key={t.id || "blank"} href={href({ new: "1", client: sp.client, template: t.id || undefined })} aria-current={on ? "true" : undefined} className={`rounded-full border px-3 py-1 text-sm transition ${on ? "border-primary bg-primary/10 font-medium text-primary" : "border-border hover:bg-hover"}`}>{t.name}</Link>;
                  })}
                </div>
              </nav>
            )}
            {chosen && chosenBody?.ok && (
              <div className="space-y-3 rounded-xl border border-border p-3">
                <input type="hidden" name="templateId" value={chosen.id} />
                <p className="text-sm">Creates {chosenBody.value.milestones.length} milestones and {chosenBody.value.tasks.length} tasks from <span className="font-medium">{chosen.name}</span>, with due dates counted from the start date (today if empty).</p>
                {chosenBody.value.roles.length > 0 && (
                  <div className="grid gap-3 sm:grid-cols-2">
                    {chosenBody.value.roles.map((r, i) => (
                      <div key={r}><label className="label" htmlFor={`role${i}`}>{r}</label><select id={`role${i}`} name={`role${i}`} className="input" defaultValue={((chosen.roleDefaults ?? {}) as Record<string, string>)[r] ?? ""}><option value="">Fill later (tasks unassigned)</option>{staff.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select></div>
                    ))}
                  </div>
                )}
                <p className="text-xs text-muted">Each person joins the team with that role and gets one notice listing their tasks.</p>
              </div>
            )}
            {chosen && chosenBody && !chosenBody.ok && <Notice kind="error">{chosen.name} needs fixing before it can be used: {chosenBody.error}</Notice>}
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="sm:col-span-2"><label className="label" htmlFor="name">Project name</label><input id="name" name="name" required className="input" /></div>
              <div>
                <label className="label" htmlFor="clientId">Client</label>
                <select id="clientId" name="clientId" className="input" defaultValue={sp.client ?? ""}><option value="">Internal project</option>{clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
              </div>
              <div>
                <label className="label" htmlFor="managerId">Project manager</label>
                <select key={chosen?.id ?? "blank"} id="managerId" name="managerId" className="input" defaultValue={chosen?.defaultManagerId && staff.some((u) => u.id === chosen.defaultManagerId) ? chosen.defaultManagerId : user.id}>{staff.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select>
              </div>
              <div>
                <label className="label" htmlFor="priority">Priority</label>
                <select id="priority" name="priority" className="input" defaultValue="MEDIUM">{["LOW", "MEDIUM", "HIGH"].map((c) => <option key={c}>{c}</option>)}</select>
              </div>
              <div><label className="label" htmlFor="startDate">Start date</label><input id="startDate" name="startDate" type="date" className="input" /></div>
              <div><label className="label" htmlFor="deadline">Deadline</label><input id="deadline" name="deadline" type="date" className="input" /></div>
              <div><label className="label" htmlFor="budgetAmount">Approved budget</label><input id="budgetAmount" name="budgetAmount" inputMode="decimal" className="input" /></div>
              <div>
                <label className="label" htmlFor="currency">Currency</label>
                <select id="currency" name="currency" className="input" defaultValue="USD">{["PKR", "USD", "AED", "GBP"].map((c) => <option key={c}>{c}</option>)}</select>
              </div>
              <div className="sm:col-span-2"><label className="label" htmlFor="scope">Scope and deliverables</label><textarea id="scope" name="scope" rows={3} className="input" /></div>
            </div>
          </PanelForm>
        </Drawer>
      )}
    </div>
  );
}
