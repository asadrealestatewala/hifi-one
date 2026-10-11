import Link from "next/link";
import { requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";
import { projectScope } from "@/lib/projects";
import { projectProgress } from "@/lib/project-rules";
import { createProject } from "./actions";

export const dynamic = "force-dynamic";

export default async function Projects({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const user = await requirePermission("projects.view");
  const { error } = await searchParams;
  const canManage = user.permissions.has("projects.manage");
  const [projects, clients] = await Promise.all([
    db.project.findMany({ where: projectScope(user), orderBy: { createdAt: "desc" }, include: { tasks: { select: { status: true } } } }),
    db.client.findMany({ where: { organizationId: user.organizationId, active: true }, orderBy: { name: "asc" } }),
  ]);
  const clientName = new Map(clients.map((c) => [c.id, c.name]));
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Projects</h1>
      <div className="card overflow-x-auto">
        {projects.length === 0 ? <p className="text-sm text-muted">No projects yet.</p> : (
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-muted">
              <tr><th className="py-2 pr-4">Number</th><th className="pr-4">Project</th><th className="pr-4">Client</th><th className="pr-4">Status</th><th className="pr-4">Deadline</th><th>Progress</th></tr>
            </thead>
            <tbody>
              {projects.map((p) => (
                <tr key={p.id} className="border-t border-border">
                  <td className="py-2 pr-4 text-muted">{p.number}</td>
                  <td className="pr-4 font-medium"><Link className="hover:underline" href={`/projects/${p.id}`}>{p.name}</Link></td>
                  <td className="pr-4">{p.clientId ? clientName.get(p.clientId) : "Internal"}</td>
                  <td className="pr-4">{p.status.replace("_", " ")}</td>
                  <td className="pr-4">{p.deadline ? p.deadline.toLocaleDateString() : ""}</td>
                  <td>{projectProgress(p.tasks)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {canManage && (
        <form action={createProject} className="card grid gap-4 sm:grid-cols-2">
          <h2 className="font-semibold sm:col-span-2">New project</h2>
          {error && <p role="alert" className="sm:col-span-2 text-sm text-brand bg-brand/10 rounded-lg px-3 py-2">{error}</p>}
          <div className="sm:col-span-2">
            <label className="label" htmlFor="name">Project name</label>
            <input id="name" name="name" required className="input" />
          </div>
          <div>
            <label className="label" htmlFor="clientId">Client (leave empty for internal)</label>
            <select id="clientId" name="clientId" className="input">
              <option value="">Internal project</option>
              {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="priority">Priority</label>
            <select id="priority" name="priority" className="input" defaultValue="MEDIUM">
              {["LOW", "MEDIUM", "HIGH"].map((c) => <option key={c}>{c}</option>)}
            </select>
          </div>
          <div><label className="label" htmlFor="startDate">Start date</label><input id="startDate" name="startDate" type="date" className="input" /></div>
          <div><label className="label" htmlFor="deadline">Deadline</label><input id="deadline" name="deadline" type="date" className="input" /></div>
          <div><label className="label" htmlFor="budgetAmount">Approved budget</label><input id="budgetAmount" name="budgetAmount" inputMode="decimal" className="input" /></div>
          <div>
            <label className="label" htmlFor="currency">Currency</label>
            <select id="currency" name="currency" className="input" defaultValue="USD">
              {["PKR", "USD", "AED", "GBP"].map((c) => <option key={c}>{c}</option>)}
            </select>
          </div>
          <div className="sm:col-span-2">
            <label className="label" htmlFor="scope">Scope and deliverables</label>
            <textarea id="scope" name="scope" rows={3} className="input" />
          </div>
          <div className="sm:col-span-2"><button className="btn">Create project</button></div>
        </form>
      )}
    </div>
  );
}
