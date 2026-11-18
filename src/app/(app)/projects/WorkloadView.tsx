import Link from "next/link";
import type { SessionUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { dateInZone } from "@/lib/hr-rules";
import { paging } from "@/lib/paging";
import { projectScope } from "@/lib/projects";
import { getWorkingContext } from "@/lib/working-calendar";
import { loadWorkload, type LoadLevel, type PersonLoad } from "@/lib/workload";
import { Badge, Empty, PageHeader, Pager, Stat } from "@/components/ui";
import TaskListTable from "./TaskListTable";
import { buildTaskRows } from "./task-rows";
import { listLabels } from "@/lib/task-labels";

const LEVEL: Record<LoadLevel, { label: string; tone: "danger" | "warning" | "success" | "neutral"; bar: string }> = {
  OVER: { label: "Over capacity", tone: "danger", bar: "bg-brand" },
  BUSY: { label: "Busy", tone: "warning", bar: "bg-warning" },
  OK: { label: "Has room", tone: "success", bar: "bg-success" },
  UNSIZED: { label: "No estimates", tone: "neutral", bar: "bg-muted" },
  AWAY: { label: "Away", tone: "neutral", bar: "bg-muted" },
};
const fmt = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString(undefined, { day: "numeric", month: "short", timeZone: "UTC" });
const h = (n: number) => `${n % 1 === 0 ? n : n.toFixed(1)} h`;

// Who has too much and who has room over the next 7 days, across the projects this manager runs. Opening a person lists
// their open tasks with the task list's in-place and bulk editing, so work can be handed to someone with room.
export default async function WorkloadView({ user, sp, tabs }: { user: SessionUser; sp: { person?: string; page?: string }; tabs: React.ReactNode }) {
  // Anyone with projects.manage sees every project they can see; a project manager sees the projects they run
  const scope = user.permissions.has("projects.manage") ? projectScope(user) : { organizationId: user.organizationId, managerId: user.id };
  const profile = await db.companyProfile.findFirst({ where: { organizationId: user.organizationId, isDefault: true }, select: { timezone: true } });
  const today = dateInZone(new Date(), profile?.timezone ?? "UTC");
  const work = await getWorkingContext(db, user.organizationId, today, new Date(new Date(`${today}T00:00:00Z`).getTime() + 7 * 86_400_000).toISOString().slice(0, 10));
  const wl = await loadWorkload(db, { scope, organizationId: user.organizationId, today, calendar: work.calendar, holidays: work.holidayDates });
  const person = sp.person === "none" ? "none" : wl.people.find((p) => p.userId === sp.person)?.userId ?? null;
  const pg = paging(sp.page);
  const openWhere = { project: { ...scope, status: { in: ["ACTIVE" as const, "ON_HOLD" as const] }, archivedAt: null }, status: { not: "DONE" }, assigneeId: person === "none" ? null : person ?? undefined };
  const [tasks, taskCount] = person
    ? await Promise.all([
        db.task.findMany({ where: openWhere, include: { project: { select: { id: true, name: true, managerId: true, status: true } } }, orderBy: [{ dueDate: { sort: "asc", nulls: "last" } }, { createdAt: "asc" }, { id: "asc" }], skip: pg.skip, take: pg.take }),
        db.task.count({ where: openWhere }),
      ])
    : [[], 0];
  const list = person ? await buildTaskRows(user, tasks, today, await listLabels(db, user.organizationId)) : null;
  const over = wl.people.filter((p) => p.level === "OVER").length;
  const overdue = wl.people.reduce((n, p) => n + p.overdue, 0);
  const logged = Math.round(wl.people.reduce((n, p) => n + p.loggedHours, 0) * 10) / 10;
  const noEstimate = wl.people.reduce((n, p) => n + p.unestimated, 0);
  const href = (pid?: string) => `/projects?view=workload${pid ? `&person=${pid}` : ""}`;
  const who = person === "none" ? "Unassigned tasks" : wl.people.find((p) => p.userId === person)?.name;

  return (
    <div className="space-y-5">
      <PageHeader title="Projects" subtitle="Delivery work, progress and deadlines in one place." />
      {tabs}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Over capacity" value={over} hint={`of ${wl.people.length} people`} />
        <Stat label="Overdue tasks" value={overdue} hint="held by the team" />
        <Stat label="Unassigned" value={wl.unassigned} hint="open tasks with nobody on them" href={wl.unassigned ? href("none") : undefined} />
        <Stat label="Hours logged" value={h(logged)} hint="this week so far" />
      </div>
      <p className="text-sm text-muted">
        Next 7 days, {fmt(wl.window.from)} to {fmt(wl.window.to)}. Planned hours add up the estimates on open tasks that are overdue or due in that time; available hours follow the working calendar, public holidays and approved leave.
        {noEstimate > 0 && <> {noEstimate} of those tasks have no estimate yet, so the real load is higher. Open a person and fill in Hours to see it.</>}
      </p>
      {wl.people.length === 0 ? <Empty title="Nobody to show yet">Add people to your project teams and assign them tasks; their workload appears here.</Empty> : (
        <div className="card overflow-x-auto !p-0">
          <table className="w-full min-w-[760px] text-sm">
            <thead className="bg-hover/60 text-left text-xs text-muted"><tr><th className="px-4 py-2.5">Person</th><th className="pr-4">Next 7 days</th><th className="pr-4 text-right">Open</th><th className="pr-4 text-right">Overdue</th><th className="pr-4 text-right">Due soon</th><th className="pr-4 text-right">Logged this week</th><th className="pr-4"><span className="sr-only">Tasks</span></th></tr></thead>
            <tbody>
              {wl.people.map((p) => <PersonRow key={p.userId} p={p} active={person === p.userId} href={href(person === p.userId ? undefined : p.userId)} />)}
            </tbody>
          </table>
        </div>
      )}
      {person && list && (
        <section className="space-y-2" aria-labelledby="person-tasks">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 id="person-tasks" className="font-semibold">{who} <span className="text-sm font-normal text-muted">· {taskCount} open</span></h2>
            <Link href={href()} className="text-sm text-primary hover:underline">Close</Link>
          </div>
          <p className="text-xs text-muted">Change the assignee in a row, or tick several and use Assign to, to hand work to someone with room.</p>
          {taskCount === 0 ? <Empty title="No open tasks">Nothing open is assigned here.</Empty> : (
            <>
              <TaskListTable {...list} />
              <div className="card !p-0"><Pager page={pg.page} size={pg.size} total={taskCount} href={(n) => `${href(person)}${n > 1 ? `&page=${n}` : ""}`} /></div>
            </>
          )}
        </section>
      )}
    </div>
  );
}

function PersonRow({ p, active, href }: { p: PersonLoad; active: boolean; href: string }) {
  const lv = LEVEL[p.level];
  const width = p.percent === null ? (p.level === "OVER" ? 100 : 0) : Math.min(100, p.percent);
  return (
    <tr className={`border-t border-border transition hover:bg-hover/50 ${active ? "bg-primary/5" : ""}`}>
      <td className="px-4 py-2.5"><span className="font-medium">{p.name}</span> <Badge tone={lv.tone}>{lv.label}</Badge></td>
      <td className="pr-4">
        <div className="flex w-56 items-center gap-2">
          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-hover" role="progressbar" aria-label={`${p.name}: planned against available hours`} aria-valuenow={p.percent ?? 0} aria-valuemin={0} aria-valuemax={100}>
            <div className={`h-full rounded-full ${lv.bar}`} style={{ width: `${width}%` }} />
          </div>
          <span className="whitespace-nowrap text-xs text-muted">{h(p.plannedHours)} of {h(p.capacityHours)}</span>
        </div>
        {p.unestimated > 0 && <span className="text-[11px] text-muted">{p.unestimated} without estimate</span>}
      </td>
      <td className="pr-4 text-right">{p.open}</td>
      <td className={`pr-4 text-right ${p.overdue ? "font-medium text-brand" : "text-muted"}`}>{p.overdue}</td>
      <td className="pr-4 text-right">{p.dueInWindow}</td>
      <td className="pr-4 text-right text-muted">{h(p.loggedHours)}</td>
      <td className="pr-4 text-right"><Link href={href} className="text-sm text-primary hover:underline" aria-expanded={active}>{active ? "Hide tasks" : "Show tasks"}</Link></td>
    </tr>
  );
}
