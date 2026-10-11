import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { audit, requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";
import { HrError, clockIn, clockOut, endBreak, startBreak } from "@/lib/hr";
import { dateInZone, fmtMinutes, workedMinutes } from "@/lib/hr-rules";

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
      await clockIn(db, { userId: user.id, timeZone: await tz(user.organizationId), workMode: formData.get("mode") === "REMOTE" ? "REMOTE" : "OFFICE" });
    } else if (action === "out") await clockOut(db, { userId: user.id });
    else if (action === "break_start") await startBreak(db, { userId: user.id });
    else if (action === "break_end") await endBreak(db, { userId: user.id });
    await audit(user, { action: `attendance.${action}`, entity: "AttendanceRecord" });
  } catch (e) {
    if (e instanceof HrError) redirect(`/me/attendance?error=${encodeURIComponent(e.message)}`);
    throw e;
  }
  revalidatePath("/me/attendance");
  redirect("/me/attendance");
}

export default async function MyAttendance({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const user = await requirePermission("self.attendance");
  const { error } = await searchParams;
  const zone = await tz(user.organizationId);
  const open = await db.attendanceRecord.findFirst({ where: { userId: user.id, clockOut: null }, include: { breaks: true } });
  const recent = await db.attendanceRecord.findMany({ where: { userId: user.id }, orderBy: { workDate: "desc" }, take: 14, include: { breaks: true } });
  const onBreak = open?.breaks.some((b) => !b.endAt);
  const fmt = (d: Date) => d.toLocaleTimeString("en-GB", { timeZone: zone, hour: "2-digit", minute: "2-digit" });
  const live = open ? workedMinutes(open, open.breaks) : null;
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">My Attendance</h1>
      <p className="text-sm text-muted">
        Attendance time is the time between clock in and clock out, minus breaks. Being signed in to this system does not count as working time.
        Today in {zone}: {dateInZone(new Date(), zone)}.
      </p>
      {error && <p role="alert" className="text-sm text-brand bg-brand/10 rounded-lg px-3 py-2">{error}</p>}
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
