import Link from "next/link";
import type { SessionUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { dateInZone } from "@/lib/hr-rules";
import { loadHoursReport, periodRange, type HoursRow, type Period } from "@/lib/hours-report";
import { projectScope } from "@/lib/projects";
import { getWorkingContext } from "@/lib/working-calendar";
import { Empty, ExportLink, PageHeader, Stat } from "@/components/ui";
import WorkloadSwitch from "./WorkloadSwitch";

const h = (n: number) => `${n % 1 === 0 ? n : n.toFixed(1)} h`;
const pct = (n: number | null) => (n === null ? "–" : `${n}%`);

// Who worked how much in a week or month: working hours, hours planned for them, hours logged on client and internal projects,
// and how much of their working time that covers. Same people and projects as Workload; a past period can be opened and exported.
export default async function HoursReportView({ user, sp, tabs }: { user: SessionUser; sp: { period?: string; at?: string }; tabs: React.ReactNode }) {
  const scope = user.permissions.has("projects.manage") ? projectScope(user) : { organizationId: user.organizationId, managerId: user.id };
  const profile = await db.companyProfile.findFirst({ where: { organizationId: user.organizationId, isDefault: true }, select: { timezone: true } });
  const today = dateInZone(new Date(), profile?.timezone ?? "UTC");
  const period: Period = sp.period === "week" ? "week" : "month";
  const range = periodRange(period, sp.at, today);
  const work = await getWorkingContext(db, user.organizationId, range.from, range.to);
  const r = await loadHoursReport(db, { scope, organizationId: user.organizationId, period, at: sp.at, today, calendar: work.calendar, holidays: work.holidayDates });
  const href = (q: { period?: Period; at?: string }) => `/projects?view=workload&report=hours&period=${q.period ?? period}${q.at ? `&at=${q.at}` : ""}`;
  const mine = !user.permissions.has("projects.manage");
  const noEstimate = r.rows.reduce((n, x) => n + x.unestimated, 0);

  return (
    <div className="space-y-5">
      <PageHeader title="Projects" subtitle="Delivery work, progress and deadlines in one place." />
      {tabs}
      <WorkloadSwitch current="hours" />
      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex rounded-lg border border-border p-0.5 text-sm" role="group" aria-label="Period">
          {(["week", "month"] as const).map((p) => <Link key={p} href={href({ period: p, at: r.current ? undefined : range.from })} aria-current={p === period ? "true" : undefined} className={`rounded-md px-3 py-1 ${p === period ? "bg-primary text-white" : "text-muted hover:text-foreground"}`}>{p === "week" ? "Week" : "Month"}</Link>)}
        </div>
        <Link href={href({ at: r.prev })} className="btn-ghost !py-1" aria-label={`Previous ${period}`}>←</Link>
        <span className="font-medium">{r.label}</span>
        <Link href={href({ at: r.next })} className="btn-ghost !py-1" aria-label={`Next ${period}`}>→</Link>
        {!r.current && <Link href={href({})} className="text-sm text-primary hover:underline">This {period}</Link>}
        <span className="flex-1" />
        {r.rows.length > 0 && <ExportLink href={`/projects/hours/export?period=${period}&at=${r.from}`} />}
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Hours logged" value={h(r.totals.loggedHours)} hint={`${h(r.totals.clientHours)} client · ${h(r.totals.internalHours)} internal`} />
        <Stat label="Utilisation" value={pct(r.totals.utilisation)} hint={`of ${h(r.totals.availableSoFar)} working hours${r.current ? " so far" : ""}`} />
        <Stat label="Planned" value={h(r.totals.plannedHours)} hint="estimates on tasks due in this period" />
        <Stat label="Awaiting approval" value={h(r.totals.pendingHours)} hint="logged hours not yet approved" />
      </div>
      <p className="text-sm text-muted">
        {r.from} to {r.to}. Working hours follow the working calendar, public holidays and approved leave. Utilisation is logged hours against working hours{r.current ? " up to today" : ""}. Client hours are on projects with a client; internal hours are on projects without one.
        {mine ? " Only time on the projects you manage is counted." : ""}
        {noEstimate > 0 ? ` ${noEstimate} tasks due in this period have no estimate, so planned hours are lower than the real plan.` : ""}
      </p>
      {r.rows.length === 0 ? <Empty title="No hours to show">Nobody is on these projects and no time was logged in this period.</Empty> : (
        <div className="card overflow-x-auto !p-0">
          <table className="w-full min-w-[760px] text-sm">
            <thead className="bg-hover/60 text-left text-xs text-muted"><tr><th className="px-4 py-2.5">Person</th><th className="pr-4 text-right">Working hours</th><th className="pr-4 text-right">Planned</th><th className="pr-4 text-right">Logged</th><th className="pr-4 text-right">Client</th><th className="pr-4 text-right">Internal</th><th className="pr-4">Utilisation</th></tr></thead>
            <tbody>{r.rows.map((x) => <Row key={x.userId} x={x} current={r.current} />)}</tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Row({ x, current }: { x: HoursRow; current: boolean }) {
  const u = x.utilisation;
  const bar = u === null ? "bg-muted" : u > 100 ? "bg-brand" : u >= 70 ? "bg-success" : "bg-warning";
  return (
    <tr className="border-t border-border">
      <td className="px-4 py-2.5 font-medium">{x.name}</td>
      <td className="pr-4 text-right">{current && x.availableSoFar !== x.availableHours ? <>{h(x.availableSoFar)} <span className="text-xs text-muted">of {h(x.availableHours)}</span></> : h(x.availableHours)}</td>
      <td className="pr-4 text-right">{h(x.plannedHours)}{x.unestimated > 0 && <span className="block text-[11px] text-muted">{x.unestimated} without estimate</span>}</td>
      <td className="pr-4 text-right font-medium">{h(x.loggedHours)}{x.pendingHours > 0 && <span className="block text-[11px] font-normal text-muted">{h(x.pendingHours)} awaiting approval</span>}</td>
      <td className="pr-4 text-right">{h(x.clientHours)}</td>
      <td className="pr-4 text-right">{h(x.internalHours)}</td>
      <td className="pr-4">
        <div className="flex w-40 items-center gap-2">
          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-hover" role="progressbar" aria-label={`${x.name}: logged against working hours`} aria-valuenow={u ?? 0} aria-valuemin={0} aria-valuemax={100}>
            <div className={`h-full rounded-full ${bar}`} style={{ width: `${Math.min(100, u ?? 0)}%` }} />
          </div>
          <span className="w-10 text-right text-xs">{pct(u)}</span>
        </div>
      </td>
    </tr>
  );
}
