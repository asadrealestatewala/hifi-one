import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { audit, requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";
import { PageHeader, Stat } from "@/components/ui";
import { HrError, correctClockOut } from "@/lib/hr";
import { fmtMinutes, workedMinutes } from "@/lib/hr-rules";

export const dynamic = "force-dynamic";

async function correct(formData: FormData) {
  "use server";
  const user = await requirePermission("attendance.view_all");
  const id = String(formData.get("id"));
  const time = String(formData.get("clockOut")); // datetime-local, interpreted as UTC offset-free: stored as entered in server zone
  try {
    const rec = await db.attendanceRecord.findUniqueOrThrow({ where: { id } });
    const u = await db.user.findUniqueOrThrow({ where: { id: rec.userId } });
    if (u.organizationId !== user.organizationId) throw new HrError("Record not found.");
    await correctClockOut(db, { recordId: id, clockOut: new Date(time), correctedById: user.id, note: String(formData.get("note") ?? "") });
    await audit(user, { action: "attendance.correct", entity: "AttendanceRecord", entityId: id, after: { clockOut: time } });
  } catch (e) {
    if (e instanceof HrError) redirect(`/hr/attendance?error=${encodeURIComponent(e.message)}`);
    throw e;
  }
  revalidatePath("/hr/attendance");
}

export default async function HrAttendance({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const user = await requirePermission("attendance.view_all");
  const { error } = await searchParams;
  const people = await db.user.findMany({ where: { organizationId: user.organizationId }, select: { id: true, name: true } });
  const ids = people.map((p) => p.id);
  const name = new Map(people.map((p) => [p.id, p.name]));
  const [openRecs, recent] = await Promise.all([
    db.attendanceRecord.findMany({ where: { userId: { in: ids }, clockOut: null }, orderBy: { workDate: "asc" } }),
    db.attendanceRecord.findMany({ where: { userId: { in: ids } }, orderBy: [{ workDate: "desc" }, { clockIn: "desc" }], take: 60, include: { breaks: true } }),
  ]);
  return (
    <div className="space-y-6">
      <PageHeader title="Attendance" subtitle="Everyone's clock-ins, breaks and open sessions." />
      <div className="grid gap-3 sm:grid-cols-3">
        <Stat label="Clocked in now" value={openRecs.length} hint="sessions still open" />
        <Stat label="Records shown" value={recent.length} hint="most recent 60" />
        <Stat label="People" value={people.length} />
      </div>
      {error && <p role="alert" className="text-sm text-brand bg-brand/10 rounded-lg px-3 py-2">{error}</p>}
      <section className="card space-y-2">
        <h2 className="font-semibold">Open sessions</h2>
        <p className="text-xs text-muted">A session left open is never closed automatically. Enter the real clock-out time and a reason to correct it; the correction is recorded against your name.</p>
        {openRecs.length === 0 && <p className="text-sm text-muted">No open sessions.</p>}
        {openRecs.map((r) => (
          <form key={r.id} action={correct} className="flex flex-wrap items-center gap-2 border-t border-border py-2 text-sm">
            <input type="hidden" name="id" value={r.id} />
            <span className="w-40 font-medium">{name.get(r.userId)}</span><span>{r.workDate}, in {r.clockIn.toLocaleTimeString()}</span>
            <input name="clockOut" type="datetime-local" required aria-label="Actual clock-out time" className="input w-56" />
            <input name="note" required placeholder="Reason" aria-label="Reason" className="input w-56" />
            <button className="btn-ghost">Correct</button>
          </form>
        ))}
      </section>
      <section className="card overflow-x-auto">
        <h2 className="font-semibold mb-2">Recent records</h2>
        <table className="w-full text-sm">
          <thead className="bg-hover/60 text-left text-xs text-muted"><tr><th className="py-2 pr-4">Date</th><th className="pr-4">Employee</th><th className="pr-4">Mode</th><th className="pr-4">Attendance</th><th className="pr-4">Breaks</th><th>Worked</th></tr></thead>
          <tbody>
            {recent.map((r) => {
              const m = workedMinutes(r, r.breaks);
              return (
                <tr key={r.id} className="border-t border-border transition hover:bg-hover/50">
                  <td className="py-2 pr-4">{r.workDate}</td><td className="pr-4">{name.get(r.userId)}</td><td className="pr-4">{r.workMode.toLowerCase()}</td>
                  <td className="pr-4">{fmtMinutes(m.attendance)}{!r.clockOut && " (open)"}</td><td className="pr-4">{fmtMinutes(m.breaks)}</td><td>{fmtMinutes(m.worked)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>
    </div>
  );
}
