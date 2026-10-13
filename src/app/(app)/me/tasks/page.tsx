import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { Chips, Empty, PageHeader, Stat, StatusBadge } from "@/components/ui";
import MyTaskStatus from "./MyTaskStatus";

export const dynamic = "force-dynamic";

// Everything assigned to the signed-in person, across projects. It is their own list, scoped by assignee and organization.
export default async function MyTasks({ searchParams }: { searchParams: Promise<{ show?: string }> }) {
  const user = await requireUser();
  const sp = await searchParams;
  const show = sp.show === "done" ? "done" : sp.show === "all" ? "all" : "open";
  const rows = await db.task.findMany({
    where: { assigneeId: user.id, project: { organizationId: user.organizationId, status: { not: "CANCELLED" } }, parentId: null },
    include: { project: { select: { id: true, name: true, number: true, status: true } } },
    orderBy: [{ dueDate: { sort: "asc", nulls: "last" } }, { createdAt: "desc" }], take: 300,
  });
  const today = new Date().toISOString().slice(0, 10);
  const open = rows.filter((t) => t.status !== "DONE");
  const overdue = open.filter((t) => t.dueDate && t.dueDate.toISOString().slice(0, 10) < today).length;
  const dueToday = open.filter((t) => t.dueDate?.toISOString().slice(0, 10) === today).length;
  const shown = rows.filter((t) => (show === "all" ? true : show === "done" ? t.status === "DONE" : t.status !== "DONE"));
  const canMove = user.permissions.has("tasks.edit");
  const href = (s: string) => (s === "open" ? "/me/tasks" : `/me/tasks?show=${s}`);
  return (
    <div className="space-y-5">
      <PageHeader title="My tasks" subtitle="Everything assigned to you across projects." />
      <div className="grid gap-3 sm:grid-cols-3">
        <Stat label="Open" value={open.length} />
        <Stat label="Due today" value={dueToday} />
        <Stat label="Overdue" value={overdue} hint={overdue ? "needs attention" : "all on time"} />
      </div>
      <Chips current={show} items={[{ key: "open", label: "Open", count: open.length, href: href("open") }, { key: "done", label: "Done", count: rows.length - open.length, href: href("done") }, { key: "all", label: "All", count: rows.length, href: href("all") }]} />
      {shown.length === 0 ? <Empty title={show === "done" ? "Nothing finished yet" : "No tasks assigned to you"}>Tasks that a project manager assigns to you will appear here.</Empty> : (
        <div className="card overflow-x-auto !p-0">
          <table className="w-full text-sm">
            <thead className="bg-hover/60 text-left text-xs text-muted"><tr><th className="px-4 py-2.5">Task</th><th className="pr-4">Project</th><th className="pr-4">Priority</th><th className="pr-4">Due</th><th className="pr-4">Status</th></tr></thead>
            <tbody>
              {shown.map((t) => {
                const late = t.status !== "DONE" && t.dueDate && t.dueDate.toISOString().slice(0, 10) < today;
                return (
                  <tr key={t.id} className="border-t border-border transition hover:bg-hover/50">
                    <td className="px-4 py-2.5"><Link href={`/projects/${t.project.id}?task=${t.id}`} className="font-medium hover:underline">{t.title}</Link></td>
                    <td className="pr-4 text-muted">{t.project.name}</td>
                    <td className="pr-4">{t.priority.toLowerCase()}</td>
                    <td className={`pr-4 ${late ? "font-medium text-brand" : "text-muted"}`}>{t.dueDate ? t.dueDate.toLocaleDateString() : ""}{late ? " · overdue" : ""}</td>
                    <td className="pr-4">{canMove && t.project.status === "ACTIVE" ? <MyTaskStatus id={t.id} status={t.status} title={t.title} /> : <StatusBadge status={t.status} />}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
