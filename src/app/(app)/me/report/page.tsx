import Link from "next/link";
import { requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";
import { MAX_DAYS_BACK, dayBounds, myRecentDays } from "@/lib/daily-reports";
import { dateInZone, fmtMinutes, isDateString, workedMinutes } from "@/lib/hr-rules";
import { getWorkingContext } from "@/lib/working-calendar";
import { Badge, Notice, PageHeader, Stat } from "@/components/ui";
import SubmitButton from "@/components/ui/SubmitButton";
import { submitDailyReportAction } from "./actions";

export const dynamic = "force-dynamic";

const addDays = (s: string, n: number) => new Date(Date.parse(`${s}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const weekday = (s: string) => new Date(`${s}T00:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });

// The employee's end-of-day report: what was done, what got in the way, what comes next. Beside it, what the system
// already knows about the day (attendance and tasks), so the report is about the work, not about the numbers.
export default async function MyDailyReport({ searchParams }: { searchParams: Promise<{ date?: string; error?: string; msg?: string }> }) {
  const user = await requirePermission("self.attendance");
  const sp = await searchParams;
  const profile = await db.companyProfile.findFirst({ where: { organizationId: user.organizationId, isDefault: true }, select: { timezone: true } });
  const tz = profile?.timezone ?? "UTC";
  const today = dateInZone(new Date(), tz);
  const earliest = addDays(today, -MAX_DAYS_BACK);
  const date = sp.date && isDateString(sp.date) && sp.date <= today && sp.date >= earliest ? sp.date : today;
  const bounds = dayBounds(date, tz);
  const work = await getWorkingContext(db, user.organizationId, addDays(today, -30), today);
  const todayHoliday = work.holidays.find((h) => h.date === date) ?? null;
  const [report, days, attendance, tasksDone, hasProfile] = await Promise.all([
    db.dailyReport.findUnique({ where: { userId_workDate: { userId: user.id, workDate: date } } }),
    myRecentDays(db, { organizationId: user.organizationId, userId: user.id, today, weekend: work.calendar.weekendDays, holidays: work.holidayDates }),
    db.attendanceRecord.findFirst({ where: { userId: user.id, workDate: date }, include: { breaks: true } }),
    db.task.findMany({ where: { assigneeId: user.id, status: "DONE", completedAt: { gte: bounds.gte, lt: bounds.lt } }, select: { id: true, title: true, projectId: true, project: { select: { name: true } } }, take: 20 }),
    db.employeeProfile.findUnique({ where: { userId: user.id }, select: { id: true } }),
  ]);
  const worked = attendance ? workedMinutes(attendance, attendance.breaks) : null;
  const locked = Boolean(report?.reviewedAt);
  const missed = days.filter((d) => d.expected && !d.report && d.workDate !== today).length;
  const covered = days.filter((d) => d.expected && d.report).length;
  const expectedDays = days.filter((d) => d.expected).length;
  return (
    <div className="space-y-5 max-w-4xl">
      <PageHeader title="My daily report" subtitle={`A short note at the end of each working day, for your manager and HR. Today in ${tz}: ${today}.`} actions={
        <form method="get" action="/me/report" className="flex items-center gap-2 text-sm">
          <label htmlFor="pick-date" className="text-muted">Day</label>
          <input id="pick-date" type="date" name="date" defaultValue={date} min={earliest} max={today} className="input !w-auto" />
          <button className="btn-ghost">Go</button>
        </form>
      } />
      {sp.error && <Notice kind="error">{sp.error}</Notice>}
      {todayHoliday && <Notice kind="ok">{todayHoliday.name} &mdash; a public holiday, so no report is expected for {date}.</Notice>}
      {sp.msg && <Notice kind="ok">{sp.msg}</Notice>}
      {!hasProfile && <Notice kind="error">You do not have an HR profile yet, so your reports will not appear on HR&apos;s list. Ask HR to create one.</Notice>}
      <div className="grid gap-3 sm:grid-cols-3">
        <Stat label="Attendance today" value={worked ? fmtMinutes(worked.worked) : "—"} hint={attendance ? (attendance.clockOut ? "clocked out" : "still clocked in") : "no clock-in recorded"} href="/me/attendance" />
        <Stat label={`Tasks finished ${date === today ? "today" : "that day"}`} value={tasksDone.length} href="/me/tasks?show=done" />
        <Stat label="Last 14 days" value={`${covered} of ${expectedDays}`} hint={missed ? `${missed} working day${missed === 1 ? "" : "s"} missed` : "every working day covered"} />
      </div>

      <form action={submitDailyReportAction} className="card space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-semibold">{date === today ? "Today" : weekday(date)} {report && <Badge tone={report.reviewedAt ? "success" : "primary"}>{report.reviewedAt ? "reviewed" : report.late ? "sent late" : "sent"}</Badge>}</h2>
          {date !== today && <Link href="/me/report" className="text-sm underline">Back to today</Link>}
        </div>
        <input type="hidden" name="workDate" value={date} />
        {tasksDone.length > 0 && (
          <p className="text-sm text-muted">Finished: {tasksDone.map((t, i) => <span key={t.id}>{i > 0 && ", "}<Link href={`/projects/${t.projectId}?task=${t.id}`} className="underline">{t.title}</Link></span>)}.</p>
        )}
        <div><label className="label" htmlFor="summary">What did you work on?</label>
          <textarea id="summary" name="summary" required minLength={10} rows={4} className="input" placeholder="What you did, for which client or project, and what got finished." defaultValue={report?.summary ?? ""} disabled={locked} /></div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div><label className="label" htmlFor="blockers">Anything blocking you? (optional)</label>
            <textarea id="blockers" name="blockers" rows={2} className="input" placeholder="Waiting on a client, access, a decision…" defaultValue={report?.blockers ?? ""} disabled={locked} /></div>
          <div><label className="label" htmlFor="plan">Plan for the next working day (optional)</label>
            <textarea id="plan" name="plan" rows={2} className="input" defaultValue={report?.plan ?? ""} disabled={locked} /></div>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <div><label className="label" htmlFor="hoursWorked">Hours you worked (optional)</label>
            <input id="hoursWorked" name="hoursWorked" type="number" step="0.5" min="0" max="24" className="input !w-28" defaultValue={report?.hoursWorked?.toString() ?? (worked && worked.worked > 0 ? (Math.round(worked.worked / 30) / 2).toString() : "")} disabled={locked} />
            {worked && worked.worked > 0 && <p className="text-xs text-muted">Attendance says {fmtMinutes(worked.worked)}.</p>}</div>
          {locked ? <p className="text-sm text-muted">Reviewed, so it can no longer be edited.</p> : <SubmitButton pendingText="Saving…">{report ? "Update report" : "Send report"}</SubmitButton>}
        </div>
        {report?.reviewedAt && (
          <div className="rounded-lg bg-hover px-3 py-2 text-sm">
            <p className="font-medium">Manager&apos;s note{report.rating ? ` · rated ${report.rating} of 5` : ""}</p>
            <p className="text-muted">{report.reviewNote ?? "Acknowledged."}</p>
          </div>
        )}
      </form>

      <section className="card space-y-2">
        <h2 className="font-semibold">Last 14 days</h2>
        <ul className="divide-y divide-border text-sm">
          {days.map((d) => (
            <li key={d.workDate} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <Link href={`/me/report?date=${d.workDate}`} className={`hover:underline ${d.workDate === date ? "font-semibold" : ""}`}>{weekday(d.workDate)}</Link>
              <span className="flex items-center gap-2">
                {d.report?.rating && <span className="text-xs text-muted">{d.report.rating}/5</span>}
                {d.report ? <Badge tone={d.report.reviewedAt ? "success" : "primary"}>{d.report.reviewedAt ? "reviewed" : d.report.late ? "sent late" : "sent"}</Badge>
                  : !d.expected ? <Badge>not a working day</Badge>
                  : d.workDate === today ? <Badge tone="warning">due today</Badge>
                  : d.workDate >= earliest ? <Badge tone="danger">missed · write it</Badge> : <Badge tone="danger">missed</Badge>}
              </span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
