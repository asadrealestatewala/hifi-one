import { requirePermission } from "@/lib/auth";
import { Badge, Empty, Notice, PageHeader, Stat } from "@/components/ui";
import { db } from "@/lib/db";
import { STALE_MS, getPolicy, hasAccepted, summarize } from "@/lib/monitoring";
import { acceptPolicy, clock, correction, dispute } from "./actions";
import Tracker from "./Tracker";

export const dynamic = "force-dynamic";
const fmt = (m: number) => `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m`;
const dayStr = (d: Date) => d.toISOString().slice(0, 10);

export default async function MyTime({ searchParams }: { searchParams: Promise<{ error?: string; msg?: string }> }) {
  const user = await requirePermission("monitoring.own");
  const sp = await searchParams;
  const org = user.organizationId;
  const policy = await getPolicy(db, org);
  const flash = (<>{sp.error && <Notice kind="error">{sp.error}</Notice>}{sp.msg && <Notice kind="ok">{sp.msg}</Notice>}</>);

  if (!policy.enabled) {
    return (
      <div className="space-y-5 max-w-3xl">
        <PageHeader title="My time" subtitle="Clock in, take breaks, and review your timesheet." />
        {flash}
        <Empty title="Time tracking is not switched on yet">Your organization has not turned on work time tracking. Nothing is being recorded about you. Your attendance record is still available under My Attendance.</Empty>
      </div>
    );
  }

  const accepted = await hasAccepted(db, user.id, policy.version);
  if (!accepted) {
    return (
      <div className="space-y-5 max-w-3xl">
        <PageHeader title="Monitoring policy" subtitle="Please read this before any time or activity is recorded about you." />
        {flash}
        <section className="card space-y-4">
          <div className="whitespace-pre-line text-sm leading-relaxed">{policy.policyText}</div>
          <dl className="grid gap-x-6 gap-y-1 border-t border-border pt-4 text-sm sm:grid-cols-2">
            <dt className="text-muted">Working hours recorded</dt><dd>{policy.workStart} to {policy.workEnd} ({policy.timezone}), days {policy.workDays.split(",").map((d) => ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][Number(d)]).join(", ")}</dd>
            <dt className="text-muted">Activity</dt><dd>{policy.trackActivity ? "Active and idle time, and counts of key presses and clicks. Never what you type." : "Not collected"}</dd>
            <dt className="text-muted">Applications</dt><dd>{policy.trackApps ? "Names of applications you use, as durations. Never window titles or web addresses." : "Not collected"}</dd>
            <dt className="text-muted">Screenshots</dt><dd>{policy.screenshots ? `Every ${policy.screenshotIntervalMin} minutes during working hours, only from the desktop app, never during breaks.` : "Not collected"}</dd>
            <dt className="text-muted">Kept for</dt><dd>Screenshots {policy.retentionDays} days; activity totals 180 days</dd>
          </dl>
          <p className="text-xs text-muted">You can see everything recorded about you on this page, see who has looked at it, ask for a day to be corrected, and dispute a screenshot. Version {policy.version}.</p>
          <form action={acceptPolicy}><input type="hidden" name="version" value={policy.version} /><button className="btn">I have read and accept this policy</button></form>
        </section>
      </div>
    );
  }

  const now = new Date();
  const today = dayStr(now);
  const open = await db.workSession.findFirst({ where: { userId: user.id, endedAt: null, lastBeatAt: { gte: new Date(now.getTime() - STALE_MS) } }, include: { breaks: { where: { endedAt: null } } } });
  const days = Array.from({ length: 7 }, (_, i) => dayStr(new Date(now.getTime() - i * 86400000)));
  const [week, projects, corrections, shots, apps, access] = await Promise.all([
    summarize(db, { organizationId: org, userIds: [user.id], from: days[6], to: today }),
    db.project.findMany({ where: { organizationId: org, status: "ACTIVE", OR: [{ managerId: user.id }, { members: { some: { userId: user.id } } }] }, select: { id: true, name: true }, take: 50 }),
    db.timesheetCorrection.findMany({ where: { userId: user.id }, orderBy: { createdAt: "desc" }, take: 8 }),
    db.screenshot.findMany({ where: { userId: user.id, deletedAt: null }, orderBy: { capturedAt: "desc" }, take: 12 }),
    db.appUsage.findMany({ where: { userId: user.id, day: today }, orderBy: { seconds: "desc" }, take: 8 }),
    db.monitoringAccess.findMany({ where: { subjectId: user.id }, orderBy: { createdAt: "desc" }, take: 10 }),
  ]);
  const perDay = await Promise.all(days.map(async (d) => [d, (await summarize(db, { organizationId: org, userIds: [user.id], from: d, to: d }))[0]] as const));
  const t = (await summarize(db, { organizationId: org, userIds: [user.id], from: today, to: today }))[0];
  void week;
  const viewers = new Map((await db.user.findMany({ where: { id: { in: access.map((a) => a.viewerId) } }, select: { id: true, name: true } })).map((u) => [u.id, u.name]));

  return (
    <div className="space-y-6">
      <PageHeader title="My time" subtitle="Everything recorded about you is on this page. Nothing is recorded outside working hours or while you are on a break." actions={<Badge tone="success">Policy v{policy.version} accepted</Badge>} />
      {flash}

      <section className="card space-y-4">
        {open ? (
          <>
            <Tracker sessionId={open.id} startedAtMs={open.startedAt.getTime()} onBreak={open.breaks.length > 0} idleSeconds={policy.idleThresholdMin * 60} />
            <div className="flex flex-wrap gap-2">
              <form action={clock}><input type="hidden" name="sessionId" value={open.id} /><input type="hidden" name="op" value={open.breaks.length ? "breakEnd" : "breakStart"} /><button className="btn-ghost">{open.breaks.length ? "End break" : "Start a break"}</button></form>
              <form action={clock}><input type="hidden" name="sessionId" value={open.id} /><input type="hidden" name="op" value="stop" /><button className="btn">Clock out</button></form>
            </div>
            <p className="text-xs text-muted">This tracker measures activity in this browser tab (movement, typing and clicks, counted and never read). It cannot see other applications. Keep this tab open while you work.</p>
          </>
        ) : (
          <form action={clock} className="flex flex-wrap items-end gap-3">
            <input type="hidden" name="op" value="start" />
            <div><label className="label" htmlFor="proj">Working on (optional)</label><select id="proj" name="projectId" className="input !w-60"><option value="">No project</option>{projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></div>
            <div><label className="label" htmlFor="note">Note (optional)</label><input id="note" name="note" maxLength={300} className="input !w-64" /></div>
            <button className="btn">Clock in</button>
          </form>
        )}
      </section>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Stat label="Attendance today" value={fmt(t?.attendanceMinutes ?? 0)} />
        <Stat label="Active" value={fmt(t?.activeMinutes ?? 0)} />
        <Stat label="Idle" value={fmt(t?.idleMinutes ?? 0)} />
        <Stat label="Breaks" value={fmt(t?.breakMinutes ?? 0)} />
        <Stat label="Key presses · clicks" value={`${t?.keys ?? 0} · ${t?.clicks ?? 0}`} hint="counts only" />
      </div>

      <section className="card overflow-x-auto">
        <h2 className="mb-2 font-semibold">This week</h2>
        <table className="w-full text-sm">
          <thead className="text-left"><tr><th className="py-2 pr-4">Day</th><th className="pr-4">Attendance</th><th className="pr-4">Active</th><th className="pr-4">Idle</th><th className="pr-4">Breaks</th><th>Approved correction</th></tr></thead>
          <tbody>{perDay.map(([d, r]) => <tr key={d} className="border-t border-border"><td className="py-2 pr-4">{d}</td><td className="pr-4">{fmt(r?.attendanceMinutes ?? 0)}</td><td className="pr-4">{fmt(r?.activeMinutes ?? 0)}</td><td className="pr-4">{fmt(r?.idleMinutes ?? 0)}</td><td className="pr-4">{fmt(r?.breakMinutes ?? 0)}</td><td>{r?.correctedMinutes ? fmt(r.correctedMinutes) : ""}</td></tr>)}</tbody>
        </table>
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="card space-y-3">
          <h2 className="font-semibold">Ask for a correction</h2>
          <form action={correction} className="grid gap-3 sm:grid-cols-2">
            <div><label className="label" htmlFor="c-day">Day</label><input id="c-day" name="day" type="date" max={today} required className="input" /></div>
            <div><label className="label" htmlFor="c-h">Hours the day should show</label><input id="c-h" name="hours" inputMode="decimal" required className="input" placeholder="e.g. 8" /></div>
            <div className="sm:col-span-2"><label className="label" htmlFor="c-r">Why</label><input id="c-r" name="reason" required minLength={5} maxLength={500} className="input" placeholder="e.g. worked at a client site without the tracker" /></div>
            <div className="sm:col-span-2"><button className="btn-ghost">Send request</button></div>
          </form>
          {corrections.length > 0 && <ul className="text-sm">{corrections.map((c) => <li key={c.id} className="flex justify-between border-t border-border py-1.5"><span>{c.day} · {fmt(c.requestedMinutes)}</span><Badge tone={c.status === "APPROVED" ? "success" : c.status === "REJECTED" ? "danger" : "warning"}>{c.status.toLowerCase()}</Badge></li>)}</ul>}
        </section>
        <section className="card space-y-3">
          <h2 className="font-semibold">Who has looked at my data</h2>
          {access.length === 0 ? <p className="text-sm text-muted">Nobody has opened your screenshots or detailed reports.</p> : <ul className="text-sm">{access.map((a) => <li key={a.id} className="flex justify-between border-t border-border py-1.5 first:border-0"><span>{viewers.get(a.viewerId) ?? "Someone"} opened {a.what === "SCREENSHOT" ? "a screenshot" : "a report"}</span><span className="text-muted">{a.createdAt.toLocaleString()}</span></li>)}</ul>}
          {apps.length > 0 && <><h3 className="pt-2 text-sm font-semibold">Applications today</h3><ul className="text-sm">{apps.map((a) => <li key={a.id} className="flex justify-between border-t border-border py-1 first:border-0"><span>{a.name}</span><span className="text-muted">{Math.round(a.seconds / 60)} min</span></li>)}</ul></>}
        </section>
      </div>

      {policy.screenshots && (
        <section className="card space-y-3">
          <h2 className="font-semibold">My screenshots</h2>
          {shots.length === 0 ? <p className="text-sm text-muted">No screenshots yet. They are only taken by the desktop app, during working hours, never during breaks.</p> : (
            <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-4">{shots.map((s) => (
              <figure key={s.id} className="space-y-1 text-xs">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <a href={`/api/screenshots/${s.id}`} target="_blank" rel="noopener"><img src={`/api/screenshots/${s.id}`} alt={`Screenshot taken ${s.capturedAt.toLocaleString()}`} loading="lazy" className="aspect-video w-full rounded-lg border border-border object-cover" /></a>
                <figcaption className="flex items-center justify-between text-muted"><span>{s.capturedAt.toLocaleString()}</span>{s.disputed && <Badge tone="warning">flagged</Badge>}</figcaption>
                {!s.disputed && <details><summary className="cursor-pointer underline">Flag a problem</summary><form action={dispute} className="mt-1 flex gap-1"><input type="hidden" name="id" value={s.id} /><input name="note" required minLength={5} maxLength={500} placeholder="What is wrong?" aria-label="What is wrong with this screenshot" className="input !py-1 text-xs" /><button className="btn-ghost !py-1 text-xs">Send</button></form></details>}
              </figure>
            ))}</div>
          )}
        </section>
      )}
    </div>
  );
}
