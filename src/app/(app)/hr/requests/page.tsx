import { requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";
import { REQUEST_TYPES, REQUEST_TYPE_LABEL, attachmentsFor, isOpen, requestCounts, requestsForHr, type RequestType } from "@/lib/employee-requests";
import { Avatar, Chips, ConfirmButton, Empty, Notice, PageHeader, Stat, StatusBadge, SubmitButton } from "@/components/ui";
import ScreenTabs from "@/components/shell/ScreenTabs";
import RequestAttachments from "@/components/RequestAttachments";
import { reviewRequestAction } from "./actions";

export const dynamic = "force-dynamic";

const when = (d: Date) => d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
const daysAgo = (d: Date) => Math.floor((Date.now() - d.getTime()) / 86_400_000);

// HR's inbox of employee applications: take one up, approve it or decline it with a reason. Only hr.manage sees this; managers do not,
// because a grievance may be about them.
export default async function HrRequests({ searchParams }: { searchParams: Promise<{ status?: string; type?: string; focus?: string; error?: string; msg?: string }> }) {
  const user = await requirePermission("hr.manage");
  const sp = await searchParams;
  const org = user.organizationId;
  const status = sp.status ?? "OPEN";
  const type = sp.type && (REQUEST_TYPES as readonly string[]).includes(sp.type) ? sp.type : undefined;
  const [rows, counts] = await Promise.all([requestsForHr(db, org, { status, type }), requestCounts(db, org)]);
  const [people, files] = await Promise.all([
    db.user.findMany({ where: { id: { in: [...new Set(rows.flatMap((r) => [r.userId, r.handledById].filter((x): x is string => Boolean(x))))] } }, select: { id: true, name: true } }),
    attachmentsFor(db, org, rows.map((r) => r.id)),
  ]);
  const names = new Map(people.map((p) => [p.id, p.name]));
  const filesOf = (id: string) => files.filter((f) => f.ownerId === id);
  const href = (over: { status?: string; type?: string }) => {
    const q = new URLSearchParams();
    const s = over.status ?? status; const t = "type" in over ? over.type : type;
    if (s !== "OPEN") q.set("status", s);
    if (t) q.set("type", t);
    const qs = q.toString();
    return `/hr/requests${qs ? `?${qs}` : ""}`;
  };
  const returnTo = href({}).replace("/hr/requests", "");
  const oldest = rows.find((r) => isOpen(r.status));
  return (
    <div className="space-y-5">
      <PageHeader tabs={<ScreenTabs group="hr-requests" current="/hr/requests" />} title="Requests & notices" subtitle="Applications from staff that have no form of their own: certificates, advances, resignations, complaints, equipment. Take one up so the person knows it is being looked at, then approve or decline it with a note." />
      {sp.error && <Notice kind="error">{sp.error}</Notice>}
      {sp.msg && <Notice kind="ok">{sp.msg}</Notice>}
      <div className="grid gap-3 sm:grid-cols-4">
        <Stat label="Waiting" value={counts.open} hint={oldest ? `oldest ${daysAgo(oldest.createdAt)} day${daysAgo(oldest.createdAt) === 1 ? "" : "s"}` : undefined} />
        <Stat label="In review" value={counts.inReview} />
        <Stat label="Approved" value={counts.approved} />
        <Stat label="Declined" value={counts.declined} />
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Chips current={status} items={[
          { key: "OPEN", label: "Open", count: counts.open, href: href({ status: "OPEN" }) },
          { key: "APPROVED", label: "Approved", count: counts.approved, href: href({ status: "APPROVED" }) },
          { key: "DECLINED", label: "Declined", count: counts.declined, href: href({ status: "DECLINED" }) },
          { key: "CANCELLED", label: "Withdrawn", count: counts.cancelled, href: href({ status: "CANCELLED" }) },
          { key: "ALL", label: "All", count: counts.all, href: href({ status: "ALL" }) },
        ]} />
        <form method="get" action="/hr/requests" className="flex items-center gap-2 text-sm">
          {status !== "OPEN" && <input type="hidden" name="status" value={status} />}
          <label className="label !mb-0" htmlFor="type">Type</label>
          <select id="type" name="type" className="input !w-auto !py-1" defaultValue={type ?? ""}><option value="">All types</option>{REQUEST_TYPES.map((t) => <option key={t} value={t}>{REQUEST_TYPE_LABEL[t]}</option>)}</select>
          <button className="btn-ghost">Filter</button>
        </form>
      </div>

      {rows.length === 0 ? <Empty title={status === "OPEN" ? "Nothing waiting" : "No applications here"}>{status === "OPEN" ? "New applications from staff appear here and you are notified." : "Change the filter to see other applications."}</Empty> : (
        <ul className="space-y-3">
          {rows.map((r) => (
            <li key={r.id} id={r.id} className={`card space-y-2 text-sm ${sp.focus === r.id ? "ring-2 ring-primary/40" : ""}`}>
              <div className="flex flex-wrap items-center gap-2">
                <span className="flex items-center gap-2 font-medium"><Avatar name={names.get(r.userId) ?? "?"} userId={r.userId} size={26} />{names.get(r.userId) ?? "Unknown"}</span>
                <span className="font-medium">{r.subject}</span>
                <span className="text-xs text-muted">{REQUEST_TYPE_LABEL[r.type as RequestType] ?? r.type} · sent {when(r.createdAt)}{isOpen(r.status) && daysAgo(r.createdAt) >= 3 && <strong className="text-brand"> · {daysAgo(r.createdAt)} days waiting</strong>}</span>
                <StatusBadge status={r.status} />
              </div>
              <p className="whitespace-pre-line">{r.body}</p>
              <RequestAttachments files={filesOf(r.id)} viewerId={user.id} />
              {r.responseNote && <p className="rounded-lg bg-hover/60 px-3 py-2"><span className="text-xs font-semibold text-muted">{names.get(r.handledById ?? "") ?? "HR"}{r.handledAt ? `, ${when(r.handledAt)}` : ""}: </span>{r.responseNote}</p>}
              {isOpen(r.status) && r.userId !== user.id && (
                <div className="flex flex-wrap items-center gap-2 border-t border-border pt-2">
                  {r.status === "SUBMITTED" && (
                    <form action={reviewRequestAction}><input type="hidden" name="id" value={r.id} /><input type="hidden" name="decision" value="review" /><input type="hidden" name="returnTo" value={returnTo} /><SubmitButton className="btn-ghost" pendingText="Saving…">Take up</SubmitButton></form>
                  )}
                  <form action={reviewRequestAction} className="flex items-center gap-1"><input type="hidden" name="id" value={r.id} /><input type="hidden" name="decision" value="approve" /><input type="hidden" name="returnTo" value={returnTo} /><input name="note" placeholder="Note to the employee (optional)" aria-label="Note to the employee" className="input !w-64 !py-1" maxLength={2000} /><SubmitButton className="btn" pendingText="Saving…">Approve</SubmitButton></form>
                  <form action={reviewRequestAction}><input type="hidden" name="id" value={r.id} /><input type="hidden" name="decision" value="decline" /><input type="hidden" name="returnTo" value={returnTo} /><ConfirmButton title="Decline this application?" message="The employee is told the reason you give." confirmLabel="Decline" reason>Decline</ConfirmButton></form>
                  {r.status === "IN_REVIEW" && <span className="text-xs text-muted">In review by {names.get(r.handledById ?? "") ?? "HR"}</span>}
                </div>
              )}
              {isOpen(r.status) && r.userId === user.id && <p className="text-xs text-muted">Your own application: another HR person answers it.</p>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
