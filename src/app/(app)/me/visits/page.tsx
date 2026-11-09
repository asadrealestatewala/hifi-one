import { requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";
import { dateInZone } from "@/lib/hr-rules";
import { VISIT_KINDS, VISIT_KIND_LABEL, describeVisit, pendingForApprover } from "@/lib/site-visits";
import { Badge, ConfirmButton, Notice, PageHeader, StatusBadge, SubmitButton } from "@/components/ui";
import { cancelSiteVisitAction, decideSiteVisitAction, requestSiteVisitAction } from "./actions";

export const dynamic = "force-dynamic";

// Ask to be out of the office for work (a site or client visit, field work, or a day from home) and follow the answer.
// Managers and HR also decide their people's requests here, the same way leave works.
export default async function MyVisits({ searchParams }: { searchParams: Promise<{ error?: string; msg?: string }> }) {
  const user = await requirePermission("self.attendance");
  const sp = await searchParams;
  const org = user.organizationId;
  const profile = await db.companyProfile.findFirst({ where: { organizationId: org, isDefault: true }, select: { timezone: true } });
  const today = dateInZone(new Date(), profile?.timezone ?? "UTC");
  const canApprove = user.permissions.has("leave.approve");
  const canPickClient = user.permissions.has("clients.view") || user.permissions.has("crm.view");
  const [mine, clients, toDecide] = await Promise.all([
    db.siteVisitRequest.findMany({ where: { userId: user.id }, orderBy: [{ startDate: "desc" }, { createdAt: "desc" }], take: 50, include: { client: { select: { name: true } } } }),
    canPickClient ? db.client.findMany({ where: { organizationId: org }, orderBy: { name: "asc" }, select: { id: true, name: true }, take: 500 }) : Promise.resolve([]),
    canApprove ? pendingForApprover(db, org, user.id, user.permissions.has("attendance.view_all")) : Promise.resolve([]),
  ]);
  const names = new Map((await db.user.findMany({ where: { id: { in: toDecide.map((r) => r.userId) } }, select: { id: true, name: true } })).map((u) => [u.id, u.name]));
  const upcoming = mine.filter((r) => r.status === "APPROVED" && r.endDate >= today);
  return (
    <div className="space-y-5 max-w-5xl">
      <PageHeader title="Site visits & field work" subtitle="Tell HR and your manager when work takes you out of the office, or when you will work from home. Approved days show on your calendar and next to your attendance." />
      {sp.error && <Notice kind="error">{sp.error}</Notice>}
      {sp.msg && <Notice kind="ok">{sp.msg}</Notice>}
      {upcoming.length > 0 && <p className="text-sm text-muted">Coming up: {upcoming.map((r) => `${r.startDate === r.endDate ? r.startDate : `${r.startDate}–${r.endDate}`} ${VISIT_KIND_LABEL[r.kind as keyof typeof VISIT_KIND_LABEL].toLowerCase()}`).join(" · ")}.</p>}

      <form action={requestSiteVisitAction} className="card grid gap-4 sm:grid-cols-4">
        <h2 className="font-semibold sm:col-span-4">New request</h2>
        <div><label className="label" htmlFor="kind">What</label>
          <select id="kind" name="kind" className="input" defaultValue="SITE_VISIT">{VISIT_KINDS.map((k) => <option key={k} value={k}>{VISIT_KIND_LABEL[k]}</option>)}</select></div>
        <div><label className="label" htmlFor="startDate">From</label><input id="startDate" name="startDate" type="date" required className="input" defaultValue={today} /></div>
        <div><label className="label" htmlFor="endDate">To (optional)</label><input id="endDate" name="endDate" type="date" className="input" /></div>
        <div className="grid grid-cols-2 gap-2"><div><label className="label" htmlFor="startTime">Start (optional)</label><input id="startTime" name="startTime" type="time" className="input" /></div><div><label className="label" htmlFor="endTime">End</label><input id="endTime" name="endTime" type="time" className="input" /></div></div>
        <div className="sm:col-span-2"><label className="label" htmlFor="location">Where (not needed for work from home)</label><input id="location" name="location" className="input" placeholder="Client office, area, or site address" maxLength={200} /></div>
        {canPickClient && <div><label className="label" htmlFor="clientId">Client (optional)</label>
          <select id="clientId" name="clientId" className="input" defaultValue=""><option value="">None</option>{clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>}
        <div className={canPickClient ? "" : "sm:col-span-2"}><label className="label" htmlFor="purpose">Why</label><input id="purpose" name="purpose" required minLength={5} maxLength={300} className="input" placeholder="Demo, installation, meeting, survey…" /></div>
        <div className="sm:col-span-4"><SubmitButton pendingText="Sending…">Send for approval</SubmitButton> <span className="ml-2 text-xs text-muted">Your manager decides; HR can decide too. Leave half-day times empty for a whole day.</span></div>
      </form>

      <section className="card overflow-x-auto">
        <h2 className="font-semibold mb-2">My requests</h2>
        {mine.length === 0 ? <p className="text-sm text-muted">No requests yet.</p> : (
          <table className="w-full text-sm">
            <thead className="bg-hover/60 text-left text-xs text-muted"><tr><th className="py-2 pr-4">When</th><th className="pr-4">What</th><th className="pr-4">Why</th><th className="pr-4">Status</th><th></th></tr></thead>
            <tbody>
              {mine.map((r) => (
                <tr key={r.id} className="border-t border-border transition hover:bg-hover/50 align-top">
                  <td className="py-2 pr-4 whitespace-nowrap">{r.startDate}{r.endDate !== r.startDate && ` to ${r.endDate}`}</td>
                  <td className="pr-4">{describeVisit(r)}</td>
                  <td className="pr-4 text-muted">{r.purpose}</td>
                  <td className="pr-4"><StatusBadge status={r.status} />{r.decisionNote && <span className="block text-xs text-muted">{r.decisionNote}</span>}</td>
                  <td>{(r.status === "PENDING" || (r.status === "APPROVED" && r.startDate >= today)) && <form action={cancelSiteVisitAction}><input type="hidden" name="id" value={r.id} /><ConfirmButton title="Cancel this request?" message="Your manager and HR will no longer see it as planned." confirmLabel="Cancel request">Cancel</ConfirmButton></form>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {canApprove && (
        <section className="card space-y-2">
          <h2 className="font-semibold">Waiting for your decision</h2>
          {toDecide.length === 0 ? <p className="text-sm text-muted">Nothing to approve.</p> : toDecide.map((r) => (
            <div key={r.id} className="flex flex-wrap items-center gap-2 border-t border-border py-2 text-sm">
              <span className="font-medium w-40">{names.get(r.userId) ?? "Unknown"}</span>
              <span>{r.startDate}{r.endDate !== r.startDate && ` to ${r.endDate}`} · {describeVisit(r)}</span>
              <span className="text-muted">{r.purpose}</span>
              <Badge tone="warning">pending</Badge>
              <form action={decideSiteVisitAction} className="flex items-center gap-1"><input type="hidden" name="id" value={r.id} /><input type="hidden" name="decision" value="approve" /><input name="note" placeholder="Note (optional)" aria-label="Decision note" className="input !w-40 !py-1" /><SubmitButton className="btn" pendingText="Saving…">Approve</SubmitButton></form>
              <form action={decideSiteVisitAction}><input type="hidden" name="id" value={r.id} /><input type="hidden" name="decision" value="reject" /><ConfirmButton title="Reject this request?" message="The employee is told why." confirmLabel="Reject" reason>Reject</ConfirmButton></form>
            </div>
          ))}
        </section>
      )}
    </div>
  );
}
