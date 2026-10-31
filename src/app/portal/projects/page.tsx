import Link from "next/link";
import { requireClientUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { portalProjects } from "@/lib/portal";
import { Empty, PageHeader, Stat, StatusBadge } from "@/components/ui";

export const dynamic = "force-dynamic";

// The client's own projects: progress and the tasks the team chose to share. Scoped by the signed-in client, never by the address.
export default async function PortalProjects() {
  const user = await requireClientUser();
  const projects = await portalProjects(db, user.clientId);
  const active = projects.filter((p) => p.status === "ACTIVE");
  return (
    <div className="space-y-5">
      <PageHeader title="Your projects" subtitle="Progress on the work we are doing for you. Open a project to see shared tasks and write to the team." />
      <div className="grid gap-3 sm:grid-cols-3">
        <Stat label="Active projects" value={active.length} />
        <Stat label="Completed" value={projects.filter((p) => p.status === "COMPLETED").length} />
        <Stat label="Shared tasks in progress" value={projects.reduce((n, p) => n + p.tasks.filter((t) => t.status === "IN_PROGRESS" || t.status === "REVIEW").length, 0)} />
      </div>
      {projects.length === 0 ? <Empty title="No projects yet">When we start work for you, it appears here.</Empty> : (
        <div className="grid gap-4 md:grid-cols-2">
          {projects.map((p) => (
            <Link key={p.id} href={`/portal/projects/${p.id}`} className="card block space-y-2 transition hover:-translate-y-0.5 hover:border-primary/40">
              <div className="flex items-start justify-between gap-2"><h2 className="font-semibold">{p.name}</h2><StatusBadge status={p.status} /></div>
              <p className="text-xs text-muted">{p.number}{p.deadline && ` · due ${p.deadline.toLocaleDateString()}`}</p>
              <div className="h-2 overflow-hidden rounded-full bg-hover" role="progressbar" aria-valuenow={p.progress} aria-valuemin={0} aria-valuemax={100} aria-label={`${p.name} progress`}><div className="h-full rounded-full bg-primary" style={{ width: `${p.progress}%` }} /></div>
              <p className="text-xs text-muted">{p.progress}% complete · {p.tasks.length} shared task{p.tasks.length === 1 ? "" : "s"}</p>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
