import Link from "next/link";
import { requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";
import { projectScope } from "@/lib/projects";
import { projectProgress } from "@/lib/project-rules";
import { createProject } from "./actions";
import { Avatar, Chips, Empty, NewButton, PageHeader, PanelForm, SearchBox, Stat, StatusBadge } from "@/components/ui";
import Drawer from "@/components/ui/Drawer";
import { isOverdue } from "@/lib/project-rules";

export const dynamic = "force-dynamic";

const STATUSES = ["ACTIVE", "ON_HOLD", "COMPLETED", "CANCELLED"];
type SP = { error?: string; status?: string; q?: string; new?: string };

export default async function Projects({ searchParams }: { searchParams: Promise<SP> }) {
  const user = await requirePermission("projects.view");
  const sp = await searchParams;
  const canManage = user.permissions.has("projects.manage");
  const status = STATUSES.includes(sp.status ?? "") ? sp.status! : "all";
  const q = sp.q?.trim();
  const [all, clients] = await Promise.all([
    db.project.findMany({ where: projectScope(user), orderBy: { createdAt: "desc" }, include: { tasks: { select: { status: true, dueDate: true } } } }),
    db.client.findMany({ where: { organizationId: user.organizationId, active: true }, orderBy: { name: "asc" } }),
  ]);
  const clientName = new Map(clients.map((c) => [c.id, c.name]));
  const count = (s: string) => all.filter((p) => p.status === s).length;
  const lateTasks = all.filter((p) => p.status === "ACTIVE").reduce((n, p) => n + p.tasks.filter((t) => isOverdue(t)).length, 0);
  const projects = all.filter((p) => (status === "all" || p.status === status) && (!q || `${p.name} ${p.number} ${p.clientId ? clientName.get(p.clientId) ?? "" : "internal"}`.toLowerCase().includes(q.toLowerCase())));
  const href = (over: Record<string, string | undefined>) => { const p = new URLSearchParams(); for (const [k, v] of Object.entries({ status: status === "all" ? undefined : status, q, ...over })) if (v) p.set(k, v); const t = p.toString(); return `/projects${t ? `?${t}` : ""}`; };
  return (
    <div className="space-y-5">
      <PageHeader title="Projects" subtitle="Delivery work, progress and deadlines in one place." actions={canManage ? <NewButton href={href({ new: "1" })}>New project</NewButton> : undefined} />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Active" value={count("ACTIVE")} />
        <Stat label="On hold" value={count("ON_HOLD")} />
        <Stat label="Completed" value={count("COMPLETED")} />
        <Stat label="Overdue tasks" value={lateTasks} hint="across active projects" />
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <SearchBox q={q} placeholder="Search project, number or client" hidden={{ status: status === "all" ? undefined : status }} />
        <Chips current={status} items={[{ key: "all", label: "All", count: all.length, href: href({ status: undefined }) }, ...STATUSES.map((s) => ({ key: s, label: s.toLowerCase().replace("_", " ").replace(/^./, (c) => c.toUpperCase()), count: count(s), href: href({ status: s }) }))]} />
      </div>
      {projects.length === 0 ? <Empty title={q || status !== "all" ? "No projects match" : "No projects yet"}>{canManage ? "Start one with New project." : "Projects you work on will appear here."}</Empty> : (
        <div className="card overflow-x-auto !p-0">
          <table className="w-full text-sm">
            <thead className="bg-hover/60 text-left text-xs text-muted"><tr><th className="px-4 py-2.5">Project</th><th className="pr-4">Client</th><th className="pr-4">Status</th><th className="pr-4">Deadline</th><th className="pr-4">Progress</th></tr></thead>
            <tbody>
              {projects.map((p) => {
                const pct = projectProgress(p.tasks), late = p.status === "ACTIVE" && p.deadline && p.deadline < new Date();
                return (
                  <tr key={p.id} className="border-t border-border transition hover:bg-hover/50">
                    <td className="px-4 py-3"><Link href={`/projects/${p.id}`} className="flex items-center gap-3"><Avatar name={p.name} /><span><span className="block font-medium hover:underline">{p.name}</span><span className="text-xs text-muted">{p.number}</span></span></Link></td>
                    <td className="pr-4">{p.clientId ? clientName.get(p.clientId) : <span className="text-muted">Internal</span>}</td>
                    <td className="pr-4"><StatusBadge status={p.status} /></td>
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
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="sm:col-span-2"><label className="label" htmlFor="name">Project name</label><input id="name" name="name" required className="input" /></div>
              <div>
                <label className="label" htmlFor="clientId">Client</label>
                <select id="clientId" name="clientId" className="input"><option value="">Internal project</option>{clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
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
