import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { Chips, Empty, PageHeader, Pager, Stat, StatusBadge } from "@/components/ui";
import { paging } from "@/lib/paging";
import MyTaskStatus from "./MyTaskStatus";

export const dynamic = "force-dynamic";

// Everything assigned to the signed-in person, across projects. It is their own list, scoped by assignee and organization.
export default async function MyTasks({ searchParams }: { searchParams: Promise<{ show?: string; page?: string }> }) {
  const user = await requireUser();
  const sp = await searchParams;
  const show = sp.show === "done" ? "done" : sp.show === "all" ? "all" : "open";
  const mine = { assigneeId: user.id, project: { organizationId: user.organizationId, status: { not: "CANCELLED" as const } }, parentId: null };
  const today = new Date().toISOString().slice(0, 10);
  const dayStart = new Date(`${today}T00:00:00.000Z`);
  const dayEnd = new Date(dayStart.getTime() + 86_400_000);
  const pg = paging(sp.page);
  const where = { ...mine, ...(show === "all" ? {} : show === "done" ? { status: "DONE" as const } : { status: { not: "DONE" as const } }) };
  // Counts are taken over all of the person's tasks; only the shown page is loaded
  const [shown, matched, openCount, doneCount, overdue, dueToday] = await Promise.all([
    db.task.findMany({ where, include: { project: { select: { id: true, name: true, number: true, status: true } } }, orderBy: [{ dueDate: { sort: "asc", nulls: "last" } }, { createdAt: "desc" }, { id: "asc" }], skip: pg.skip, take: pg.take }),
    db.task.count({ where }),
    db.task.count({ where: { ...mine, status: { not: "DONE" } } }),
    db.task.count({ where: { ...mine, status: "DONE" } }),
    db.task.count({ where: { ...mine, status: { not: "DONE" }, dueDate: { lt: dayStart } } }),
    db.task.count({ where: { ...mine, status: { not: "DONE" }, dueDate: { gte: dayStart, lt: dayEnd } } }),
  ]);
  const canMove = user.permissions.has("tasks.edit");
  // Campaigns the person is on are part of their workload, whether or not they can open the campaign list
  const myCampaigns = await db.campaignMember.findMany({ where: { userId: user.id, campaign: { organizationId: user.organizationId, archivedAt: null } }, include: { campaign: { select: { id: true, name: true, code: true, status: true, endDate: true } } }, orderBy: { addedAt: "desc" } });
  const canOpenCampaigns = user.permissions.has("campaigns.view");
  const href = (s: string) => (s === "open" ? "/me/tasks" : `/me/tasks?show=${s}`);
  return (
    <div className="space-y-5">
      <PageHeader title="My tasks" subtitle="Everything assigned to you across projects and campaigns." />
      <section className="card space-y-2" aria-labelledby="my-campaigns">
        <h2 id="my-campaigns" className="font-semibold">My campaigns</h2>
        {myCampaigns.length === 0 ? <p className="text-sm text-muted">You are not on any campaign team.</p> : (
          <ul className="flex flex-wrap gap-2">{myCampaigns.map((m) => {
            const body = <><span className="font-medium">{m.campaign.name}</span> <span className="text-xs text-muted">{m.campaign.code}{m.campaign.endDate && ` · ends ${m.campaign.endDate}`}</span> <StatusBadge status={m.campaign.status} /></>;
            return <li key={m.campaignId} className="rounded-lg border border-border px-3 py-1.5 text-sm">{canOpenCampaigns ? <Link href={`/campaigns/${m.campaignId}`} className="hover:underline">{body}</Link> : body}</li>;
          })}</ul>
        )}
      </section>
      <div className="grid gap-3 sm:grid-cols-3">
        <Stat label="Open" value={openCount} />
        <Stat label="Due today" value={dueToday} />
        <Stat label="Overdue" value={overdue} hint={overdue ? "needs attention" : "all on time"} />
      </div>
      <Chips current={show} items={[{ key: "open", label: "Open", count: openCount, href: href("open") }, { key: "done", label: "Done", count: doneCount, href: href("done") }, { key: "all", label: "All", count: openCount + doneCount, href: href("all") }]} />
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
          <Pager page={pg.page} size={pg.size} total={matched} href={(n) => { const p = new URLSearchParams(); if (show !== "open") p.set("show", show); if (n > 1) p.set("page", String(n)); const t = p.toString(); return `/me/tasks${t ? `?${t}` : ""}`; }} />
        </div>
      )}
    </div>
  );
}
