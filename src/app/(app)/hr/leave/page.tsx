import { requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";
import { leaveBalances } from "@/lib/hr";
import { dateInZone } from "@/lib/hr-rules";
import { Avatar, Chips, Empty, Notice, PageHeader, StatusBadge } from "@/components/ui";
import SubmitButton from "@/components/ui/SubmitButton";
import { approveLeaveRequest, rejectLeaveRequest } from "./actions";

export const dynamic = "force-dynamic";

const STATUSES = [["pending", "Waiting"], ["approved", "Approved"], ["rejected", "Rejected"], ["all", "All"]] as const;
type Which = (typeof STATUSES)[number][0];

// HR's own leave screen: every request in the company, who asked, how much they have left, and the decision.
// A manager without attendance.view_all sees only the people who report to them, the same rule decideLeave applies.
export default async function StaffLeave({ searchParams }: { searchParams: Promise<{ show?: string; person?: string; ok?: string; error?: string }> }) {
  const user = await requirePermission("leave.approve");
  const sp = await searchParams;
  const org = user.organizationId;
  const all = user.permissions.has("attendance.view_all");
  const show: Which = (STATUSES.find(([k]) => k === sp.show)?.[0] ?? "pending") as Which;
  const profile = await db.companyProfile.findFirst({ where: { organizationId: org, isDefault: true }, select: { timezone: true } });
  const year = dateInZone(new Date(), profile?.timezone ?? "UTC").slice(0, 4);

  const people = await db.user.findMany({ where: { organizationId: org, userType: "EMPLOYEE", ...(all ? {} : { managerId: user.id }) }, select: { id: true, name: true }, orderBy: { name: "asc" } });
  const ids = people.map((p) => p.id).filter((id) => id !== user.id);
  const name = new Map(people.map((p) => [p.id, p.name]));
  const status = show === "all" ? undefined : show === "pending" ? "PENDING" : show === "approved" ? "APPROVED" : "REJECTED";
  const where = { userId: { in: sp.person && ids.includes(sp.person) ? [sp.person] : ids }, ...(status ? { status } : {}), leaveType: { organizationId: org } };
  const [rows, counts] = await Promise.all([
    db.leaveRequest.findMany({ where, orderBy: [{ status: "asc" }, { startDate: "desc" }], take: 100, include: { leaveType: true } }),
    db.leaveRequest.groupBy({ by: ["status"], where: { userId: { in: ids }, leaveType: { organizationId: org } }, _count: true }),
  ]);
  const n = new Map(counts.map((c) => [c.status, c._count]));
  const balances = new Map(await Promise.all(
    [...new Set(rows.filter((r) => r.status === "PENDING").map((r) => r.userId))].map(async (id) => [id, await leaveBalances(db, org, id, year)] as const),
  ));
  const href = (over: Record<string, string | undefined>) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries({ show: show === "pending" ? undefined : show, person: sp.person, ...over })) if (v) p.set(k, v);
    const t = p.toString();
    return `/hr/leave${t ? `?${t}` : ""}`;
  };
  const back = href({});

  return (
    <div className="space-y-5">
      <PageHeader title="Staff leave" subtitle={all ? "Every leave request in the company, with the person's balance beside it." : "Leave asked for by the people who report to you."} />
      {sp.ok && <Notice kind="ok">{sp.ok}</Notice>}
      {sp.error && <Notice kind="error">{sp.error}</Notice>}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <Chips current={show} items={STATUSES.map(([k, label]) => ({ key: k, label, count: k === "all" ? undefined : n.get(k.toUpperCase()) ?? 0, href: href({ show: k }) }))} />
        <form method="get" action="/hr/leave" className="flex items-center gap-2 text-sm">
          {show !== "pending" && <input type="hidden" name="show" value={show} />}
          <label className="sr-only" htmlFor="person">Person</label>
          <select id="person" name="person" defaultValue={sp.person ?? ""} className="input !w-auto">
            <option value="">Everyone</option>
            {people.filter((p) => p.id !== user.id).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <button className="btn-ghost">Show</button>
        </form>
      </div>

      {rows.length === 0 ? (
        <Empty title={show === "pending" ? "Nothing waiting for a decision" : "Nothing to show"}>{show === "pending" ? "Requests appear here as soon as they are sent, and you are notified." : "Try another filter."}</Empty>
      ) : (
        <div className="card !p-0 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-hover/60 text-left text-xs text-muted">
              <tr><th className="py-2 pl-4 pr-4">Person</th><th className="pr-4">Type</th><th className="pr-4">Dates</th><th className="pr-4">Days</th><th className="pr-4">Left this year</th><th className="pr-4">Status</th><th className="pr-4"></th></tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const bal = balances.get(r.userId)?.find((b) => b.type.id === r.leaveTypeId);
                return (
                  <tr key={r.id} className="border-t border-border align-top">
                    <td className="py-3 pl-4 pr-4"><span className="flex items-center gap-2"><Avatar name={name.get(r.userId) ?? "?"} userId={r.userId} size={22} />{name.get(r.userId) ?? "Unknown"}</span></td>
                    <td className="pr-4">{r.leaveType.name}{!r.leaveType.paid && <span className="text-muted"> (unpaid)</span>}</td>
                    <td className="pr-4">{r.startDate === r.endDate ? r.startDate : `${r.startDate} to ${r.endDate}`}{r.reason && <span className="block text-xs text-muted">{r.reason}</span>}</td>
                    <td className="pr-4 tabular-nums">{r.days.toString()}</td>
                    <td className="pr-4 tabular-nums">{r.status === "PENDING" ? (bal ? (bal.type.paid ? `${bal.available} of ${bal.allowance}` : "no limit") : "—") : "—"}</td>
                    <td className="pr-4"><StatusBadge status={r.status} />{r.decisionNote && <span className="block text-xs text-muted">{r.decisionNote}</span>}</td>
                    <td className="py-2 pr-4">
                      {r.status === "PENDING" && (
                        <form action={approveLeaveRequest} className="flex flex-wrap items-center gap-2">
                          <input type="hidden" name="id" value={r.id} />
                          <input type="hidden" name="back" value={back} />
                          <label className="sr-only" htmlFor={`note-${r.id}`}>Note</label>
                          <input id={`note-${r.id}`} name="note" placeholder="Note (optional)" className="input !w-40" />
                          <SubmitButton pendingText="Saving…">Approve</SubmitButton>
                          <SubmitButton formAction={rejectLeaveRequest} className="btn-ghost" pendingText="Saving…">Reject</SubmitButton>
                        </form>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
