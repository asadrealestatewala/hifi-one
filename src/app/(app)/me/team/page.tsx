import Link from "next/link";
import { requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";
import { dayStatus } from "@/lib/daily-reports";
import { dateInZone, fmtMinutes, isDateString } from "@/lib/hr-rules";
import { getWorkingContext } from "@/lib/working-calendar";
import { Avatar, Badge, Empty, Notice, PageHeader, Stat } from "@/components/ui";

export const dynamic = "force-dynamic";

const addDays = (s: string, n: number) => new Date(Date.parse(`${s}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

// One screen for a manager: who reports to them, what each of them did today, and what of theirs is waiting.
// Reads only; every decision is still made on the screen that owns it.
export default async function MyTeam({ searchParams }: { searchParams: Promise<{ date?: string }> }) {
  const user = await requirePermission("leave.approve");
  const sp = await searchParams;
  const org = user.organizationId;
  const profile = await db.companyProfile.findFirst({ where: { organizationId: org, isDefault: true }, select: { timezone: true } });
  const tz = profile?.timezone ?? "UTC";
  const today = dateInZone(new Date(), tz);
  const date = sp.date && isDateString(sp.date) && sp.date <= today ? sp.date : today;

  const team = await db.user.findMany({ where: { organizationId: org, managerId: user.id, active: true }, select: { id: true, name: true }, orderBy: { name: "asc" } });
  const ids = team.map((t) => t.id);
  const work = await getWorkingContext(db, org, date, date);
  const holiday = work.holidays.find((h) => h.date === date) ?? null;
  const [rows, leave, visits, vouchers] = await Promise.all([
    ids.length ? dayStatus(db, { organizationId: org, workDate: date, timeZone: tz, managerId: user.id, weekend: work.calendar.weekendDays, holidays: work.holidayDates }) : [],
    ids.length ? db.leaveRequest.count({ where: { userId: { in: ids }, status: "PENDING", leaveType: { organizationId: org } } }) : 0,
    ids.length ? db.siteVisitRequest.count({ where: { organizationId: org, userId: { in: ids }, status: "PENDING" } }) : 0,
    ids.length && (user.permissions.has("expenses.review") || user.permissions.has("expenses.approve"))
      ? db.expenseVoucher.count({ where: { organizationId: org, submittedById: { in: ids }, status: { in: ["SUBMITTED", "UNDER_REVIEW"] } } }) : 0,
  ]);
  const byId = new Map(rows.map((r) => [r.userId, r]));
  const present = rows.filter((r) => (r.attendanceMinutes ?? 0) > 0).length;
  const expected = rows.filter((r) => r.expected).length;
  const reported = rows.filter((r) => r.expected && r.report).length;
  const waiting = leave + visits + vouchers;
  const weekday = new Date(`${date}T12:00:00Z`).toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });

  if (team.length === 0) {
    return (
      <div className="space-y-5">
        <PageHeader title="My team" />
        <Empty title="Nobody reports to you yet">A person&apos;s manager is set on their staff record. Ask HR to set you as the manager of the people you look after, and they will appear here.</Empty>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="My team"
        subtitle={`${team.length} ${team.length === 1 ? "person reports" : "people report"} to you. ${weekday}.`}
        actions={
          <form method="get" action="/me/team" className="flex items-center gap-2 text-sm">
            <Link href={`/me/team?date=${addDays(date, -1)}`} className="btn-ghost" aria-label="Previous day">‹</Link>
            <input type="date" name="date" defaultValue={date} max={today} className="input !w-auto" /><button className="btn-ghost">Go</button>
            {date < today && <Link href={`/me/team?date=${addDays(date, 1)}`} className="btn-ghost" aria-label="Next day">›</Link>}
          </form>
        }
      />
      {holiday && <Notice kind="ok">{holiday.name} — a public holiday, so nobody was expected to work.</Notice>}

      <div className="grid gap-4 sm:grid-cols-4">
        <Stat label="Present" value={`${present} of ${team.length}`} />
        <Stat label="Reports sent" value={expected === 0 ? "—" : `${reported} of ${expected}`} />
        <Stat label="Waiting on you" value={String(waiting)} />
        <Stat label="Tasks finished" value={String(rows.reduce((s, r) => s + r.tasksDone, 0))} hint="by the team, today" />
      </div>

      {waiting > 0 && (
        <section className="card flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
          <span className="font-semibold">Waiting for your decision</span>
          {leave > 0 && <Link href="/hr/leave" className="text-primary hover:underline">{leave} leave request{leave === 1 ? "" : "s"}</Link>}
          {visits > 0 && <Link href="/hr/visits" className="text-primary hover:underline">{visits} off-site day{visits === 1 ? "" : "s"}</Link>}
          {vouchers > 0 && <Link href="/expenses" className="text-primary hover:underline">{vouchers} expense voucher{vouchers === 1 ? "" : "s"}</Link>}
          <Link href="/approvals" className="btn-ghost ml-auto">All approvals</Link>
        </section>
      )}

      <div className="card !p-0 overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-hover/60 text-left text-xs text-muted">
            <tr><th className="py-2 pl-4 pr-4">Person</th><th className="pr-4">Attendance</th><th className="pr-4">Daily report</th><th className="pr-4">Tasks done</th><th className="pr-4">Visits</th><th className="pr-4"></th></tr>
          </thead>
          <tbody>
            {team.map((t) => {
              const r = byId.get(t.id);
              return (
                <tr key={t.id} className="border-t border-border">
                  <td className="py-3 pl-4 pr-4"><span className="flex items-center gap-2"><Avatar name={t.name} userId={t.id} size={24} />{t.name}</span></td>
                  <td className="pr-4">{!r ? <span className="text-muted">No HR record</span> : r.onLeave ? <Badge tone="primary">On leave</Badge> : (r.attendanceMinutes ?? 0) > 0 ? fmtMinutes(r.attendanceMinutes ?? 0) : r.expected ? <Badge tone="warning">Not marked</Badge> : <span className="text-muted">Not a working day</span>}</td>
                  <td className="pr-4">{!r || !r.expected ? <span className="text-muted">—</span> : r.report ? (r.report.reviewedAt ? <Badge tone="success">Read</Badge> : <Link href={`/hr/reports?date=${date}&open=${r.report.id}`} className="text-primary hover:underline">Read it</Link>) : <Badge tone="warning">Missing</Badge>}</td>
                  <td className="pr-4 tabular-nums">{r?.tasksDone ?? 0}</td>
                  <td className="pr-4 tabular-nums">{r?.visits ?? 0}</td>
                  <td className="pr-4"><Link href={`/me/scorecard?user=${t.id}`} className="text-primary hover:underline">Scorecard</Link></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
