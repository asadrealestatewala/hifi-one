import Link from "next/link";
import { requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";
import { dayStatus } from "@/lib/daily-reports";
import { dateInZone, fmtMinutes, isDateString } from "@/lib/hr-rules";
import { getWorkingContext } from "@/lib/working-calendar";
import { REQUEST_TYPE_LABEL, attachmentsFor, isOpen, requestsForManager, type RequestType } from "@/lib/employee-requests";
import { noteRequestAction } from "./actions";
import RequestAttachments from "@/components/RequestAttachments";
import { Avatar, Badge, Empty, Notice, PageHeader, Stat, SubmitButton } from "@/components/ui";

export const dynamic = "force-dynamic";

const addDays = (s: string, n: number) => new Date(Date.parse(`${s}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

// One screen for a manager: who reports to them, what each of them did today, and what of theirs is waiting.
// Reads only; every decision is still made on the screen that owns it.
export default async function MyTeam({ searchParams }: { searchParams: Promise<{ date?: string; msg?: string; error?: string }> }) {
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
  const apps = await requestsForManager(db, org, user.id);
  const appList = [...apps.open, ...apps.answered];
  const appFiles = await attachmentsFor(db, org, appList.map((a) => a.id));
  const nameOf = new Map(team.map((t) => [t.id, t.name]));
  for (const u of await db.user.findMany({ where: { id: { in: appList.map((a) => a.userId).filter((id) => !nameOf.has(id)) } }, select: { id: true, name: true } })) nameOf.set(u.id, u.name);
  const STATUS: Record<string, [string, "neutral" | "warning" | "success" | "danger" | "primary"]> = { SUBMITTED: ["Waiting for HR", "warning"], IN_REVIEW: ["HR is reviewing", "primary"], APPROVED: ["Approved", "success"], DECLINED: ["Declined", "danger"], CANCELLED: ["Withdrawn", "neutral"] };
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
      {sp.error && <Notice kind="error">{sp.error}</Notice>}
      {sp.msg && <Notice kind="ok">{sp.msg}</Notice>}
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

      <section id="requests" className="card space-y-3" aria-labelledby="team-requests">
        <div>
          <h2 id="team-requests" className="font-semibold">Applications to HR</h2>
          <p className="text-sm text-muted">What your team asked HR for, when they shared it with you. HR answers; you can add a comment for HR, which the employee does not see. Applications marked &ldquo;Private, HR only&rdquo; and complaints never appear here.</p>
        </div>
        {appList.length === 0 ? (
          <p className="rounded-xl bg-hover/60 px-4 py-6 text-center text-sm text-muted">No applications from your team.</p>
        ) : (
          <ul className="divide-y divide-border rounded-xl border border-border">
            {appList.map((a) => {
              const [label, tone] = STATUS[a.status] ?? [a.status, "neutral"];
              const files = appFiles.filter((f) => f.ownerId === a.id);
              return (
                <li key={a.id} className="space-y-2 px-4 py-3 text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{nameOf.get(a.userId) ?? "Former staff"}</span>
                    <span className="text-muted">· {REQUEST_TYPE_LABEL[a.type as RequestType] ?? a.type}</span>
                    <Badge tone={tone}>{label}</Badge>
                    <span className="ml-auto text-xs text-muted">{a.createdAt.toISOString().slice(0, 10)}</span>
                  </div>
                  <p className="font-medium">{a.subject}</p>
                  <p className="whitespace-pre-line text-muted">{a.body}</p>
                  <RequestAttachments files={files} viewerId={user.id} />
                  {a.responseNote && !isOpen(a.status) && <p className="text-xs"><span className="font-medium">HR:</span> {a.responseNote}</p>}
                  {isOpen(a.status) ? (
                    <form action={noteRequestAction} className="flex flex-col gap-2 sm:flex-row sm:items-end">
                      <input type="hidden" name="id" value={a.id} />
                      <div className="flex-1">
                        <label htmlFor={`note-${a.id}`} className="label">{a.managerNote ? "Your comment for HR" : "Comment for HR (optional)"}</label>
                        <textarea id={`note-${a.id}`} name="note" className="input min-h-16" maxLength={2000} defaultValue={a.managerNote ?? ""} placeholder="For example: I support this; the laptop is needed for the new client." />
                      </div>
                      <SubmitButton pendingText="Saving…">{a.managerNote ? "Update comment" : "Send to HR"}</SubmitButton>
                    </form>
                  ) : a.managerNote ? <p className="text-xs text-muted">Your comment: {a.managerNote}</p> : null}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
