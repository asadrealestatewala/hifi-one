import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { dateInZone, fmtMinutes } from "@/lib/hr-rules";
import { loadMyDay } from "@/lib/my-day";
import { getWorkingContext } from "@/lib/working-calendar";
import type { PermissionKey } from "@/lib/permissions";
import Icon from "@/components/shell/Icon";
import { Notice, PageHeader } from "@/components/ui";

export const dynamic = "force-dynamic";

// Everything in My space, in the six groups a person actually thinks in. The sidebar carries the six; this page is
// where the rest live, so nothing is lost and nothing has to be hunted for.
type Entry = { href: string; label: string; what: string; permission: PermissionKey | null };
const GROUPS: { id: string; title: string; icon: string; entries: Entry[] }[] = [
  { id: "today", title: "Today", icon: "clock", entries: [
    { href: "/me/attendance", label: "My attendance", what: "Clock in, breaks, clock out, and the last two weeks.", permission: "self.attendance" },
    { href: "/me/report", label: "My daily report", what: "A short note at the end of each working day.", permission: "self.attendance" },
    { href: "/me/tasks", label: "My tasks", what: "Everything assigned to you, with due dates.", permission: null },
    { href: "/me/circulars", label: "Circulars", what: "Notices from HR and management addressed to you.", permission: null },
    { href: "/me/calendar", label: "My calendar", what: "Your days in a calendar, and a feed you can subscribe to.", permission: "self.leave" },
  ] },
  { id: "time", title: "Time and attendance", icon: "clock", entries: [
    { href: "/me/time", label: "Time tracking", what: "Your hours and activity, and who has looked at them.", permission: "monitoring.own" },
    { href: "/me/visits", label: "Site visits", what: "Client visits, field work and days worked from home.", permission: "self.attendance" },
    { href: "/me/scorecard", label: "My scorecard", what: "Attendance, punctuality, report and output, day by day.", permission: "self.attendance" },
  ] },
  { id: "ask", title: "Asking for something", icon: "file", entries: [
    { href: "/me/leave", label: "My leave", what: "Your balance and your leave requests.", permission: "self.leave" },
    { href: "/me/requests", label: "My requests", what: "Certificates, advances, equipment, complaints: anything without a form of its own.", permission: "self.leave" },
    { href: "/expenses", label: "Expense vouchers", what: "Money you spent for work, with the receipt attached.", permission: "self.expense" },
  ] },
  { id: "pay", title: "Pay and papers", icon: "wallet", entries: [
    { href: "/me/payslips", label: "My payslips", what: "Every month you have been paid for, as a PDF.", permission: "self.payslip" },
    { href: "/me/commissions", label: "My commissions", what: "Earned, approved and paid.", permission: "commissions.own" },
    { href: "/me/documents", label: "My documents", what: "Identity, certificates and contracts you have given HR.", permission: "self.leave" },
  ] },
  { id: "tools", title: "Tools", icon: "chat", entries: [
    { href: "/mail", label: "Mailbox", what: "Your company email.", permission: null },
    { href: "/chat", label: "Team chat", what: "Messages, group chats and calls.", permission: "chat.use" },
    { href: "/assistant", label: "Assistant", what: "Questions about your data, answered from what you may see.", permission: "assistant.use" },
  ] },
  { id: "account", title: "Your account", icon: "user", entries: [
    { href: "/me/profile", label: "My profile", what: "Your picture, contact details and what colleagues see.", permission: null },
    { href: "/account/security", label: "Account security", what: "Password, two-step sign-in and your sessions.", permission: null },
    { href: "/me/help", label: "Help & guide", what: "Where each job is done, and a few tips.", permission: null },
    { href: "/site/app", label: "Mobile app", what: "The Android app and how to install it.", permission: null },
  ] },
];

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
            <p className="mt-1 font-semibold">{day.tasks.open} open</p>
            <p className="text-xs text-muted">{day.tasks.overdue > 0 ? `${day.tasks.overdue} overdue` : day.tasks.dueToday > 0 ? `${day.tasks.dueToday} due today` : "Nothing overdue"}</p>
          </Link>
        </div>

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
