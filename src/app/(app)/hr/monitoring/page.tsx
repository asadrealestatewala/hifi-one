import Link from "next/link";
import { redirect } from "next/navigation";
import { audit, requirePermission } from "@/lib/auth";
import { Badge, Empty, Notice, PageHeader, Stat } from "@/components/ui";
import { db } from "@/lib/db";
import { MonitorError, decideCorrection, getPolicy, logReportAccess, summarize } from "@/lib/monitoring";

export const dynamic = "force-dynamic";
const fmt = (m: number) => `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m`;
const ISO = /^\d{4}-\d{2}-\d{2}$/;

async function decide(formData: FormData) {
  "use server";
  const user = await requirePermission("monitoring.view_team");
  const id = String(formData.get("id") ?? "");
  const approve = formData.get("approve") === "yes";
  try {
    await decideCorrection(db, { organizationId: user.organizationId, id, deciderId: user.id, approve, note: String(formData.get("note") ?? "") });
    await audit(user, { action: approve ? "monitoring.correction_approve" : "monitoring.correction_reject", entity: "TimesheetCorrection", entityId: id });
  } catch (e) {
    if (e instanceof MonitorError) redirect(`/hr/monitoring?error=${encodeURIComponent(e.message)}`);
    throw e;
  }
  redirect("/hr/monitoring");
}

