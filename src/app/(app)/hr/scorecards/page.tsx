import Link from "next/link";
import { requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";
import { dateInZone, fmtMinutes } from "@/lib/hr-rules";
import { monthlyScorecards } from "@/lib/scorecards";
import { Avatar, Badge, Empty, ExportLink, PageHeader, Stat } from "@/components/ui";
import ScreenTabs from "@/components/shell/ScreenTabs";

export const dynamic = "force-dynamic";

const monthLabel = (m: string) => new Date(`${m}-01T00:00:00Z`).toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
const shift = (m: string, n: number) => { const d = new Date(`${m}-01T00:00:00Z`); d.setUTCMonth(d.getUTCMonth() + n); return d.toISOString().slice(0, 7); };
const tone = (score: number): "success" | "warning" | "danger" => (score >= 80 ? "success" : score >= 50 ? "warning" : "danger");

// Monthly scorecards: the end-of-day rows added up per employee. HR and the super admin review; each person sees their own on My Scorecard.
export default async function Scorecards({ searchParams }: { searchParams: Promise<{ month?: string }> }) {
  const user = await requirePermission("attendance.view_all");
  const sp = await searchParams;
  const org = user.organizationId;
  const profile = await db.companyProfile.findFirst({ where: { organizationId: org, isDefault: true }, select: { timezone: true } });
  const thisMonth = dateInZone(new Date(), profile?.timezone ?? "UTC").slice(0, 7);
  const month = sp.month && /^\d{4}-(0[1-9]|1[0-2])$/.test(sp.month) && sp.month <= thisMonth ? sp.month : thisMonth;
  const rows = await monthlyScorecards(db, { organizationId: org, month });
  const avg = rows.length ? Math.round(rows.reduce((s, r) => s + r.avgScore, 0) / rows.length) : 0;
  const days = Math.max(0, ...rows.map((r) => r.days));
  const reportRate = rows.reduce((s, r) => s + r.days, 0) ? Math.round((rows.reduce((s, r) => s + r.reportsSent, 0) / rows.reduce((s, r) => s + r.days, 0)) * 100) : 0;
  const agents = rows.filter((r) => r.target > 0);
  const targetRate = agents.length ? Math.round((agents.reduce((s, r) => s + r.activity, 0) / agents.reduce((s, r) => s + r.target, 0)) * 100) : null;
  return (
    <div className="space-y-5">
      <PageHeader tabs={<ScreenTabs group="hr-activity" current="/hr/scorecards" />} title="Staff activity" subtitle="Each employee's month, added up from the end-of-day reports: attendance, punctuality, daily reports, tasks, hours and sales targets." actions={
        <form method="get" action="/hr/scorecards" className="flex items-center gap-2 text-sm">
          <Link href={`/hr/scorecards?month=${shift(month, -1)}`} className="btn-ghost" aria-label="Previous month">‹</Link>
          <input type="month" name="month" defaultValue={month} max={thisMonth} className="input !w-auto" /><button className="btn-ghost">Go</button>
          {month < thisMonth && <Link href={`/hr/scorecards?month=${shift(month, 1)}`} className="btn-ghost" aria-label="Next month">›</Link>}
        </form>
      } />
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-muted">
        <span>{monthLabel(month)} · {days} working day{days === 1 ? "" : "s"} recorded so far</span>
        {rows.length > 0 && <ExportLink href={`/hr/scorecards/export?month=${month}`} />}
      </div>
      {rows.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-4">
          <Stat label="People" value={rows.length} />
          <Stat label="Average score" value={avg} hint="out of 100" />
          <Stat label="Daily reports sent" value={`${reportRate}%`} hint="of expected days" />
          <Stat label="Sales targets met" value={targetRate === null ? "—" : `${targetRate}%`} hint={agents.length ? `${agents.length} agent${agents.length === 1 ? "" : "s"}` : "no agents with targets"} />
        </div>
      )}
      {rows.length === 0 ? <Empty title="No scorecards for this month yet">They build up from the end-of-day report, written each working day at office close.</Empty> : (
        <div className="card overflow-x-auto p-0">
          <table className="w-full text-sm">
            <thead><tr className="text-left text-xs text-muted"><th className="px-4 py-2">Employee</th><th className="px-2 py-2">Present</th><th className="px-2 py-2">Avg day</th><th className="px-2 py-2">Late days</th><th className="px-2 py-2">Daily reports</th><th className="px-2 py-2">Avg rating</th><th className="px-2 py-2">Tasks done</th><th className="px-2 py-2">Hours on projects</th><th className="px-2 py-2">Sales activity</th><th className="px-4 py-2 text-right">Avg score</th></tr></thead>
            <tbody className="divide-y divide-border">
              {rows.map((r) => (
                <tr key={r.userId}>
                  <td className="px-4 py-2"><Link href={`/me/scorecard?user=${r.userId}&month=${month}`} className="flex items-center gap-2 font-medium hover:underline"><Avatar name={r.name} userId={r.userId} size={26} />{r.name}</Link></td>
                  <td className="px-2 py-2 whitespace-nowrap">{r.present} / {r.days}</td>
                  <td className="px-2 py-2 whitespace-nowrap">{r.avgMinutes ? fmtMinutes(r.avgMinutes) : "—"}</td>
                  <td className="px-2 py-2">{r.lateDays || <span className="text-muted">0</span>}</td>
                  <td className="px-2 py-2 whitespace-nowrap">{r.reportsSent} / {r.days}{r.reportsLate > 0 && <span className="text-xs text-muted"> ({r.reportsLate} late)</span>}</td>
                  <td className="px-2 py-2">{r.avgRating ?? <span className="text-muted">—</span>}</td>
                  <td className="px-2 py-2">{r.tasksDone}</td>
                  <td className="px-2 py-2">{r.hoursLogged || <span className="text-muted">—</span>}</td>
                  <td className="px-2 py-2 whitespace-nowrap">{r.target > 0 ? <span className={r.activity >= r.target ? "text-success" : "text-brand"}>{r.activity} / {r.target} <span className="text-xs text-muted">({Math.round((r.activity / r.target) * 100)}%)</span></span> : <span className="text-muted">—</span>}</td>
                  <td className="px-4 py-2 text-right"><Badge tone={tone(r.avgScore)}>{r.avgScore}</Badge></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
