import { uploadFileAction } from "@/app/files/actions";
import { requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";
import { EMPLOYEE_DOC_CATEGORIES, myDocumentRequests } from "@/lib/employee-docs";
import FilesPanel from "@/components/FilesPanel";
import { Badge, PageHeader, StatusBadge } from "@/components/ui";
import SubmitButton from "@/components/ui/SubmitButton";

export const dynamic = "force-dynamic";

export default async function MyDocuments({ searchParams }: { searchParams: Promise<{ fileError?: string; fileOk?: string }> }) {
  const user = await requirePermission("self.leave");
  const { fileError, fileOk } = await searchParams;
  const [hasProfile, requests] = await Promise.all([
    db.employeeProfile.findUnique({ where: { userId: user.id } }),
    myDocumentRequests(db, user.organizationId, user.id),
  ]);
  const open = requests.filter((r) => r.status === "REQUESTED" || r.status === "REJECTED");
  const waiting = requests.filter((r) => r.status === "SUBMITTED");
  const done = requests.filter((r) => r.status === "VERIFIED");
  const today = new Date().toISOString().slice(0, 10);
  return (
    <div className="space-y-4 max-w-3xl">
      <PageHeader title="My Documents" subtitle="Your employment documents (identity, certificates, contracts, health papers). Only you and authorized HR staff can see them; your manager cannot." />
      {!hasProfile ? (
        <div className="card text-sm text-muted">You do not have an HR profile yet. Ask HR to create one.</div>
      ) : (
        <>
          {open.length > 0 && (
            <section className="card space-y-3">
              <h2 className="font-semibold">HR has asked you for {open.length === 1 ? "a document" : `${open.length} documents`}</h2>
              <ul className="divide-y divide-border text-sm">
                {open.map((r) => (
                  <li key={r.id} className="space-y-2 py-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{r.category}</span>
                      {r.status === "REJECTED" ? <Badge tone="danger">upload again</Badge> : r.dueOn && r.dueOn < today ? <Badge tone="danger">overdue</Badge> : r.dueOn ? <Badge tone="warning">needed by {r.dueOn}</Badge> : null}
                    </div>
                    {r.note && <p className="text-muted">{r.note}</p>}
                    {r.status === "REJECTED" && r.decisionNote && <p className="rounded-lg bg-brand/10 px-3 py-2 text-brand">HR: {r.decisionNote}</p>}
                    <form action={uploadFileAction} className="flex flex-wrap items-end gap-2">
                      <input type="hidden" name="ownerType" value="EMPLOYEE" /><input type="hidden" name="ownerId" value={user.id} />
                      <input type="hidden" name="requestId" value={r.id} /><input type="hidden" name="category" value={r.category} /><input type="hidden" name="returnTo" value="/me/documents" />
                      <div><label className="label" htmlFor={`req-${r.id}`}>Upload your {r.category.toLowerCase()}</label>
                        <input id={`req-${r.id}`} name="file" type="file" required accept=".pdf,.png,.jpg,.jpeg,.gif,.webp,.docx" className="input" /></div>
                      <SubmitButton pendingText="Uploading…">Send to HR</SubmitButton>
                    </form>
                  </li>
                ))}
              </ul>
            </section>
          )}
          {(waiting.length > 0 || done.length > 0) && (
            <section className="card space-y-2">
              <h2 className="font-semibold">Requests you answered</h2>
              <ul className="divide-y divide-border text-sm">
                {[...waiting, ...done].map((r) => (
                  <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                    <span>{r.category}{r.note && <span className="text-muted"> · {r.note}</span>}</span>
                    <StatusBadge status={r.status === "SUBMITTED" ? "UNDER_REVIEW" : r.status} />
                  </li>
                ))}
              </ul>
            </section>
          )}
          <FilesPanel user={user} ownerType="EMPLOYEE" ownerId={user.id} returnTo="/me/documents" title="My files" categories={EMPLOYEE_DOC_CATEGORIES} withExpiry flash={{ fileError, fileOk }} />
        </>
      )}
    </div>
  );
}
