import Link from "next/link";
import { requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";
import { dateInZone, fmtMinutes, isDateString } from "@/lib/hr-rules";
import { SCORE, dayRowsFor, type ScoreParts } from "@/lib/scorecards";
import { getWorkingContext } from "@/lib/working-calendar";
import ScoreCell from "@/components/ScoreCell";
import { Avatar, Badge, Empty, ExportLink, Notice, PageHeader, Stat } from "@/components/ui";
import ScreenTabs from "@/components/shell/ScreenTabs";
import SubmitButton from "@/components/ui/SubmitButton";
import { generateEndOfDayAction } from "./actions";

export const dynamic = "force-dynamic";

const addDays = (s: string, n: number) => new Date(Date.parse(`${s}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const weekday = (s: string) => new Date(`${s}T00:00:00Z`).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });

// The system's end-of-day report for one day: generated at office close, regenerated on demand. HR and the super admin read it.
export default async function EndOfDayReport({ searchParams }: { searchParams: Promise<{ date?: string; error?: string; msg?: string }> }) {
  const user = await requirePermission("attendance.view_all");
  const sp = await searchParams;
  const org = user.organizationId;
  const profile = await db.companyProfile.findFirst({ where: { organizationId: org, isDefault: true }, select: { timezone: true } });
  const tz = profile?.timezone ?? "UTC";
  const today = dateInZone(new Date(), tz);
  const date = sp.date && isDateString(sp.date) && sp.date <= today ? sp.date : today;
  const work = await getWorkingContext(db, org, date, date);
  const cal = work.calendar;
  const holiday = work.holidays.find((h) => h.date === date) ?? null;
  const rows = await dayRowsFor(db, org, date);
  const names = new Map((await db.user.findMany({ where: { id: { in: rows.map((r) => r.userId) } }, select: { id: true, name: true } })).map((u) => [u.id, u.name]));
  const expected = rows.filter((r) => r.expected);
  const reported = expected.filter((r) => r.reportStatus !== "MISSING").length;
  const absent = expected.filter((r) => r.attendanceMinutes === 0).length;
  const agents = expected.filter((r) => r.target);
  const belowTarget = agents.filter((r) => r.activity < (r.target ?? 0)).length;
  const avg = expected.length ? Math.round(expected.reduce((s, r) => s + r.score, 0) / expected.length) : 0;
  const generatedAt = rows[0]?.generatedAt;
  return (
    <div className="space-y-5">
      <PageHeader tabs={<ScreenTabs group="hr-activity" current="/hr/reports/eod" />} title="Staff activity" subtitle={`Generated automatically at ${cal.workEnd} ${tz} for everyone expected to work. Office hours ${cal.workStart} to ${cal.workEnd} with a ${cal.lunchMinutes} minute lunch, from the working calendar.`} actions={
        <form method="get" action="/hr/reports/eod" className="flex items-center gap-2 text-sm">
          <Link href={`/hr/reports/eod?date=${addDays(date, -1)}`} className="btn-ghost" aria-label="Previous day">‹</Link>
          <input type="date" name="date" defaultValue={date} max={today} className="input !w-auto" /><button className="btn-ghost">Go</button>
          {date < today && <Link href={`/hr/reports/eod?date=${addDays(date, 1)}`} className="btn-ghost" aria-label="Next day">›</Link>}
        </form>
      } />
      {sp.error && <Notice kind="error">{sp.error}</Notice>}
      {holiday && <Notice kind="ok">{holiday.name} &mdash; a public holiday on the working calendar. Nobody was expected to work, so no day rows are written.</Notice>}
      {sp.msg && <Notice kind="ok">{sp.msg}</Notice>}
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-muted">
        <span>{weekday(date)}{generatedAt ? ` · generated ${generatedAt.toLocaleString("en-GB", { timeZone: tz, dateStyle: "medium", timeStyle: "short" })}` : " · not generated yet"}</span>
        <span className="flex items-center gap-2">
          <Link href={`/hr/reports?date=${date}`} className="underline">Daily reports</Link>
          <Link href={`/hr/scorecards?month=${date.slice(0, 7)}`} className="underline">Month scorecards</Link>
          {rows.length > 0 && <ExportLink href={`/hr/reports/eod/export?date=${date}`} />}
          <form action={generateEndOfDayAction}><input type="hidden" name="date" value={date} /><SubmitButton className="btn-ghost" pendingText="Generating…">{rows.length ? "Regenerate now" : "Generate now"}</SubmitButton></form>
        </span>
      </div>
      {rows.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-5">
          <Stat label="Expected" value={expected.length} hint={`${rows.length - expected.length} not expected (leave or not yet joined)`} />
          <Stat label="Daily reports" value={`${reported} / ${expected.length}`} />
          <Stat label="No attendance" value={absent} />
          <Stat label="Agents below target" value={agents.length ? `${belowTarget} / ${agents.length}` : "—"} />
          <Stat label="Average score" value={avg} hint="out of 100" />
        </div>
      )}
      {rows.length === 0 ? (
        <Empty title="No end-of-day report for this day">{date === today ? `It is written automatically at ${cal.workEnd}. You can generate a preview now; it is replaced at close.` : "Nothing was generated for this day. Generate it now from the facts on record."}</Empty>
      ) : (
        <div className="card overflow-x-auto p-0">
          <table className="w-full text-sm">
            <thead><tr className="text-left text-xs text-muted"><th className="px-4 py-2">Employee</th><th className="px-2 py-2">In / out</th><th className="px-2 py-2">Clocked</th><th className="px-2 py-2">Tasks</th><th className="px-2 py-2">Hours on projects</th><th className="px-2 py-2">Sales activity</th><th className="px-2 py-2">Daily report</th><th className="px-4 py-2 text-right">Score</th></tr></thead>
            <tbody className="divide-y divide-border">
              {rows.map((r) => (
                <tr key={r.id} className={r.expected ? "" : "text-muted"}>
                  <td className="px-4 py-2"><span className="flex items-center gap-2"><Avatar name={names.get(r.userId) ?? "?"} userId={r.userId} size={26} /><Link href={`/me/scorecard?user=${r.userId}&month=${date.slice(0, 7)}`} className="font-medium hover:underline">{names.get(r.userId) ?? "Unknown"}</Link>{!r.expected && <Badge>not expected</Badge>}</span></td>
                  <td className="px-2 py-2 whitespace-nowrap">{r.clockIn ? <>{r.clockIn}{r.lateMinutes > 0 && <span className="text-brand"> (+{r.lateMinutes}m)</span>} / {r.clockOut ?? <span className="text-muted">open</span>}</> : <span className="text-muted">—</span>}</td>
                  <td className="px-2 py-2 whitespace-nowrap">{r.attendanceMinutes ? fmtMinutes(r.attendanceMinutes) : <span className="text-muted">—</span>}</td>
                  <td className="px-2 py-2 whitespace-nowrap">{r.tasksDone} done{r.tasksOverdue > 0 && <span className="text-brand"> · {r.tasksOverdue} overdue</span>}</td>
                  <td className="px-2 py-2">{Number(r.hoursLogged) ? Number(r.hoursLogged).toFixed(1) : <span className="text-muted">—</span>}</td>
                  <td className="px-2 py-2 whitespace-nowrap">{r.target ? <><span className={r.activity >= r.target ? "text-success" : "text-brand"}>{r.activity} / {r.target}</span> <span className="text-xs text-muted">{r.salesKind === "FIELD" ? `visits${r.demosRequested ? `, ${r.demosRequested} demo${r.demosRequested === 1 ? "" : "s"}` : ""}` : `${r.prospectsAdded} added, ${r.outreach} calls`}</span></> : <span className="text-muted">—</span>}</td>
                  <td className="px-2 py-2 whitespace-nowrap">{r.reportStatus === "SENT" ? <Badge tone="success">sent{r.rating ? ` · ${r.rating}/5` : ""}</Badge> : r.reportStatus === "LATE" ? <Badge tone="warning">late{r.rating ? ` · ${r.rating}/5` : ""}</Badge> : r.expected ? <Badge tone="danger">missing</Badge> : null}</td>
                  <td className="px-4 py-2 text-right">{r.expected ? <ScoreCell score={r.score} parts={r.scoreParts as ScoreParts | null} /> : null}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-xs text-muted">Score out of 100: attendance {SCORE.attendance} (a full {cal.workStart} to {cal.workEnd} day less lunch), punctuality {SCORE.punctuality} (minus 2 per 10 minutes after {cal.workStart} plus {cal.graceMinutes} minutes grace), daily report {SCORE.report} (half if late), output {SCORE.output} (sales agents: activity against the daily target; everyone else: the manager&apos;s rating of the daily report, half when the report is in but not rated yet).</p>
    </div>
  );
}