export default async function Monitoring({ searchParams }: { searchParams: Promise<{ from?: string; to?: string; dept?: string; error?: string }> }) {
  const user = await requirePermission("monitoring.view_team");
  const sp = await searchParams;
  const org = user.organizationId;
  const today = new Date().toISOString().slice(0, 10);
  const to = ISO.test(sp.to ?? "") ? sp.to! : today;
  const from = ISO.test(sp.from ?? "") ? sp.from! : new Date(Date.parse(to) - 6 * 86400000).toISOString().slice(0, 10);
  const [policy, depts, people, pending] = await Promise.all([
    getPolicy(db, org),
    db.department.findMany({ where: { organizationId: org }, orderBy: { name: "asc" } }),
    db.user.findMany({ where: { organizationId: org, userType: "EMPLOYEE", active: true, ...(sp.dept ? { departmentId: sp.dept } : {}) }, select: { id: true, name: true, department: { select: { name: true } } }, orderBy: { name: "asc" } }),
    db.timesheetCorrection.findMany({ where: { organizationId: org, status: "PENDING" }, orderBy: { createdAt: "asc" }, take: 30 }),
  ]);
  const rows = await summarize(db, { organizationId: org, userIds: people.map((p) => p.id), from, to });
  const by = new Map(rows.map((r) => [r.userId, r]));
  const accepted = new Set((await db.policyAck.findMany({ where: { version: policy.version, userId: { in: people.map((p) => p.id) } }, select: { userId: true } })).map((a) => a.userId));
  await logReportAccess(db, { organizationId: org, viewerId: user.id, subjectIds: people.map((p) => p.id) });
  const names = new Map((await db.user.findMany({ where: { id: { in: pending.map((c) => c.userId) } }, select: { id: true, name: true } })).map((u) => [u.id, u.name]));
  const tot = rows.reduce((a, r) => ({ att: a.att + r.attendanceMinutes, act: a.act + r.activeMinutes, idle: a.idle + r.idleMinutes }), { att: 0, act: 0, idle: 0 });
  const canShots = user.permissions.has("monitoring.screenshots");
  const missing = people.filter((p) => accepted.has(p.id) && (by.get(p.id)?.attendanceMinutes ?? 0) === 0).length;
  return (
    <div className="space-y-6">
      <PageHeader title="Workforce activity" subtitle="Time and activity reported by people who have accepted the policy. These are context, not a verdict: weigh them with task delivery, quality reviews and agreed targets."
        actions={<>{user.permissions.has("monitoring.configure") && <Link href="/settings/monitoring" className="btn-ghost">Policy &amp; devices</Link>}{canShots && <Link href="/hr/monitoring/screenshots" className="btn-ghost">Screenshots</Link>}</>} />
      {sp.error && <Notice kind="error">{sp.error}</Notice>}
      {!policy.enabled && <Notice kind="error">Monitoring is switched off, so there is nothing new to report.</Notice>}

      <form className="card flex flex-wrap items-end gap-3">
        <div><label className="label" htmlFor="from">From</label><input id="from" name="from" type="date" defaultValue={from} className="input" /></div>
        <div><label className="label" htmlFor="to">To</label><input id="to" name="to" type="date" defaultValue={to} className="input" /></div>
        <div><label className="label" htmlFor="dept">Department</label><select id="dept" name="dept" defaultValue={sp.dept ?? ""} className="input"><option value="">All</option>{depts.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select></div>
        <button className="btn">Apply</button>
      </form>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Stat label="People" value={people.length} hint={`${accepted.size} have accepted the policy`} />
        <Stat label="Attendance" value={fmt(tot.att)} />
        <Stat label="Active" value={fmt(tot.act)} />
        <Stat label="Idle" value={fmt(tot.idle)} />
        <Stat label="No time recorded" value={missing} hint="accepted, but nothing in the range" />
      </div>

      {people.length === 0 ? <Empty title="Nobody in this view" /> : (
        <div className="card overflow-x-auto !p-0">
          <table className="w-full text-sm">
            <thead className="text-left"><tr><th className="px-4 py-3">Person</th><th className="pr-4">Attendance</th><th className="pr-4">Active</th><th className="pr-4">Idle</th><th className="pr-4">Breaks</th><th className="pr-4">Keys · clicks</th><th className="pr-4">Top applications</th><th className="pr-4">Screenshots</th><th className="pr-4">Status</th></tr></thead>
            <tbody>{people.map((p) => {
              const r = by.get(p.id);
              return (
                <tr key={p.id} className="border-t border-border transition hover:bg-hover/50">
                  <td className="px-4 py-3"><span className="font-medium">{p.name}</span><span className="block text-xs text-muted">{p.department?.name}</span></td>
                  <td className="pr-4">{fmt(r?.attendanceMinutes ?? 0)}</td><td className="pr-4">{fmt(r?.activeMinutes ?? 0)}</td><td className="pr-4">{fmt(r?.idleMinutes ?? 0)}</td><td className="pr-4">{fmt(r?.breakMinutes ?? 0)}</td>
                  <td className="pr-4 text-muted">{r?.keys ?? 0} · {r?.clicks ?? 0}</td>
                  <td className="pr-4 text-xs">{r?.topApps.length ? r.topApps.slice(0, 3).map((a) => `${a.name} ${Math.round(a.seconds / 60)}m`).join(", ") : <span className="text-muted">—</span>}</td>
                  <td className="pr-4">{r?.screenshots ? `${r.screenshots} (${(r.screenshotBytes / 1048576).toFixed(1)} MB)` : "0"}</td>
                  <td className="pr-4">{accepted.has(p.id) ? <Badge tone="success">accepted</Badge> : <Badge tone="warning">not accepted</Badge>}{r?.correctedMinutes ? <span className="ml-1"><Badge tone="primary">corrected</Badge></span> : null}</td>
                </tr>
              );
            })}</tbody>
          </table>
        </div>
      )}

      <section className="card space-y-3">
        <h2 className="font-semibold">Correction requests</h2>
        {pending.length === 0 ? <p className="text-sm text-muted">Nothing waiting.</p> : (
          <ul className="text-sm">{pending.map((c) => (
            <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 border-t border-border py-2 first:border-0">
              <span><strong>{names.get(c.userId) ?? "Someone"}</strong> · {c.day} should show {fmt(c.requestedMinutes)}<span className="block text-xs text-muted">{c.reason}</span></span>
              {c.userId === user.id ? <span className="text-xs text-muted">your own request: someone else must decide</span> : (
                <span className="flex gap-2">
                  <form action={decide}><input type="hidden" name="id" value={c.id} /><input type="hidden" name="approve" value="yes" /><button className="btn !py-1">Approve</button></form>
                  <form action={decide}><input type="hidden" name="id" value={c.id} /><input type="hidden" name="approve" value="no" /><button className="btn-ghost">Reject</button></form>
                </span>
              )}
            </li>
          ))}</ul>
        )}
      </section>
      <p className="text-xs text-muted">Opening this report is logged, and each person can see that you did. Keyboard and mouse figures are counts only; no typed content is ever collected.</p>
    </div>
  );
}
