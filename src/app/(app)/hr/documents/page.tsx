import Link from "next/link";
import { requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";
import { EMPLOYEE_DOC_CATEGORIES, employeeDocOverview } from "@/lib/employee-docs";
import { signDownload } from "@/lib/files";
import { dateInZone } from "@/lib/hr-rules";
import { Avatar, Badge, Empty, Notice, PageHeader, Stat } from "@/components/ui";
import ScreenTabs from "@/components/shell/ScreenTabs";
import ConfirmButton from "@/components/ui/ConfirmButton";
import SubmitButton from "@/components/ui/SubmitButton";
import { cancelDocumentRequestAction, requestDocumentAction, reviewDocumentAction } from "./actions";

export const dynamic = "force-dynamic";

// HR's desk for employee documents: what is waiting for a decision, who still owes what, and asking for a new one.
export default async function EmployeeDocuments({ searchParams }: { searchParams: Promise<{ error?: string; msg?: string }> }) {
  const user = await requirePermission("hr.view_sensitive");
  const sp = await searchParams;
  const org = user.organizationId;
  const canManage = user.permissions.has("hr.manage");
  const profile = await db.companyProfile.findFirst({ where: { organizationId: org, isDefault: true }, select: { timezone: true } });
  const today = dateInZone(new Date(), profile?.timezone ?? "UTC");
  const o = await employeeDocOverview(db, org, today);
  const userIds = [...new Set([...o.pendingFiles.map((f) => f.ownerId), ...o.openRequests.map((r) => r.userId)])];
  const [people, staff] = await Promise.all([
    db.employeeProfile.findMany({ where: { organizationId: org, userId: { in: userIds } }, select: { id: true, userId: true, employeeNo: true, user: { select: { name: true } } } }),
    canManage ? db.employeeProfile.findMany({ where: { organizationId: org, archivedAt: null, status: "ACTIVE" }, orderBy: { user: { name: "asc" } }, select: { userId: true, user: { select: { name: true } } } }) : Promise.resolve([]),
  ]);
  const who = new Map(people.map((p) => [p.userId, p]));
  const secret = process.env.SESSION_SECRET ?? "";
  const returnTo = "/hr/documents";
  const Person = ({ id }: { id: string }) => {
    const p = who.get(id);
    return p ? <Link href={`/hr/employees/${p.id}`} className="flex items-center gap-2 font-medium hover:underline"><Avatar name={p.user.name} userId={p.userId} size={24} />{p.user.name}</Link> : <span className="text-muted">Unknown</span>;
  };
  return (
    <div className="space-y-5">
      <PageHeader tabs={<ScreenTabs group="hr-records" current="/hr/documents" />} title="Staff directory" subtitle="Documents employees uploaded that wait for your verification, and documents you asked for that have not arrived." />
      {sp.error && <Notice kind="error">{sp.error}</Notice>}
      {sp.msg && <Notice kind="ok">{sp.msg}</Notice>}
      <div className="grid gap-3 sm:grid-cols-3">
        <Stat label="Waiting for review" value={o.pendingFiles.length} />
        <Stat label="Requests outstanding" value={o.openRequests.length} />
        <Stat label="Overdue" value={o.overdue.length} hint={o.overdue.length ? "Past the date you set" : undefined} />
      </div>

      <section className="card space-y-3">
        <h2 className="font-semibold">Waiting for your review</h2>
        {o.pendingFiles.length === 0 ? <Empty title="Nothing to review">New uploads from employees appear here until you verify or reject them.</Empty> : (
          <ul className="divide-y divide-border text-sm">
            {o.pendingFiles.map((f) => (
              <li key={f.id} className="flex flex-wrap items-center justify-between gap-3 py-2">
                <div className="flex flex-wrap items-center gap-3">
                  <Person id={f.ownerId} />
                  <span><a className="underline" href={`/api/files/${f.id}?t=${signDownload(f.id, user.id, secret)}`} target="_blank" rel="noopener">{f.filename}</a>
                    <span className="text-xs text-muted"> · {f.category ?? "no type"} · {f.createdAt.toISOString().slice(0, 10)}</span></span>
                </div>
                {canManage && (
                  <div className="flex gap-1">
                    <form action={reviewDocumentAction}><input type="hidden" name="fileId" value={f.id} /><input type="hidden" name="returnTo" value={returnTo} /><input type="hidden" name="verdict" value="verify" /><SubmitButton className="btn-ghost text-success" pendingText="Saving…">Verify</SubmitButton></form>
                    <form action={reviewDocumentAction}><input type="hidden" name="fileId" value={f.id} /><input type="hidden" name="returnTo" value={returnTo} /><input type="hidden" name="verdict" value="reject" />
                      <ConfirmButton title="Reject this document?" message="The employee is told why and asked to upload it again." confirmLabel="Reject" reason>Reject</ConfirmButton></form>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="card space-y-3">
        <h2 className="font-semibold">Requests outstanding</h2>
        {o.openRequests.length === 0 ? <Empty title="Nobody owes a document">Ask for one below and it appears here until it arrives.</Empty> : (
          <ul className="divide-y divide-border text-sm">
            {o.openRequests.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-3 py-2">
                <div className="flex flex-wrap items-center gap-3">
                  <Person id={r.userId} />
                  <span>{r.category}{r.note && <span className="text-muted"> · {r.note}</span>}</span>
                  {r.status === "REJECTED" ? <Badge tone="danger">rejected, awaiting re-upload</Badge> : r.dueOn && r.dueOn < today ? <Badge tone="danger">overdue since {r.dueOn}</Badge> : r.dueOn ? <Badge tone="warning">due {r.dueOn}</Badge> : <Badge>asked {r.createdAt.toISOString().slice(0, 10)}</Badge>}
                </div>
                {canManage && <form action={cancelDocumentRequestAction}><input type="hidden" name="requestId" value={r.id} /><input type="hidden" name="returnTo" value={returnTo} />
                  <ConfirmButton title="Withdraw this request?" message="The employee will no longer see it on My Documents." confirmLabel="Withdraw">Withdraw</ConfirmButton></form>}
              </li>
            ))}
          </ul>
        )}
      </section>

      {canManage && (
        <section className="card space-y-3">
          <h2 className="font-semibold">Ask an employee for a document</h2>
          <form action={requestDocumentAction} className="grid gap-3 sm:grid-cols-2">
            <input type="hidden" name="returnTo" value={returnTo} />
            <div><label className="label" htmlFor="req-user">Employee</label>
              <select id="req-user" name="userId" required className="input" defaultValue=""><option value="" disabled>Choose…</option>{staff.map((s) => <option key={s.userId} value={s.userId}>{s.user.name}</option>)}</select></div>
            <div><label className="label" htmlFor="req-cat">Document type</label>
              <select id="req-cat" name="category" required className="input" defaultValue=""><option value="" disabled>Choose…</option>{EMPLOYEE_DOC_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}</select></div>
            <div><label className="label" htmlFor="req-due">Needed by (optional)</label><input id="req-due" name="dueOn" type="date" className="input" /></div>
            <div><label className="label" htmlFor="req-note">Note to the employee (optional)</label><input id="req-note" name="note" className="input" placeholder="e.g. Fitness certificate from a registered doctor" maxLength={300} /></div>
            <div className="sm:col-span-2"><SubmitButton pendingText="Sending…">Send request</SubmitButton></div>
          </form>
        </section>
      )}
    </div>
  );
}
