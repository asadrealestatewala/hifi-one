import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { audit, requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";
import { HrError } from "@/lib/hr";
import { breakEndAll, breakStartAll, clockInAll, clockOutAll, monitoringState } from "@/lib/clock";
import { acknowledge, getPolicy } from "@/lib/monitoring";
import { dateInZone, fmtMinutes, workedMinutes } from "@/lib/hr-rules";
import Link from "next/link";
import { describeVisit } from "@/lib/site-visits";
import { Notice, PageHeader } from "@/components/ui";

export const dynamic = "force-dynamic";

async function tz(organizationId: string) {
  const p = await db.companyProfile.findFirst({ where: { organizationId, isDefault: true } });
  return p?.timezone ?? "UTC";
}

async function act(formData: FormData) {
  "use server";
  const user = await requirePermission("self.attendance");
  const action = String(formData.get("action"));
  try {
    if (action === "in") {
      await clockInAll(db, { organizationId: user.organizationId, userId: user.id, timeZone: await tz(user.organizationId), workMode: formData.get("mode") === "REMOTE" ? "REMOTE" : "OFFICE" });
    } else if (action === "out") await clockOutAll(db, { userId: user.id });
    else if (action === "break_start") await breakStartAll(db, { userId: user.id });
    else if (action === "break_end") await breakEndAll(db, { userId: user.id });
    await audit(user, { action: `attendance.${action}`, entity: "AttendanceRecord" });
  } catch (e) {
    if (e instanceof HrError) redirect(`/me/attendance?error=${encodeURIComponent(e.message)}`);
    throw e;
  }
  revalidatePath("/me/attendance");
  redirect("/me/attendance");
}

// The tick is the consent: it is stored against the policy version the person actually saw.
async function accept(formData: FormData) {
  "use server";
  const user = await requirePermission("self.attendance");
  const policy = await getPolicy(db, user.organizationId);
  if (formData.get("agree") !== "yes") redirect(`/me/attendance?error=${encodeURIComponent("Tick the box to confirm you have read and accept the terms.")}`);
  if (Number(formData.get("version")) !== policy.version) redirect(`/me/attendance?error=${encodeURIComponent("The terms changed while you were reading. Please read the new version.")}`);
  await acknowledge(db, { userId: user.id, version: policy.version });
  await audit(user, { action: "monitoring.accept_policy", entity: "MonitoringPolicy", after: { version: policy.version, via: "attendance" } });
  redirect("/me/attendance");
}

export default async function MyAttendance({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const user = await requirePermission("self.attendance");
  const { error } = await searchParams;
  const zone = await tz(user.organizationId);
  const open = await db.attendanceRecord.findFirst({ where: { userId: user.id, clockOut: null }, include: { breaks: true } });
  const recent = await db.attendanceRecord.findMany({ where: { userId: user.id }, orderBy: { workDate: "desc" }, take: 14, include: { breaks: true } });
  const mstate = await monitoringState(db, user.organizationId, user.id);
  const policy = mstate === "NEEDS_CONSENT" ? await getPolicy(db, user.organizationId) : null;
  const onBreak = open?.breaks.some((b) => !b.endAt);
  const todayStr = dateInZone(new Date(), zone);
  const outToday = await db.siteVisitRequest.findMany({ where: { userId: user.id, status: "APPROVED", startDate: { lte: todayStr }, endDate: { gte: todayStr } }, include: { client: { select: { name: true } } } });
  const fmt = (d: Date) => d.toLocaleTimeString("en-GB", { timeZone: zone, hour: "2-digit", minute: "2-digit" });
  const live = open ? workedMinutes(open, open.breaks) : null;
  return (
    <div className="space-y-6">
      <PageHeader title="My Attendance" />
      <p className="text-sm text-muted">
        Attendance time is the time between clock in and clock out, minus breaks. Being signed in to this system does not count as working time.
        Today in {zone}: {dateInZone(new Date(), zone)}.
      </p>
      {error && <Notice kind="error">{error}</Notice>}
      {outToday.length > 0 && <Notice kind="ok">Approved for today: {outToday.map((v) => describeVisit(v)).join("; ")}. Clock in as remote when you start work, and HR will see why you are not in the office. <Link href="/me/visits" className="underline">Site visits</Link></Notice>}
      {policy && (
        <form action={accept} className="card space-y-3">
          <h2 className="font-semibold">Work tracking terms</h2>
          <p className="text-sm text-muted">Your attendance works without this. Activity tracking starts only after you accept, and only while you are clocked in.</p>
          <div className="whitespace-pre-line text-sm leading-relaxed">{policy.policyText}</div>
          <ul className="list-disc pl-5 text-sm">
            <li>Working hours recorded: {policy.workStart} to {policy.workEnd} ({policy.timezone}). Never on breaks.</li>
            <li>Activity: {policy.trackActivity ? "active and idle time and counts of key presses and clicks, never what you type" : "not collected"}.</li>
            <li>Applications: {policy.trackApps ? "names and durations only" : "not collected"}.</li>
            <li>Websites: {policy.trackWebsites ? "only the website name and time on it, never the page, search or title" : "not collected"}.</li>
            <li>Live view: {policy.liveView ? "a manager with permission can ask to watch the screen you are sharing; you can say no every time, you see a banner for as long as it runs, and each view is logged where you can read it" : "not used"}.</li>
            <li>Screenshots: {policy.screenshots ? `every ${policy.screenshotIntervalMin} minutes, only while you choose to share your screen or run the desktop app` : "not collected"}.</li>
            <li>You can see everything recorded about you, and who looked at it, under My Workfolio.</li>
          </ul>
          <input type="hidden" name="version" value={policy.version} />
          <label className="flex items-start gap-2 text-sm"><input type="checkbox" name="agree" value="yes" className="mt-1" /> I have read the terms and permissions above (version {policy.version}) and I accept them.</label>
          <button className="btn">Accept and continue</button>
        </form>
      )}
      <form action={act} className="card flex flex-wrap items-end gap-3">
        {!open ? (
          <>
            <div>
              <label className="label" htmlFor="mode">Working from</label>
              <select id="mode" name="mode" className="input"><option value="OFFICE">Office</option><option value="REMOTE">Remote</option></select>
            </div>
            <button name="action" value="in" className="btn">Clock in</button>
          </>
        ) : (
          <>
            <p className="text-sm mr-4">Clocked in at <strong>{fmt(open.clockIn)}</strong> ({open.workMode.toLowerCase()}){onBreak ? " · on break" : ""}. Worked so far: <strong>{fmtMinutes(live!.worked)}</strong></p>
            {onBreak ? <button name="action" value="break_end" className="btn-ghost">End break</button> : <button name="action" value="break_start" className="btn-ghost">Start break</button>}
            <button name="action" value="out" className="btn">Clock out</button>
          </>
        )}
      </form>
      <div className="card overflow-x-auto">
        <h2 className="font-semibold mb-2">Last 14 days</h2>
        {recent.length === 0 ? <p className="text-sm text-muted">No records yet.</p> : (
          <table className="w-full text-sm">
            <thead className="bg-hover/60 text-left text-xs text-muted"><tr><th className="py-2 pr-4">Date</th><th className="pr-4">In</th><th className="pr-4">Out</th><th className="pr-4">Breaks</th><th className="pr-4">Worked</th><th>Note</th></tr></thead>
            <tbody>
              {recent.map((r) => {
                const m = workedMinutes(r, r.breaks);
                return (
                  <tr key={r.id} className="border-t border-border transition hover:bg-hover/50">
                    <td className="py-2 pr-4">{r.workDate}</td><td className="pr-4">{fmt(r.clockIn)}</td>
                    <td className="pr-4">{r.clockOut ? fmt(r.clockOut) : <em className="text-muted">open</em>}</td>
                    <td className="pr-4">{fmtMinutes(m.breaks)}</td><td className="pr-4">{fmtMinutes(m.worked)}</td>
                    <td className="text-xs text-muted">{r.correctedById ? `Corrected by HR: ${r.note}` : ""}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
