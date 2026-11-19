import Link from "next/link";
import type { SessionUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { dateInZone } from "@/lib/hr-rules";
import { projectScope } from "@/lib/projects";
import { getWorkingContext } from "@/lib/working-calendar";
import { CELL_LIMIT, loadPlannerWeek, plannerWeekStart } from "@/lib/planner";
import { Empty, Notice, PageHeader, Stat } from "@/components/ui";
import PlannerBoard from "./PlannerBoard";

const fmt = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const h = (n: number) => `${n % 1 === 0 ? n : n.toFixed(1)} h`;

// Projects → Planner: the week by person and day. Whoever assigns work (projects.manage, or the manager of a project) sees the
// team on the projects they run and can drag tasks between days and people; everyone else sees their own week.
export default async function PlannerView({ user, sp, tabs, canPlan }: { user: SessionUser; sp: { week?: string }; tabs: React.ReactNode; canPlan: boolean }) {
  const scope = !canPlan ? projectScope(user) : user.permissions.has("projects.manage") ? projectScope(user) : { organizationId: user.organizationId, managerId: user.id };
  const profile = await db.companyProfile.findFirst({ where: { organizationId: user.organizationId, isDefault: true }, select: { timezone: true } });
  const today = dateInZone(new Date(), profile?.timezone ?? "UTC");
  const week = plannerWeekStart(sp.week, today);
  const end = new Date(new Date(`${week}T00:00:00Z`).getTime() + 6 * 86_400_000).toISOString().slice(0, 10);
  const work = await getWorkingContext(db, user.organizationId, week, end);
  const pw = await loadPlannerWeek(db, { scope, organizationId: user.organizationId, today, week, calendar: work.calendar, holidays: work.holidays, actor: user, onlyUserId: canPlan ? undefined : user.id });
  const seen = new Set<string>();
  const tasks = [...pw.rows.flatMap((r) => r.cells.flatMap((c) => c.tasks)), ...pw.tray].filter((t) => (seen.has(t.id) ? false : (seen.add(t.id), true)));
  const rows = pw.rows.map((r) => ({ userId: r.userId, name: r.name, capacity: Object.fromEntries(r.cells.map((c) => [c.date, c.capacityHours])), away: r.cells.filter((c) => c.away).map((c) => c.date) }));
  const planned = pw.rows.reduce((n, r) => n + r.plannedHours, 0);
  const capacity = pw.rows.reduce((n, r) => n + r.capacityHours, 0);
  const overDays = pw.rows.reduce((n, r) => n + (r.userId === null ? 0 : r.cells.filter((c) => c.plannedHours > c.capacityHours && c.date >= today).length), 0);
  const noEstimate = pw.rows.reduce((n, r) => n + r.cells.reduce((k, c) => k + c.unestimated, 0), 0);
  const isThisWeek = week === plannerWeekStart(undefined, today);
  const href = (w?: string) => `/projects?view=planner${w ? `&week=${w}` : ""}`;

  return (
    <div className="space-y-5">
      <PageHeader title="Projects" subtitle="Delivery work, progress and deadlines in one place." />
      {tabs}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Planned this week" value={h(Math.round(planned * 10) / 10)} hint={`of ${h(Math.round(capacity * 10) / 10)} available`} />
        <Stat label="Overloaded days" value={overDays} hint="a person has more due than they can work" />
        <Stat label="To plan" value={pw.trayTotal} hint="no date yet, or overdue" />
        <Stat label="No estimate" value={noEstimate} hint="tasks this week without hours" />
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Link href={href(pw.prev)} className="btn-ghost" aria-label="Previous week">← Previous</Link>
          <h2 className="font-semibold">{fmt(pw.from)} to {fmt(pw.to)}</h2>
          <Link href={href(pw.next)} className="btn-ghost" aria-label="Next week">Next →</Link>
          {!isThisWeek && <Link href={href()} className="text-sm text-primary hover:underline">This week</Link>}
        </div>
        <p className="text-xs text-muted">{canPlan ? "Drag a task to another day or person, or use Move on the card." : "Your week. Your project manager plans the dates."}</p>
      </div>
      {pw.truncated && <Notice kind="error">This week has more than {CELL_LIMIT} open tasks, so only the first {CELL_LIMIT} by due date are on the grid. Filter in Tasks to see the rest.</Notice>}
      {pw.rows.length === 0 && pw.tray.length === 0 ? (
        <Empty title="Nothing to plan yet">{canPlan ? "Add people to your project teams and give tasks due dates; they appear here by day." : "No open tasks are assigned to you."}</Empty>
      ) : (
        <PlannerBoard key={week} days={pw.days} rows={rows} tasks={tasks} people={pw.people} today={today} trayHidden={Math.max(0, pw.trayTotal - pw.tray.length)} />
      )}
      <p className="text-xs text-muted">
        Each day shows the estimates of the tasks due that day against the hours that person can work, following the working calendar, public holidays and approved leave. A long task counts in full on its due day, so spread big work by giving it an earlier date or splitting it into subtasks. Red means more is due than fits.
      </p>
    </div>
  );
}
