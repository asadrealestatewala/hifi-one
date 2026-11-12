import Link from "next/link";
import { requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";
import { dateInZone, fmtMinutes } from "@/lib/hr-rules";
import { SCORE, monthlyScorecards, type ScoreParts } from "@/lib/scorecards";
import { getCalendar } from "@/lib/working-calendar";
import { Badge, Empty, PageHeader, Stat } from "@/components/ui";
import ScoreCell from "@/components/ScoreCell";

export const dynamic = "force-dynamic";

const monthLabel = (m: string) => new Date(`${m}-01T00:00:00Z`).toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
const shift = (m: string, n: number) => { const d = new Date(`${m}-01T00:00:00Z`); d.setUTCMonth(d.getUTCMonth() + n); return d.toISOString().slice(0, 7); };
const weekday = (s: string) => new Date(`${s}T00:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });

// The same numbers HR sees, shown to the person they are about. HR (attendance.view_all) can open anyone's with ?user=.
export default async function MyScorecard({ searchParams }: { searchParams: Promise<{ month?: string; user?: string }> }) {
  const user = await requirePermission("self.attendance");
  const sp = await searchParams;
  const org = user.organizationId;
  const canSeeAll = user.permissions.has("attendance.view_all");
  const subjectId = sp.user && canSeeAll ? sp.user : user.id;
  const subject = subjectId === user.id ? { id: user.id, name: user.name } : await db.user.findFirst({ where: { id: subjectId, organizationId: org }, select: { id: true, name: true } });
  const profile = await db.companyProfile.findFirst({ where: { organizationId: org, isDefault: true }, select: { timezone: true } });
  const cal = await getCalendar(db, org);
  const thisMonth = dateInZone(new Date(), profile?.timezone ?? "UTC").slice(0, 7);
  const month = sp.month && /^\d{4}-(0[1-9]|1[0-2])$/.test(sp.month) && sp.month <= thisMonth ? sp.month : thisMonth;
  const [summary, days] = subject ? await Promise.all([
    monthlyScorecards(db, { organizationId: org, month, userId: subject.id }).then((r) => r[0] ?? null),
    db.dayScorecard.findMany({ where: { organizationId: org, userId: subject.id, workDate: { startsWith: month } }, orderBy: { workDate: "desc" } }),
  ]) : [null, []];
  const own = subject?.id === user.id;
  const base = own ? "/me/scorecard" : `/me/scorecard?user=${subject?.id}&`;
  const href = (m: string) => (own ? `/me/scorecard?month=${m}` : `${base}month=${m}`);
  return (
    <div className="space-y-5 max-w-5xl">
      <PageHeader title={own ? "My scorecard" : `${subject?.name ?? "Unknown"}: scorecard`} subtitle={own ? "What the end-of-day report records about your days, and how it adds up this month. Nothing here is hidden from you." : "The same view this person sees."} actions={
        <form method="get" action="/me/scorecard" className="flex items-center gap-2 text-sm">
          {!own && subject && <input type="hidden" name="user" value={subject.id} />}
          <Link href={href(shift(month, -1))} className="btn-ghost" aria-label="Previous month">‹</Link>
          <input type="month" name="month" defaultValue={month} max={thisMonth} className="input !w-auto" /><button className="btn-ghost">Go</button>
          {month < thisMonth && <Link href={href(shift(month, 1))} className="btn-ghost" aria-label="Next month">›</Link>}
        </form>
      } />
      {!subject ? <Empty title="No such person" /> : (<>
        <p className="text-sm text-muted">{monthLabel(month)}{canSeeAll && <> · <Link href={`/hr/scorecards?month=${month}`} className="underline">All scorecards</Link></>}</p>
        {summary && (
          <div className="grid gap-3 sm:grid-cols-5">
            <Stat label="Average score" value={summary.avgScore} hint="out of 100" />
            <Stat label="Present" value={`${summary.present} / ${summary.days}`} hint={summary.avgMinutes ? `avg ${fmtMinutes(summary.avgMinutes)}` : undefined} />
            <Stat label="Late days" value={summary.lateDays} />
            <Stat label="Daily reports" value={`${summary.reportsSent} / ${summary.days}`} hint={summary.avgRating ? `avg rating ${summary.avgRating}` : "no ratings yet"} />
            <Stat label={summary.target > 0 ? "Sales activity" : "Tasks done"} value={summary.target > 0 ? `${summary.activity} / ${summary.target}` : summary.tasksDone} hint={summary.target > 0 ? `${Math.round((summary.activity / summary.target) * 100)}% of target` : summary.hoursLogged ? `${summary.hoursLogged} h logged` : undefined} />
          </div>
        )}
        {days.length === 0 ? <Empty title="Nothing recorded for this month yet">The end-of-day report is written at {cal.workEnd} on each working day.</Empty> : (
          <div className="card overflow-x-auto p-0">
            <table className="w-full text-sm">
              <thead><tr className="text-left text-xs text-muted"><th className="px-4 py-2">Day</th><th className="px-2 py-2">In / out</th><th className="px-2 py-2">Worked</th><th className="px-2 py-2">Tasks</th><th className="px-2 py-2">Sales activity</th><th className="px-2 py-2">Daily report</th><th className="px-4 py-2 text-right">Score</th></tr></thead>
              <tbody className="divide-y divide-border">
                {days.map((r) => (
                  <tr key={r.id} className={r.expected ? "" : "text-muted"}>
                    <td className="px-4 py-2 whitespace-nowrap"><Link href={`/me/report?date=${r.workDate}`} className="hover:underline">{weekday(r.workDate)}</Link>{!r.expected && <Badge>not expected</Badge>}</td>
                    <td className="px-2 py-2 whitespace-nowrap">{r.clockIn ? <>{r.clockIn}{r.lateMinutes > 0 && <span className="text-brand"> (+{r.lateMinutes}m)</span>} / {r.clockOut ?? "open"}</> : "—"}</td>
                    <td className="px-2 py-2 whitespace-nowrap">{r.attendanceMinutes ? fmtMinutes(r.attendanceMinutes) : "—"}</td>
                    <td className="px-2 py-2 whitespace-nowrap">{r.tasksDone} done{r.tasksOverdue > 0 && <span className="text-brand"> · {r.tasksOverdue} overdue</span>}</td>
                    <td className="px-2 py-2 whitespace-nowrap">{r.target ? <span className={r.activity >= r.target ? "text-success" : "text-brand"}>{r.activity} / {r.target}</span> : "—"}</td>
                    <td className="px-2 py-2">{r.reportStatus === "SENT" ? <Badge tone="success">sent{r.rating ? ` · ${r.rating}/5` : ""}</Badge> : r.reportStatus === "LATE" ? <Badge tone="warning">late{r.rating ? ` · ${r.rating}/5` : ""}</Badge> : r.expected ? <Badge tone="danger">missing</Badge> : null}</td>
                    <td className="px-4 py-2 text-right">{r.expected ? <ScoreCell score={r.score} parts={r.scoreParts as ScoreParts | null} /> : null}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="text-xs text-muted">Score out of 100: attendance {SCORE.attendance}, punctuality {SCORE.punctuality}, daily report {SCORE.report} (half if late), output {SCORE.output} (sales agents: activity against the daily target; everyone else: the manager&apos;s rating of the daily report, half when the report is in but not rated yet). Office hours {cal.workStart} to {cal.workEnd}, {cal.graceMinutes} minutes grace, from the working calendar.</p>
      </>)}
    </div>
  );
}
