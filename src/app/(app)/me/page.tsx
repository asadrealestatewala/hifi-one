import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { dateInZone, fmtMinutes } from "@/lib/hr-rules";
import { loadMyDay } from "@/lib/my-day";
import { myTargetToday } from "@/lib/my-target";
import { getWorkingContext } from "@/lib/working-calendar";
import { MY_SPACE_GROUPS as GROUPS } from "@/lib/my-space";
import Icon from "@/components/shell/Icon";
import { Notice, PageHeader, Progress } from "@/components/ui";

export const dynamic = "force-dynamic";

const TONE = { primary: "bg-primary/10 text-primary", warning: "bg-warning/10 text-warning", danger: "bg-brand/10 text-brand" };

export default async function MyDayPage() {
  const user = await requireUser();
  const profile = await db.companyProfile.findFirst({ where: { organizationId: user.organizationId, isDefault: true }, select: { timezone: true } });
  const tz = profile?.timezone ?? "UTC";
  const today = dateInZone(new Date(), tz);
  const work = await getWorkingContext(db, user.organizationId, today, today);
  const day = await loadMyDay(db, {
    organizationId: user.organizationId, userId: user.id, permissions: user.permissions, date: today, timeZone: tz,
    calendar: work.calendar, holidayName: work.holidays.find((h) => h.date === today)?.name ?? null,
  });
  const targets = await myTargetToday(db, { organizationId: user.organizationId, userId: user.id, date: today, timeZone: tz });
  const clockLabel = { NOT_STARTED: "Not clocked in", WORKING: "Clocked in", ON_BREAK: "On a break", FINISHED: "Clocked out" }[day.clock.state];
  const reportLabel = { SENT: "Sent", LATE: "Sent late", MISSING: "Not written yet", NOT_EXPECTED: "Not expected today" }[day.report];
  const groups = GROUPS.map((g) => ({ ...g, entries: g.entries.filter((e) => e.permission === null || user.permissions.has(e.permission)) })).filter((g) => g.entries.length > 0);
  const weekday = new Date(`${today}T12:00:00Z`).toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });
  return (
    <div className="max-w-5xl space-y-5">
      <PageHeader title="My day" subtitle={`${weekday}. What today asks of you, and everything that is yours in one place.`} />

      {!day.kind.working && <Notice kind="ok">{day.kind.reason} Nothing is expected of you today.</Notice>}

      <section className="card space-y-4">
        <div className="grid gap-3 sm:grid-cols-3">
          {user.permissions.has("self.attendance") && (
            <Link href="/me/attendance" className="rounded-xl border border-border p-3 transition hover:border-primary/40">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted">Attendance</p>
              <p className="mt-1 font-semibold">{clockLabel}</p>
              <p className="text-xs text-muted">{day.clock.state === "NOT_STARTED" ? "Start when you begin work" : `${fmtMinutes(day.clock.workedMinutes)} worked${day.clock.breaks ? `, ${fmtMinutes(day.clock.breaks)} on breaks` : ""}`}</p>
            </Link>
          )}
          {user.permissions.has("self.attendance") && (
            <Link href="/me/report" className="rounded-xl border border-border p-3 transition hover:border-primary/40">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted">Daily report</p>
              <p className="mt-1 font-semibold">{reportLabel}</p>
              <p className="text-xs text-muted">{day.report === "MISSING" ? "Your manager and HR read it" : "For today"}</p>
            </Link>
          )}
          <Link href="/me/tasks" className="rounded-xl border border-border p-3 transition hover:border-primary/40">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted">Tasks</p>
            <p className="mt-1 font-semibold">{day.tasks.dueToday} due today</p>
            <p className="text-xs text-muted">{day.tasks.overdue > 0 ? `${day.tasks.overdue} overdue · ` : ""}{day.tasks.open} open in all</p>
          </Link>
        </div>

        {targets.length > 0 && day.kind.working && (
          <div>
            <h2 className="mb-2 font-semibold">My target today</h2>
            <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {targets.map((t) => (
                <li key={t.key}>
                  <Link href={t.href} className="block rounded-xl border border-border p-3 transition hover:border-primary/40">
                    <p className="mb-2 text-sm font-medium">{t.label}</p>
                    <Progress value={t.done} max={t.target} label={`${t.label}: ${t.done} of ${t.target}`} />
                    <p className="mt-1 text-xs text-muted">
                      {t.done >= t.target ? "Target reached" : `${t.target - t.done} to go`}
                      {t.pending ? ` · ${t.pending} waiting for a manager to verify` : ""}
                    </p>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div>
          <h2 className="mb-2 font-semibold">Still to do today</h2>
          {day.items.length === 0 ? (
            <p className="rounded-xl bg-hover/60 px-4 py-6 text-center text-sm text-muted">{day.kind.working ? "Nothing left. Your attendance, report and tasks are all up to date." : "Nothing, it is not a working day."}</p>
          ) : (
            <ul className="divide-y divide-border rounded-xl border border-border">
              {day.items.map((i) => (
                <li key={i.id}>
                  <Link href={i.href} className="flex items-center gap-3 px-4 py-3 text-sm transition hover:bg-hover/60">
                    <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${TONE[i.tone]}`}><Icon name={i.icon} className="h-4 w-4" /></span>
                    <span className="min-w-0 flex-1"><span className="block">{i.text}</span>{i.sub && <span className="block truncate text-xs text-muted">{i.sub}</span>}</span>
                    <Icon name="chevron" className="h-4 w-4 text-muted" />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      {groups.map((g) => (
        <section key={g.id} className="space-y-2" aria-labelledby={`my-${g.id}`}>
          <h2 id={`my-${g.id}`} className="text-sm font-semibold text-muted">{g.title}</h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {g.entries.map((e) => (
              <Link key={e.href} href={e.href} className="card block !p-4 transition hover:ring-2 hover:ring-primary/30">
                <p className="font-semibold">{e.label}</p>
                <p className="mt-1 text-sm text-muted">{e.what}</p>
              </Link>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
