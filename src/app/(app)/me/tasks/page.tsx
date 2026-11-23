import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { dateInZone } from "@/lib/hr-rules";
import { WORK_GROUPS, WORK_GROUP_LABEL, loadMyWork, type WorkGroup, type WorkRow, type WorkSection } from "@/lib/my-work";
import { Chips, Empty, PageHeader, Pager, Stat, StatusBadge } from "@/components/ui";
import { paging } from "@/lib/paging";
import MyTaskStatus from "./MyTaskStatus";
import QuickDone from "./QuickDone";
import TaskCountdown from "@/components/ui/TaskCountdown";
import { deadlineView, type DeadlineCalendar } from "@/lib/task-deadline";
import { getCalendar } from "@/lib/working-calendar";

export const dynamic = "force-dynamic";

const PER_GROUP = 25;
const label = (s: string) => s.toLowerCase().replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());

// Everything assigned to the signed-in person, across projects, grouped by when it is due, with one tick to finish a
// task. It is their own list, scoped by assignee and organization. ?group=<key> shows one group in full, page by page;
// ?show=done is everything they have finished.
export default async function MyTasks({ searchParams }: { searchParams: Promise<{ show?: string; group?: string; page?: string }> }) {
  const user = await requireUser();
  const sp = await searchParams;
  const profile = await db.companyProfile.findFirst({ where: { organizationId: user.organizationId, isDefault: true }, select: { timezone: true } });
  const tz = profile?.timezone ?? "UTC";
  const cal = await getCalendar(db, user.organizationId);
  const today = dateInZone(new Date(), tz);
  const canMove = user.permissions.has("tasks.edit");
  const showDone = sp.show === "done";
  const group = (WORK_GROUPS as readonly string[]).includes(sp.group ?? "") ? (sp.group as WorkGroup) : null;
  const pg = paging(sp.page);
  const mine = { assigneeId: user.id, project: { organizationId: user.organizationId, status: { not: "CANCELLED" as const }, archivedAt: null } };

  const [summary, focus, doneRows, doneCount, myCampaigns] = await Promise.all([
    loadMyWork(db, { organizationId: user.organizationId, userId: user.id, today, timeZone: tz, perGroup: PER_GROUP }),
    group ? loadMyWork(db, { organizationId: user.organizationId, userId: user.id, today, timeZone: tz, only: { group, skip: pg.skip, take: pg.take } }) : null,
    showDone ? db.task.findMany({ where: { ...mine, status: "DONE" }, include: { project: { select: { id: true, name: true, number: true, status: true } } }, orderBy: [{ completedAt: { sort: "desc", nulls: "last" } }, { id: "asc" }], skip: pg.skip, take: pg.take }) : [],
    db.task.count({ where: { ...mine, status: "DONE" } }),
    // Campaigns the person is on are part of their workload, whether or not they can open the campaign list
    db.campaignMember.findMany({ where: { userId: user.id, campaign: { organizationId: user.organizationId, archivedAt: null } }, include: { campaign: { select: { id: true, name: true, code: true, status: true, endDate: true } } }, orderBy: { addedAt: "desc" } }),
  ]);
  const count = (k: WorkSection["key"]) => summary.sections.find((s) => s.key === k)?.count ?? 0;
  const canOpenCampaigns = user.permissions.has("campaigns.view");
  const nothingOpen = summary.open === 0;

  return (
    <div className="space-y-5">
      <PageHeader title="My tasks" subtitle="Everything assigned to you across projects, grouped by when it is due. Tick a task to finish it." />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Overdue" value={count("overdue")} hint={count("overdue") ? "needs attention" : "all on time"} href="/me/tasks?group=overdue" />
        <Stat label="Due today" value={count("today")} href="/me/tasks?group=today" />
        <Stat label="Next 7 days" value={count("week")} href="/me/tasks?group=week" />
        <Stat label="Done today" value={count("done")} hint={`${summary.open} still open`} icon="check" />
      </div>
      <Chips current={showDone ? "done" : group ?? "open"} items={[
        { key: "open", label: "Open", count: summary.open, href: "/me/tasks" },
        ...(group ? [{ key: group, label: WORK_GROUP_LABEL[group], count: count(group), href: `/me/tasks?group=${group}` }] : []),
        { key: "done", label: "Done", count: doneCount, href: "/me/tasks?show=done" },
      ]} />

      {showDone ? (
        doneRows.length === 0 ? <Empty title="Nothing finished yet">Tasks you tick as done will appear here.</Empty> : (
          <TaskTable cal={cal} rows={doneRows.map((t) => ({ id: t.id, title: t.title, status: t.status, priority: t.priority, dueDate: t.dueDate, dueTime: t.dueTime, assignedAt: t.assignedAt, createdAt: t.createdAt, completedAt: t.completedAt, project: t.project, parentTitle: null, openSubtasks: 0, waiting: 0 }))} today={today} canMove={false}
            footer={<Pager page={pg.page} size={pg.size} total={doneCount} href={(n) => `/me/tasks?show=done${n > 1 ? `&page=${n}` : ""}`} />} />
        )
      ) : group && focus ? (
        <section className="space-y-2" aria-labelledby="group-title">
          <h2 id="group-title" className="font-semibold">{WORK_GROUP_LABEL[group]} <span className="text-sm font-normal text-muted">· {focus.sections[0].count}</span></h2>
          {focus.sections[0].count === 0 ? <Empty title={`Nothing in ${WORK_GROUP_LABEL[group]}`}><Link className="underline" href="/me/tasks">Back to all open tasks</Link></Empty> : (
            <TaskTable cal={cal} rows={focus.sections[0].rows} today={today} canMove={canMove}
              footer={<Pager page={pg.page} size={pg.size} total={focus.sections[0].count} href={(n) => `/me/tasks?group=${group}${n > 1 ? `&page=${n}` : ""}`} />} />
          )}
        </section>
      ) : nothingOpen && count("done") === 0 ? (
        <Empty title="No open tasks assigned to you">Tasks that a project manager assigns to you will appear here, grouped by due date.</Empty>
      ) : (
        <>
          {nothingOpen && <Empty title="All done for now">Nothing open is assigned to you. Well done.</Empty>}
          {summary.sections.filter((s) => s.count > 0).map((s) => (
            <section key={s.key} className="space-y-2" aria-labelledby={`g-${s.key}`}>
              <div className="flex items-baseline justify-between gap-3">
                <h2 id={`g-${s.key}`} className={`font-semibold ${s.key === "overdue" ? "text-brand" : ""}`}>{WORK_GROUP_LABEL[s.key]} <span className="text-sm font-normal text-muted">· {s.count}</span></h2>
                {s.key !== "done" && s.count > s.rows.length && <Link className="text-sm text-primary hover:underline" href={`/me/tasks?group=${s.key}`}>Show all {s.count}</Link>}
              </div>
              <TaskTable cal={cal} rows={s.rows} today={today} canMove={canMove} done={s.key === "done"}
                footer={s.key === "done" && s.count > s.rows.length ? <p className="border-t border-border px-4 py-2 text-xs text-muted">{s.rows.length} of {s.count} shown. <Link className="underline" href="/me/tasks?show=done">See all finished tasks</Link></p> : undefined} />
            </section>
          ))}
        </>
      )}

      <section className="card space-y-2" aria-labelledby="my-campaigns">
        <h2 id="my-campaigns" className="font-semibold">My campaigns</h2>
        {myCampaigns.length === 0 ? <p className="text-sm text-muted">You are not on any campaign team.</p> : (
          <ul className="flex flex-wrap gap-2">{myCampaigns.map((m) => {
            const body = <><span className="font-medium">{m.campaign.name}</span> <span className="text-xs text-muted">{m.campaign.code}{m.campaign.endDate && ` · ends ${m.campaign.endDate}`}</span> <StatusBadge status={m.campaign.status} /></>;
            return <li key={m.campaignId} className="rounded-lg border border-border px-3 py-1.5 text-sm">{canOpenCampaigns ? <Link href={`/campaigns/${m.campaignId}`} className="hover:underline">{body}</Link> : body}</li>;
          })}</ul>
        )}
      </section>
    </div>
  );
}

