import Link from "next/link";
import { requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";
import { dateInZone, fmtMinutes, isDateString } from "@/lib/hr-rules";
import { STATE_LABEL, STATE_SHORT, attendanceReport, type DayState } from "@/lib/attendance-report";
import { getWorkingContext } from "@/lib/working-calendar";
import { Avatar, Badge, DownloadButtons, Empty, PageHeader, Stat } from "@/components/ui";
import ScreenTabs from "@/components/shell/ScreenTabs";

export const dynamic = "force-dynamic";

const TONE: Record<DayState, "success" | "warning" | "danger" | "primary" | "neutral"> = {
  PRESENT: "success", LATE: "warning", ABSENT: "danger", LEAVE: "primary", OUT: "primary", HOLIDAY: "neutral", OFF: "neutral", UPCOMING: "neutral", NOT_JOINED: "neutral",
};
const CELL: Record<DayState, string> = {
  PRESENT: "bg-success/15 text-success", LATE: "bg-warning/20 text-warning", ABSENT: "bg-danger/15 text-danger", LEAVE: "bg-primary/10 text-primary", OUT: "bg-primary/10 text-primary",
  HOLIDAY: "bg-hover text-muted", OFF: "text-muted", UPCOMING: "", NOT_JOINED: "",
};
const longDate = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
const monthLabel = (m: string) => new Date(`${m}-01T12:00:00Z`).toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
const shiftDay = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const shiftMonth = (m: string, n: number) => { const d = new Date(`${m}-01T00:00:00Z`); d.setUTCMonth(d.getUTCMonth() + n); return d.toISOString().slice(0, 7); };
const lastDay = (m: string) => { const d = new Date(`${m}-01T00:00:00Z`); d.setUTCMonth(d.getUTCMonth() + 1); d.setUTCDate(0); return d.toISOString().slice(0, 10); };

// Attendance report (HR's Required Changes, items 12, 13 and 15): a day, or a month, per person: Present, Late, Absent,
// On leave, Out for work, Holiday, following the Working calendar, with Excel, CSV and PDF downloads of the same figures.
export default async function AttendanceReportPage({ searchParams }: { searchParams: Promise<{ view?: string; date?: string; month?: string; dept?: string }> }) {
  const user = await requirePermission("attendance.view_all");
  const sp = await searchParams;
  const org = user.organizationId;
  const work0 = await getWorkingContext(db, org);
  const today = dateInZone(new Date(), work0.calendar.timezone);
  const monthly = sp.view === "month";
  const date = sp.date && isDateString(sp.date) && sp.date <= today ? sp.date : today;
  const month = sp.month && /^\d{4}-(0[1-9]|1[0-2])$/.test(sp.month) && sp.month <= today.slice(0, 7) ? sp.month : today.slice(0, 7);
  const from = monthly ? `${month}-01` : date;
  const to = monthly ? (lastDay(month) < today ? lastDay(month) : today) : date;
  const departments = await db.department.findMany({ where: { organizationId: org }, select: { id: true, name: true }, orderBy: { name: "asc" } });
  const dept = departments.some((d) => d.id === sp.dept) ? sp.dept : undefined;
  const work = await getWorkingContext(db, org, from, to);
  const r = await attendanceReport(db, { organizationId: org, from, to, calendar: work.calendar, holidays: work.holidays, departmentId: dept });
  const q = (extra: Record<string, string | undefined>) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries({ view: monthly ? "month" : undefined, date: monthly ? undefined : date, month: monthly ? month : undefined, dept, ...extra })) if (v) p.set(k, v);
    return `/hr/attendance/report${p.size ? `?${p}` : ""}`;
  };
  const day0 = r.dates[0];
  const holiday = !monthly ? work.holidays.find((h) => h.date === day0)?.name : undefined;

  return (
    <div className="space-y-5">
      <PageHeader tabs={<ScreenTabs group="hr-activity" current="/hr/attendance/report" />} title="Staff activity" subtitle="Who was present, late, absent, on leave or out for work, by day or by month, following the Working calendar." />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <nav aria-label="Report period" className="flex flex-wrap items-center gap-2">
          <span className="inline-flex rounded-lg border border-border p-0.5 text-sm">
            <Link href={q({ view: undefined, month: undefined, date })} className={`rounded-md px-3 py-1 ${!monthly ? "bg-primary text-white" : "text-muted hover:text-foreground"}`} aria-current={!monthly ? "page" : undefined}>Day</Link>
            <Link href={q({ view: "month", date: undefined, month })} className={`rounded-md px-3 py-1 ${monthly ? "bg-primary text-white" : "text-muted hover:text-foreground"}`} aria-current={monthly ? "page" : undefined}>Month</Link>
          </span>
          {monthly ? (
            <>
              <Link href={q({ month: shiftMonth(month, -1) })} className="btn-ghost" aria-label="Previous month">‹</Link>
              <form className="flex items-center gap-2"><input type="hidden" name="view" value="month" />{dept && <input type="hidden" name="dept" value={dept} />}<label className="sr-only" htmlFor="ar-month">Month</label><input id="ar-month" type="month" name="month" defaultValue={month} max={today.slice(0, 7)} className="input !w-auto" /><button className="btn-ghost">Show</button></form>
              {month < today.slice(0, 7) && <Link href={q({ month: shiftMonth(month, 1) })} className="btn-ghost" aria-label="Next month">›</Link>}
            </>
          ) : (
            <>
              <Link href={q({ date: shiftDay(date, -1) })} className="btn-ghost" aria-label="Previous day">‹</Link>
              <form className="flex items-center gap-2">{dept && <input type="hidden" name="dept" value={dept} />}<label className="sr-only" htmlFor="ar-date">Date</label><input id="ar-date" type="date" name="date" defaultValue={date} max={today} className="input !w-auto" /><button className="btn-ghost">Show</button></form>
              {date < today && <Link href={q({ date: shiftDay(date, 1) })} className="btn-ghost" aria-label="Next day">›</Link>}
            </>
          )}
          {departments.length > 0 && (
            <form className="flex items-center gap-2">
              {monthly ? <><input type="hidden" name="view" value="month" /><input type="hidden" name="month" value={month} /></> : <input type="hidden" name="date" value={date} />}
              <label className="sr-only" htmlFor="ar-dept">Department</label>
              <select id="ar-dept" name="dept" defaultValue={dept ?? ""} className="input !w-auto"><option value="">All departments</option>{departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select>
              <button className="btn-ghost">Filter</button>
            </form>
          )}
        </nav>
        <DownloadButtons report="attendance" params={{ from, to, dept }} />
      </div>
      <h2 className="font-semibold">{monthly ? `${monthLabel(month)}${to < lastDay(month) ? ` so far (to ${longDate(to)})` : ""}` : longDate(date)}{holiday ? ` · ${holiday}` : ""}</h2>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <Stat label="Present" value={r.totals.present} hint={`of ${r.totals.expected} working ${monthly ? "person-days" : "people"}`} />
        <Stat label="Late" value={r.totals.late} hint={r.totals.late ? `${r.totals.lateMinutes} minutes in all` : "everyone on time"} />
        <Stat label="Absent" value={r.totals.absent} hint="no clock-in, leave or approved work out" />
        <Stat label="On leave" value={r.totals.leave} />
        <Stat label="Out for work" value={r.totals.out} hint="site visits, field work, work from home" />
      </div>
      {r.people.length === 0 ? (
        <Empty title="Nobody to report on">The report covers staff with an active HR record{dept ? " in this department" : ""}. Add them in the Staff directory.</Empty>
      ) : !monthly ? (
        <div className="card overflow-x-auto !p-0">
          <table className="w-full min-w-[720px] text-sm">
            <thead><tr className="text-left"><th className="px-4 py-2">Employee</th><th className="px-2 py-2">Status</th><th className="px-2 py-2">Clock in</th><th className="px-2 py-2">Clock out</th><th className="px-2 py-2">Late by</th><th className="px-2 py-2">Worked</th><th className="px-4 py-2">Note</th></tr></thead>
            <tbody className="divide-y divide-border">
              {r.people.map((x) => {
                const d = x.days[0];
                return (
                  <tr key={x.userId}>
                    <td className="px-4 py-2"><span className="flex items-center gap-2 font-medium"><Avatar name={x.name} userId={x.userId} size={26} />{x.name}</span>{x.department && <span className="block pl-8 text-xs text-muted">{x.department}</span>}</td>
                    <td className="px-2 py-2">{STATE_LABEL[d.state] ? <Badge tone={TONE[d.state]}>{STATE_LABEL[d.state]}</Badge> : <span className="text-xs text-muted">{d.note ?? "—"}</span>}</td>
                    <td className="px-2 py-2 tabular-nums">{d.clockIn ?? <span className="text-muted">—</span>}</td>
                    <td className="px-2 py-2 tabular-nums">{d.clockOut ?? (d.clockIn ? <span className="text-xs text-muted">still in</span> : <span className="text-muted">—</span>)}</td>
                    <td className="px-2 py-2">{d.lateMinutes ? <span className="font-medium text-warning">{d.lateMinutes} min</span> : <span className="text-muted">—</span>}</td>
                    <td className="px-2 py-2 whitespace-nowrap">{d.workedMinutes ? fmtMinutes(d.workedMinutes) : <span className="text-muted">—</span>}</td>
                    <td className="px-4 py-2 text-xs text-muted">{d.state !== "UPCOMING" ? d.note ?? "" : ""}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <>
          <div className="card overflow-x-auto !p-0">
            <table className="w-full min-w-[760px] text-sm">
              <thead><tr className="text-left"><th className="px-4 py-2">Employee</th><th className="px-2 py-2 text-right">Working days</th><th className="px-2 py-2 text-right">Present</th><th className="px-2 py-2 text-right">Late</th><th className="px-2 py-2 text-right">Absent</th><th className="px-2 py-2 text-right">On leave</th><th className="px-2 py-2 text-right">Out for work</th><th className="px-4 py-2 text-right">Worked</th></tr></thead>
              <tbody className="divide-y divide-border">
                {r.people.map((x) => (
                  <tr key={x.userId}>
                    <td className="px-4 py-2"><span className="flex items-center gap-2 font-medium"><Avatar name={x.name} userId={x.userId} size={26} />{x.name}</span></td>
                    <td className="px-2 py-2 text-right tabular-nums">{x.totals.expected}</td>
                    <td className="px-2 py-2 text-right tabular-nums">{x.totals.present}</td>
                    <td className="px-2 py-2 text-right tabular-nums">{x.totals.late ? <span className="font-medium text-warning" title={`${x.totals.lateMinutes} minutes in all`}>{x.totals.late}</span> : 0}</td>
                    <td className="px-2 py-2 text-right tabular-nums">{x.totals.absent ? <span className="font-medium text-danger">{x.totals.absent}</span> : 0}</td>
                    <td className="px-2 py-2 text-right tabular-nums">{x.totals.leave}</td>
                    <td className="px-2 py-2 text-right tabular-nums">{x.totals.out}</td>
                    <td className="px-4 py-2 text-right whitespace-nowrap">{x.totals.workedMinutes ? fmtMinutes(x.totals.workedMinutes) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <section className="card space-y-2 !p-0" aria-labelledby="by-day">
            <h2 id="by-day" className="px-4 pt-3 font-semibold">By day</h2>
            <div className="overflow-x-auto">
              <table className="text-xs">
                <thead><tr className="[&>th]:!top-auto"><th className="sticky left-0 bg-surface px-4 py-1.5 text-left">Employee</th>{r.dates.map((d) => <th key={d} className="px-1 py-1.5 text-center font-medium tabular-nums">{d.slice(8)}</th>)}</tr></thead>
                <tbody>
                  {r.people.map((x) => (
                    <tr key={x.userId} className="border-t border-border">
                      <th scope="row" className="sticky left-0 whitespace-nowrap bg-surface px-4 py-1 text-left font-medium">{x.name}</th>
                      {x.days.map((d) => (
                        <td key={d.date} className="px-0.5 py-1 text-center">
                          {STATE_SHORT[d.state] && <Link href={q({ view: undefined, month: undefined, date: d.date })} className={`inline-block min-w-7 rounded px-1 py-0.5 font-medium ${CELL[d.state]}`} title={`${d.date}: ${STATE_LABEL[d.state]}${d.lateMinutes ? `, ${d.lateMinutes} min late` : ""}${d.note ? ` (${d.note})` : ""}`}>{STATE_SHORT[d.state]}</Link>}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="px-4 pb-3 text-xs text-muted">P present, L late, A absent, LV on leave, OW out for work, H holiday, – day off. Open a day to see times.</p>
          </section>
        </>
      )}
      <p className="text-xs text-muted">Late means clocking in after {work.calendar.workStart} plus {work.calendar.graceMinutes} minutes of grace. Change office hours, working days and holidays in Settings → Working calendar.</p>
    </div>
  );
}
