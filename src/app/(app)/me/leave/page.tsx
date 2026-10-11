import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { audit, requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";
import { HrError, cancelLeave, decideLeave, leaveBalances, requestLeave } from "@/lib/hr";
import { dateInZone } from "@/lib/hr-rules";
import { notify } from "@/lib/notifications";

export const dynamic = "force-dynamic";

function fail(m: string): never {
  redirect(`/me/leave?error=${encodeURIComponent(m)}`);
}

async function submit(formData: FormData) {
  "use server";
  const user = await requirePermission("self.leave");
  try {
    const r = await requestLeave(db, {
      organizationId: user.organizationId, userId: user.id, leaveTypeId: String(formData.get("leaveTypeId")),
      startDate: String(formData.get("startDate")), endDate: String(formData.get("endDate")), reason: String(formData.get("reason") ?? ""),
    });
    await audit(user, { action: "leave.request", entity: "LeaveRequest", entityId: r.id, after: { start: r.startDate, end: r.endDate, days: r.days.toString() } });
    const me = await db.user.findUnique({ where: { id: user.id }, select: { managerId: true } });
    if (me?.managerId) await notify(db, me.managerId, { kind: "leave.request", title: `${user.name} requested leave`, body: `${r.startDate} to ${r.endDate} (${r.days.toString()} days)`, link: "/me/leave", dedupeKey: `leave:${r.id}` });
  } catch (e) {
    if (e instanceof HrError) fail(e.message);
    throw e;
  }
  revalidatePath("/me/leave");
}

async function cancel(formData: FormData) {
  "use server";
  const user = await requirePermission("self.leave");
  const profile = await db.companyProfile.findFirst({ where: { organizationId: user.organizationId, isDefault: true } });
  try {
    await cancelLeave(db, { requestId: String(formData.get("id")), userId: user.id, today: dateInZone(new Date(), profile?.timezone ?? "UTC") });
    await audit(user, { action: "leave.cancel", entity: "LeaveRequest", entityId: String(formData.get("id")) });
  } catch (e) {
    if (e instanceof HrError) fail(e.message);
    throw e;
  }
  revalidatePath("/me/leave");
}

async function decide(formData: FormData) {
  "use server";
  const user = await requirePermission("leave.approve");
  const approve = formData.get("decision") === "approve";
  try {
    // HR (attendance.view_all) can decide for anyone; managers only for their direct reports.
    const decided = await decideLeave(db, {
      requestId: String(formData.get("id")), approverId: user.id, approve, note: String(formData.get("note") ?? ""),
      canApproveAll: user.permissions.has("attendance.view_all"),
    });
    await audit(user, { action: approve ? "leave.approve" : "leave.reject", entity: "LeaveRequest", entityId: String(formData.get("id")) });
    await notify(db, decided.userId, { kind: "leave.decision", title: approve ? "Your leave was approved" : "Your leave was not approved", body: `${decided.startDate} to ${decided.endDate}`, link: "/me/leave", dedupeKey: `leave-decision:${decided.id}` });
  } catch (e) {
    if (e instanceof HrError) fail(e.message);
    throw e;
  }
  revalidatePath("/me/leave");
}

export default async function MyLeave({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const user = await requirePermission("self.leave");
  const { error } = await searchParams;
  const profile = await db.companyProfile.findFirst({ where: { organizationId: user.organizationId, isDefault: true } });
  const year = dateInZone(new Date(), profile?.timezone ?? "UTC").slice(0, 4);
  const [balances, mine, types] = await Promise.all([
    leaveBalances(db, user.organizationId, user.id, year),
    db.leaveRequest.findMany({ where: { userId: user.id }, orderBy: { startDate: "desc" }, include: { leaveType: true }, take: 50 }),
    db.leaveType.findMany({ where: { organizationId: user.organizationId, active: true }, orderBy: { name: "asc" } }),
  ]);
  const canApprove = user.permissions.has("leave.approve");
  const toDecide = canApprove
    ? await db.leaveRequest.findMany({
        where: { status: "PENDING", userId: { not: user.id } }, // narrowed to direct reports below for non-HR
        orderBy: { startDate: "asc" }, include: { leaveType: true },
      })
    : [];
  const people = new Map((await db.user.findMany({ where: { organizationId: user.organizationId }, select: { id: true, name: true, managerId: true } })).map((u) => [u.id, u]));
  const approvable = toDecide.filter((r) => user.permissions.has("attendance.view_all") || people.get(r.userId)?.managerId === user.id);
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">My Leave</h1>
      {error && <p role="alert" className="text-sm text-brand bg-brand/10 rounded-lg px-3 py-2">{error}</p>}
      <div className="grid gap-4 sm:grid-cols-4">
        {balances.map((b) => (
          <div key={b.type.id} className="card">
            <p className="text-xs font-semibold text-muted">{b.type.name} {year}</p>
            {b.type.paid ? <p className="text-2xl font-bold">{b.available} <span className="text-sm font-normal text-muted">of {b.allowance} available</span></p> : <p className="text-sm">Unpaid, no allowance limit</p>}
            {b.pending > 0 && <p className="text-xs text-muted">{b.pending} pending approval</p>}
          </div>
        ))}
      </div>

      <form action={submit} className="card grid gap-4 sm:grid-cols-4">
        <h2 className="font-semibold sm:col-span-4">Request leave</h2>
        <div><label className="label" htmlFor="leaveTypeId">Type</label>
          <select id="leaveTypeId" name="leaveTypeId" className="input">{types.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select></div>
        <div><label className="label" htmlFor="startDate">From</label><input id="startDate" name="startDate" type="date" required className="input" /></div>
        <div><label className="label" htmlFor="endDate">To</label><input id="endDate" name="endDate" type="date" required className="input" /></div>
        <div><label className="label" htmlFor="reason">Reason</label><input id="reason" name="reason" className="input" /></div>
        <div className="sm:col-span-4"><button className="btn">Submit request</button> <span className="text-xs text-muted ml-2">Weekends are not counted. Public holidays are not configured yet.</span></div>
      </form>

      <section className="card overflow-x-auto">
        <h2 className="font-semibold mb-2">My requests</h2>
        {mine.length === 0 ? <p className="text-sm text-muted">No requests yet.</p> : (
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-muted"><tr><th className="py-2 pr-4">Type</th><th className="pr-4">Dates</th><th className="pr-4">Days</th><th className="pr-4">Status</th><th></th></tr></thead>
            <tbody>
              {mine.map((r) => (
                <tr key={r.id} className="border-t border-border">
                  <td className="py-2 pr-4">{r.leaveType.name}</td><td className="pr-4">{r.startDate} to {r.endDate}</td><td className="pr-4">{r.days.toString()}</td>
                  <td className="pr-4">{r.status}{r.decisionNote && <span className="text-xs text-muted"> · {r.decisionNote}</span>}</td>
                  <td>{(r.status === "PENDING" || r.status === "APPROVED") && <form action={cancel}><input type="hidden" name="id" value={r.id} /><button className="btn-ghost">Cancel</button></form>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {canApprove && (
        <section className="card overflow-x-auto">
          <h2 className="font-semibold mb-2">Waiting for your decision</h2>
          {approvable.length === 0 ? <p className="text-sm text-muted">Nothing to approve.</p> : approvable.map((r) => (
            <form key={r.id} action={decide} className="flex flex-wrap items-center gap-2 border-t border-border py-2 text-sm">
              <input type="hidden" name="id" value={r.id} />
              <span className="font-medium w-40">{people.get(r.userId)?.name}</span>
              <span>{r.leaveType.name}: {r.startDate} to {r.endDate} ({r.days.toString()} days)</span>
              <input name="note" placeholder="Note (optional)" aria-label="Decision note" className="input w-48" />
              <button name="decision" value="approve" className="btn">Approve</button>
              <button name="decision" value="reject" className="btn-ghost">Reject</button>
            </form>
          ))}
        </section>
      )}
    </div>
  );
}