function TaskTable({ rows, canMove, done = false, footer, cal }: { rows: WorkRow[]; today: string; canMove: boolean; done?: boolean; footer?: React.ReactNode; cal: DeadlineCalendar }) {
  const now = new Date();
  const closed = (s: string) => s === "COMPLETED" || s === "CANCELLED";
  return (
    <div className="card overflow-x-auto !p-0">
      {/* Fixed column widths so every group's table lines up with the next */}
      <table className="w-full min-w-[720px] table-fixed text-sm">
        <colgroup><col className="w-12" /><col /><col className="w-[22%]" /><col className="w-24" /><col className="w-48" /><col className="w-44" /></colgroup>
        <thead className="bg-hover/60 text-left text-xs text-muted"><tr><th className="px-4 py-2.5"><span className="sr-only">Done</span></th><th className="py-2.5 pr-4">Task</th><th className="pr-4">Project</th><th className="pr-4">Priority</th><th className="pr-4">Due</th><th className="pr-4">Status</th></tr></thead>
        <tbody>
          {rows.map((t) => {
            const due = t.dueDate?.toISOString().slice(0, 10);
            const dv = deadlineView(t, cal, now);
            const late = t.status !== "DONE" && Boolean(dv) && new Date(dv!.deadline) < now;
            const editable = canMove && !closed(t.project.status);
            return (
              <tr key={t.id} className={`border-t border-border transition hover:bg-hover/50 ${t.status === "DONE" ? "text-muted" : ""}`}>
                <td className="px-4 py-2.5 align-top">{editable ? <QuickDone id={t.id} title={t.title} done={t.status === "DONE"} /> : null}</td>
                <td className="py-2.5 pr-4">
                  <Link href={`/projects/${t.project.id}?task=${t.id}`} className={`font-medium hover:underline ${t.status === "DONE" ? "line-through" : ""}`}>{t.title}</Link>
                  {/* On a phone the Due column is off to the right, so the countdown also sits under the title */}
                  {dv && <span className="mt-1 block sm:hidden"><TaskCountdown deadline={dv.deadline} from={dv.from} completedAt={dv.completedAt} title={dv.title} /></span>}
                  {(t.parentTitle || t.openSubtasks > 0 || t.waiting > 0) && (
                    <span className="mt-0.5 block text-xs text-muted">
                      {[t.parentTitle && `Subtask of ${t.parentTitle}`, t.openSubtasks > 0 && `${t.openSubtasks} open subtask${t.openSubtasks === 1 ? "" : "s"}`, t.waiting > 0 && `Waiting for ${t.waiting} task${t.waiting === 1 ? "" : "s"}`].filter(Boolean).join(" · ")}
                    </span>
                  )}
                </td>
                <td className="truncate pr-4 text-muted"><Link className="hover:underline" href={`/projects/${t.project.id}`} title={t.project.name}>{t.project.name}</Link></td>
                <td className="pr-4"><span className={t.priority === "HIGH" ? "font-medium text-brand" : "text-muted"}>{label(t.priority)}</span></td>
                <td className={`py-2 pr-4 text-xs ${late ? "font-medium text-brand" : "text-muted"}`}>
                  {dv ? <span className="flex flex-col items-start gap-1"><TaskCountdown deadline={dv.deadline} from={dv.from} completedAt={dv.completedAt} title={dv.title} /><span className="whitespace-nowrap">{dv.title}</span></span> : due ?? ""}
                </td>
                <td className="pr-4">{editable && !done ? <MyTaskStatus id={t.id} status={t.status} title={t.title} /> : <StatusBadge status={t.status} />}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {footer}
    </div>
  );
}
