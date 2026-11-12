import Link from "next/link";
import { requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";
import { REQUEST_TYPES, REQUEST_TYPE_LABEL, attachmentsFor, isOpen, myRequests, type RequestType } from "@/lib/employee-requests";
import { ConfirmButton, Empty, Notice, PageHeader, StatusBadge, SubmitButton } from "@/components/ui";
import RequestAttachments from "@/components/RequestAttachments";
import { cancelRequestAction, submitRequestAction } from "./actions";

export const dynamic = "force-dynamic";

const when = (d: Date) => d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

// Any application to HR that has no form of its own: certificates, an advance, a resignation, a grievance, equipment, or anything
// else. Leave, documents, site visits and daily reports have their own pages and are linked from here instead.
export default async function MyRequests({ searchParams }: { searchParams: Promise<{ error?: string; msg?: string }> }) {
  const user = await requirePermission("self.leave");
  const sp = await searchParams;
  const mine = await myRequests(db, user.id);
  const files = await attachmentsFor(db, user.organizationId, mine.map((r) => r.id));
  const filesOf = (id: string) => files.filter((f) => f.ownerId === id);
  const open = mine.filter((r) => isOpen(r.status));
  return (
    <div className="space-y-5 max-w-5xl">
      <PageHeader title="My requests" subtitle="Write to HR about anything that has no form of its own: a salary or experience certificate, an advance, a resignation, a complaint, equipment. HR answers here and you are notified." />
      {sp.error && <Notice kind="error">{sp.error}</Notice>}
      {sp.msg && <Notice kind="ok">{sp.msg}</Notice>}
      <p className="text-sm text-muted">
        Looking for something else? <Link href="/me/leave" className="underline">Leave</Link> · <Link href="/me/documents" className="underline">Documents</Link> · <Link href="/me/visits" className="underline">Site visits and work from home</Link> · <Link href="/me/report" className="underline">Daily report</Link>
      </p>

      <form action={submitRequestAction} className="card grid gap-4 sm:grid-cols-3">
        <h2 className="font-semibold sm:col-span-3">New application</h2>
        <div><label className="label" htmlFor="type">About</label>
          <select id="type" name="type" className="input" defaultValue="SALARY_CERTIFICATE">{REQUEST_TYPES.map((t) => <option key={t} value={t}>{REQUEST_TYPE_LABEL[t]}</option>)}</select></div>
        <div className="sm:col-span-2"><label className="label" htmlFor="subject">Subject</label><input id="subject" name="subject" required minLength={3} maxLength={120} className="input" placeholder="Salary certificate for a bank account" /></div>
        <div className="sm:col-span-3"><label className="label" htmlFor="body">Application</label>
          <textarea id="body" name="body" required minLength={10} maxLength={4000} rows={5} className="input" placeholder="What you are asking for, why, and by when if it matters." /></div>
        <div className="sm:col-span-2"><label className="label" htmlFor="file">Attachment (optional: PDF, image, Word, Excel; up to 15 MB)</label>
          <input id="file" name="file" type="file" accept=".pdf,.png,.jpg,.jpeg,.gif,.webp,.docx,.xlsx,.csv,.txt" className="input" /></div>
        <div className="flex items-end"><SubmitButton pendingText="Sending…">Send to HR</SubmitButton></div>
        <p className="sm:col-span-3 text-xs text-muted">Only HR reads these; your manager does not see them. A complaint about a person is handled by HR in confidence.</p>
      </form>

      <section className="card space-y-3">
        <h2 className="font-semibold">My applications{open.length > 0 && <span className="ml-2 text-sm font-normal text-muted">{open.length} waiting for HR</span>}</h2>
        {mine.length === 0 ? <Empty title="No applications yet">Anything you send to HR from the form above is listed here with HR&apos;s answer.</Empty> : (
          <ul className="divide-y divide-border text-sm">
            {mine.map((r) => (
              <li key={r.id} className="py-3 space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{r.subject}</span>
                  <span className="text-xs text-muted">{REQUEST_TYPE_LABEL[r.type as RequestType] ?? r.type} · sent {when(r.createdAt)}</span>
                  <StatusBadge status={r.status} />
                  {isOpen(r.status) && (
                    <form action={cancelRequestAction} className="ml-auto"><input type="hidden" name="id" value={r.id} /><ConfirmButton title="Withdraw this application?" message="HR will no longer see it. You can send a new one later." confirmLabel="Withdraw">Withdraw</ConfirmButton></form>
                  )}
                </div>
                <p className="whitespace-pre-line text-muted">{r.body}</p>
                <RequestAttachments files={filesOf(r.id)} viewerId={user.id} />
                {r.responseNote && <p className="rounded-lg bg-hover/60 px-3 py-2"><span className="text-xs font-semibold text-muted">HR{r.handledAt ? `, ${when(r.handledAt)}` : ""}: </span>{r.responseNote}</p>}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
