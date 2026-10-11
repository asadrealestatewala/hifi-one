import Link from "next/link";
import { requirePermission } from "@/lib/auth";
import { METRICS, salesDashboard, type Metric } from "@/lib/crm";
import { db } from "@/lib/db";
import { formatMoney } from "@/lib/money";
import { Badge, Empty, Notice, PageHeader, Progress, Stat } from "@/components/ui";
import { setTargetAction, verifyAction } from "../../leads/crm-actions";

export const dynamic = "force-dynamic";

const LABEL: Record<Metric, string> = { CALLS: "Calls made", CONNECTED_CALLS: "Connected calls", EMAILS: "Emails", MEETINGS: "Meetings", FOLLOW_UPS: "Follow-ups", PROPOSALS: "Proposals", CONVERSIONS: "Conversions" };

export default async function SalesActivity({ searchParams }: { searchParams: Promise<{ error?: string; msg?: string }> }) {
  const user = await requirePermission("crm.view");
  const sp = await searchParams;
  const manager = user.permissions.has("crm.view_all");
  const org = user.organizationId;
  const rows = await salesDashboard(db, { organizationId: org, userIds: manager ? null : [user.id] });
  const active = rows;
  const totals = active.reduce((a, r) => ({ calls: a.calls + r.today.CALLS, connected: a.connected + r.today.CONNECTED_CALLS, pending: a.pending + r.today.connectedPending, overdue: a.overdue + r.overdueFollowUps, conv: a.conv + r.month.CONVERSIONS }), { calls: 0, connected: 0, pending: 0, overdue: 0, conv: 0 });
  const unverified = manager ? await db.leadActivity.findMany({ where: { kind: "CALL", outcome: "CONNECTED", verified: false, lead: { organizationId: org }, createdAt: { gte: new Date(Date.now() - 7 * 86400000) } }, orderBy: { createdAt: "desc" }, take: 25, include: { lead: { select: { id: true, name: true } } } }) : [];
  const names = new Map(rows.map((r) => [r.userId, r.name]));
  const staff = manager ? await db.user.findMany({ where: { organizationId: org, userType: "EMPLOYEE", active: true }, orderBy: { name: "asc" }, select: { id: true, name: true } }) : [];
  return (
    <div className="space-y-6">
      <PageHeader title="Sales activity" subtitle="Today and this month against each person's targets. Only connected calls that a manager has verified count as connected." actions={<Link href="/leads/lists" className="btn-ghost">Smart lists</Link>} />
      {sp.error && <Notice kind="error">{sp.error}</Notice>}
      {sp.msg && <Notice kind="ok">{sp.msg}</Notice>}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Stat label="Calls today" value={totals.calls} />
        <Stat label="Connected (verified)" value={totals.connected} hint={totals.pending > 0 ? `${totals.pending} waiting for verification` : undefined} />
        <Stat label="Overdue follow-ups" value={totals.overdue} />
        <Stat label="Conversions this month" value={totals.conv} />
        <Stat label="People" value={active.length} />
      </div>

      {active.length === 0 ? <Empty title="No sales activity yet">Log calls, emails and meetings from a lead&apos;s page.</Empty> : (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left"><tr><th className="py-2 pr-4">#</th><th className="pr-4">Person</th>{(["CALLS", "CONNECTED_CALLS", "EMAILS", "MEETINGS"] as Metric[]).map((m) => <th key={m} className="pr-4">{LABEL[m]} today</th>)}<th className="pr-4">Conversions (month)</th><th className="pr-4">Overdue</th><th className="pr-4">Open pipeline</th><th>30-day conversion</th></tr></thead>
            <tbody>{active.map((r, i) => (
              <tr key={r.userId} className="border-t border-border transition hover:bg-hover/50">
                <td className="py-2 pr-4 text-muted">{i + 1}</td><td className="pr-4 font-medium">{r.name}</td>
                {(["CALLS", "CONNECTED_CALLS", "EMAILS", "MEETINGS"] as Metric[]).map((m) => <td key={m} className="pr-4"><Progress value={r.today[m]} max={r.targets[m].daily} /></td>)}
                <td className="pr-4"><Progress value={r.month.CONVERSIONS} max={r.targets.CONVERSIONS.monthly} /></td>
                <td className="pr-4">{r.overdueFollowUps > 0 ? <Badge tone="danger">{r.overdueFollowUps}</Badge> : <span className="text-muted">0</span>}</td>
                <td className="pr-4">{r.pipeline.length === 0 ? <span className="text-muted">none</span> : r.pipeline.map((p) => <span key={p.currency} className="block">{formatMoney(p.value, p.currency)} <span className="text-xs text-muted">({p.count})</span></span>)}</td>
                <td>{r.conversionRate30d === null ? <span className="text-muted">n/a</span> : `${r.conversionRate30d}%`}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}

      {manager && (
        <>
          <section className="card space-y-3">
            <h2 className="font-semibold">Calls waiting for verification</h2>
            {unverified.length === 0 ? <p className="text-sm text-muted">Nothing waiting.</p> : (
              <ul className="text-sm">{unverified.map((a) => (
                <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 border-t border-border py-2 first:border-0">
                  <span><Link className="font-medium hover:underline" href={`/leads/${a.lead.id}`}>{a.lead.name}</Link> · {names.get(a.actorId ?? "") ?? "Someone"} · {a.createdAt.toLocaleString()}{a.body && <span className="block text-xs text-muted">{a.body}</span>}</span>
                  {a.actorId === user.id ? <span className="text-xs text-muted">your own call: another manager must verify</span> : <form action={verifyAction}><input type="hidden" name="activityId" value={a.id} /><button className="btn-ghost">Verify</button></form>}
                </li>
              ))}</ul>
            )}
            <p className="text-xs text-muted">Verify only when you have evidence the call connected, such as a call recording, the phone log or the client confirming. With a telephony integration this step would be automatic.</p>
          </section>
          <form action={setTargetAction} className="card grid gap-3 sm:grid-cols-5 items-end">
            <h2 className="font-semibold sm:col-span-5">Set a target</h2>
            <div><label className="label" htmlFor="t-user">Person</label><select id="t-user" name="userId" required className="input"><option value="">Choose…</option>{staff.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select></div>
            <div><label className="label" htmlFor="t-metric">Activity</label><select id="t-metric" name="metric" className="input">{METRICS.map((m) => <option key={m} value={m}>{LABEL[m]}</option>)}</select></div>
            <div><label className="label" htmlFor="t-daily">Per day</label><input id="t-daily" name="daily" inputMode="numeric" placeholder="e.g. 80" className="input" /></div>
            <div><label className="label" htmlFor="t-month">Per month</label><input id="t-month" name="monthly" inputMode="numeric" className="input" /></div>
            <button className="btn-ghost">Save target</button>
            <p className="sm:col-span-5 text-xs text-muted">Leave both boxes empty to remove a target.</p>
          </form>
        </>
      )}
    </div>
  );
}
