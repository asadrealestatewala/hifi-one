import Link from "next/link";
import { requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";
import { dayStatus } from "@/lib/daily-reports";
import { dateInZone, fmtMinutes, isDateString } from "@/lib/hr-rules";
import { getWorkingContext } from "@/lib/working-calendar";
import { Avatar, Badge, Chips, Empty, Notice, PageHeader, Stat } from "@/components/ui";
import ScreenTabs from "@/components/shell/ScreenTabs";
import SubmitButton from "@/components/ui/SubmitButton";
import { reviewDailyReportAction } from "./actions";

export const dynamic = "force-dynamic";

const addDays = (s: string, n: number) => new Date(Date.parse(`${s}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const weekday = (s: string) => new Date(`${s}T00:00:00Z`).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });

// Who reported today and who did not, with the day's facts beside each. HR (attendance.view_all) sees everyone;
// a manager sees their direct reports. Each report can be acknowledged here with a note and a rating.
export default async function DailyReports({ searchParams }: { searchParams: Promise<{ date?: string; show?: string; dep?: string; open?: string; error?: string; msg?: string }> }) {
  const user = await requirePermission("leave.approve");
  const sp = await searchParams;
  const org = user.organizationId;
  const all = user.permissions.has("attendance.view_all");
  const profile = await db.companyProfile.findFirst({ where: { organizationId: org, isDefault: true }, select: { timezone: true } });
  const tz = profile?.timezone ?? "UTC";
  const today = dateInZone(new Date(), tz);
  const date = sp.date && isDateString(sp.date) && sp.date <= today ? sp.date : today;
  const show = sp.show === "missing" ? "missing" : sp.show === "sent" ? "sent" : sp.show === "review" ? "review" : "all";
  const work = await getWorkingContext(db, org, date, date);
  const holiday = work.holidays.find((h) => h.date === date) ?? null;
  const [rows, departments] = await Promise.all([
    dayStatus(db, { organizationId: org, workDate: date, timeZone: tz, managerId: all ? undefined : user.id, weekend: work.calendar.weekendDays, holidays: work.holidayDates }),
    db.department.findMany({ where: { organizationId: org }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
  ]);
  const depName = new Map(departments.map((d) => [d.id, d.name]));
  const scoped = sp.dep ? rows.filter((r) => r.departmentId === sp.dep) : rows;
  const expected = scoped.filter((r) => r.expected);
  const sent = expected.filter((r) => r.report);
  const missing = expected.filter((r) => !r.report);
  const toReview = scoped.filter((r) => r.report && !r.report.reviewedAt);
  const shown = show === "missing" ? missing : show === "sent" ? sent : show === "review" ? toReview : scoped;
  const href = (over: Record<string, string | undefined>) => { const p = new URLSearchParams(); for (const [k, v] of Object.entries({ date, show: show === "all" ? undefined : show, dep: sp.dep, ...over })) if (v) p.set(k, v); const t = p.toString(); return `/hr/reports${t ? `?${t}` : ""}`; };
  const returnTo = href({ open: undefined });
  const open = sp.open;
  return (
    <div className="space-y-5">
      <PageHeader tabs={<ScreenTabs group="hr-activity" current="/hr/reports" />} title="Staff activity" subtitle={all ? "Every employee's end-of-day report, and who has not sent one." : "End-of-day reports from the people who report to you."} actions={
        <form method="get" action="/hr/reports" className="flex items-center gap-2 text-sm">
          {sp.dep && <input type="hidden" name="dep" value={sp.dep} />}
          <Link href={href({ date: addDays(date, -1) })} className="btn-ghost" aria-label="Previous day">‹</Link>
          <input type="date" name="date" defaultValue={date} max={today} className="input !w-auto" />
          <button className="btn-ghost">Go</button>
          {date < today && <Link href={href({ date: addDays(date, 1) })} className="btn-ghost" aria-label="Next day">›</Link>}
        </form>
      } />
      {sp.error && <Notice kind="error">{sp.error}</Notice>}
      {holiday && <Notice kind="ok">{holiday.name} &mdash; a public holiday on the working calendar, so nobody is expected to report.</Notice>}
      {sp.msg && <Notice kind="ok">{sp.msg}</Notice>}
      <p className="text-sm text-muted">{weekday(date)}{date === today ? " (today)" : ""} · {tz}{all && <> · <Link href={`/hr/reports/eod?date=${date}`} className="underline">End-of-day report</Link></>}</p>
      <div className="grid gap-3 sm:grid-cols-4">
        <Stat label="Expected" value={expected.length} hint={`${scoped.length - expected.length} off (weekend, leave or not joined)`} />
        <Stat label="Sent" value={sent.length} href={href({ show: "sent" })} />
        <Stat label="Missing" value={missing.length} hint={date === today ? "the day is not over yet" : undefined} href={href({ show: "missing" })} />
        <Stat label="Waiting for your review" value={toReview.length} href={href({ show: "review" })} />
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Chips current={show} items={[
          { key: "all", label: "Everyone", count: scoped.length, href: href({ show: undefined }) }, { key: "sent", label: "Sent", count: sent.length, href: href({ show: "sent" }) },
          { key: "missing", label: "Missing", count: missing.length, href: href({ show: "missing" }) }, { key: "review", label: "To review", count: toReview.length, href: href({ show: "review" }) },
        ]} />
        {departments.length > 0 && (
          <form method="get" action="/hr/reports" className="text-sm"><input type="hidden" name="date" value={date} />{show !== "all" && <input type="hidden" name="show" value={show} />}
            <label className="sr-only" htmlFor="dep">Department</label>
            <select id="dep" name="dep" defaultValue={sp.dep ?? ""} className="input !w-auto"><option value="">All departments</option>{departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select>
            <button className="btn-ghost ml-1">Filter</button></form>
        )}
      </div>

      {shown.length === 0 ? (
        <Empty title={show === "missing" ? "Nobody is missing" : show === "review" ? "Nothing waiting for review" : "Nobody to show"}>
          {rows.length === 0 ? (all ? "No active employees have an HR profile yet." : "Nobody reports to you in the staff directory.") : "Change the day or the filter."}
        </Empty>
      ) : (
        <div className="card overflow-x-auto p-0">
          <table className="w-full text-sm">
            <thead><tr className="text-left text-xs text-muted"><th className="px-4 py-2">Employee</th><th className="px-2 py-2">Report</th><th className="px-2 py-2">Attendance</th><th className="px-2 py-2">Tasks done</th><th className="px-2 py-2">Visits</th><th className="px-2 py-2">Hours</th><th className="px-4 py-2 text-right">Review</th></tr></thead>
            <tbody className="divide-y divide-border">
              {shown.map((r) => {
                const isOpen = open === r.userId && r.report;
                return (
                  <tr key={r.userId} className="align-top">
                    <td className="px-4 py-2"><span className="flex items-center gap-2"><Avatar name={r.name} userId={r.userId} size={28} /><span><span className="font-medium">{r.name}</span>{r.designation && <span className="block text-xs text-muted">{r.designation}</span>}{r.departmentId && depName.get(r.departmentId) && <span className="block text-xs text-muted">{depName.get(r.departmentId)}</span>}</span></span></td>
                    <td className="px-2 py-2 max-w-md">
                      {!r.report ? (r.onLeave ? <Badge>on leave</Badge> : !r.expected ? <Badge>not expected</Badge> : date === today ? <Badge tone="warning">not yet</Badge> : <Badge tone="danger">missing</Badge>) : (
                        <div className="space-y-1">
                          <span className="flex flex-wrap items-center gap-1"><Badge tone={r.report.reviewedAt ? "success" : "primary"}>{r.report.reviewedAt ? `reviewed${r.report.rating ? ` ${r.report.rating}/5` : ""}` : r.report.late ? "sent late" : "sent"}</Badge>{r.report.blockers && <Badge tone="warning">blocked</Badge>}</span>
                          <p className={isOpen ? "" : "line-clamp-2"}>{r.report.summary}</p>
                          {isOpen && r.report.blockers && <p><span className="font-medium">Blockers:</span> {r.report.blockers}</p>}
                          {isOpen && r.report.plan && <p><span className="font-medium">Next:</span> {r.report.plan}</p>}
                          {isOpen && r.report.reviewNote && <p className="text-muted"><span className="font-medium">Note:</span> {r.report.reviewNote}</p>}
                          <Link href={href({ open: isOpen ? undefined : r.userId })} className="text-xs underline">{isOpen ? "Show less" : "Read in full"}</Link>
                        </div>
                      )}
                    </td>
                    <td className="px-2 py-2 whitespace-nowrap">{r.attendanceMinutes === null ? <span className="text-muted">—</span> : fmtMinutes(r.attendanceMinutes)}</td>
                    <td className="px-2 py-2">{r.tasksDone}</td>
                    <td className="px-2 py-2">{r.visits || <span className="text-muted">—</span>}</td>
                    <td className="px-2 py-2">{r.report?.hoursWorked?.toString() ?? <span className="text-muted">—</span>}</td>
                    <td className="px-4 py-2 text-right">
                      {r.report && !r.report.reviewedAt && r.userId !== user.id && (
                        <form action={reviewDailyReportAction} className="flex flex-wrap items-center justify-end gap-1">
                          <input type="hidden" name="reportId" value={r.report.id} /><input type="hidden" name="returnTo" value={returnTo} />
                          <label className="sr-only" htmlFor={`rating-${r.userId}`}>Rating</label>
                          <select id={`rating-${r.userId}`} name="rating" className="input !w-auto !py-1" defaultValue=""><option value="">No rating</option>{[5, 4, 3, 2, 1].map((n) => <option key={n} value={n}>{n} / 5</option>)}</select>
                          <input name="note" className="input !w-36 !py-1" placeholder="Note (optional)" maxLength={300} />
                          <SubmitButton className="btn-ghost" pendingText="Saving…">Acknowledge</SubmitButton>
                        </form>
                      )}
                    </td>
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
