import Link from "next/link";
import { redirect } from "next/navigation";
import { audit, requireClientUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { SupportError, createRequest, portalRequests } from "@/lib/support";
import { Empty, Notice, PageHeader, StatusBadge, SubmitButton } from "@/components/ui";

export const dynamic = "force-dynamic";

async function raise(formData: FormData): Promise<void> {
  "use server";
  const user = await requireClientUser();
  let id: string;
  try {
    const r = await createRequest(db, {
      organizationId: user.organizationId, clientId: user.clientId, userId: user.id, subject: String(formData.get("subject") ?? ""), body: String(formData.get("body") ?? ""),
      priority: String(formData.get("priority") ?? "NORMAL") === "HIGH" ? "HIGH" : "NORMAL", projectId: String(formData.get("projectId") ?? "") || null,
    });
    await audit(user, { action: "portal.support_request", entity: "SupportRequest", entityId: r.id });
    id = r.id;
  } catch (e) {
    if (e instanceof SupportError) redirect(`/portal/support?new=1&error=${encodeURIComponent(e.message)}`);
    throw e;
  }
  redirect(`/portal/support/${id}`);
}

export default async function PortalSupport({ searchParams }: { searchParams: Promise<{ new?: string; error?: string }> }) {
  const user = await requireClientUser();
  const sp = await searchParams;
  const [requests, projects] = await Promise.all([portalRequests(db, user.clientId), db.project.findMany({ where: { clientId: user.clientId, status: { not: "CANCELLED" } }, select: { id: true, name: true }, orderBy: { name: "asc" } })]);
  const open = requests.filter((r) => !["RESOLVED", "CLOSED"].includes(r.status)).length;
  return (
    <div className="space-y-5">
      <PageHeader title="Support" subtitle="Ask a question or report a problem. The team answers here and you get an update when they reply." actions={<Link href="/portal/support?new=1" className="btn">New request</Link>} />
      {sp.error && <Notice kind="error">{sp.error}</Notice>}
      {sp.new && (
        <form action={raise} className="card space-y-3">
          <h2 className="font-semibold">New request</h2>
          <div><label className="label" htmlFor="s-subject">Subject</label><input id="s-subject" name="subject" required minLength={4} maxLength={160} className="input" /></div>
          <div><label className="label" htmlFor="s-body">What do you need?</label><textarea id="s-body" name="body" required minLength={10} maxLength={4000} rows={4} className="input" /></div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div><label className="label" htmlFor="s-project">About a project (optional)</label><select id="s-project" name="projectId" className="input"><option value="">Not about a project</option>{projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></div>
            <div><label className="label" htmlFor="s-pri">How urgent is it?</label><select id="s-pri" name="priority" className="input"><option value="NORMAL">Normal</option><option value="HIGH">Needs attention soon</option></select></div>
          </div>
          <div className="flex gap-2"><SubmitButton pendingText="Sending…">Send request</SubmitButton><Link href="/portal/support" className="btn-ghost">Cancel</Link></div>
        </form>
      )}
      <p className="text-sm text-muted">{open} open request{open === 1 ? "" : "s"}</p>
      {requests.length === 0 ? <Empty title="No requests yet">When you need help, use New request.</Empty> : (
        <div className="card divide-y divide-border !p-0">
          {requests.map((r) => (
            <Link key={r.id} href={`/portal/support/${r.id}`} className="flex flex-wrap items-center justify-between gap-2 px-5 py-3 text-sm transition hover:bg-hover/50">
              <span><span className="font-medium">{r.subject}</span><span className="ml-2 text-xs text-muted">{r.number}</span></span>
              <span className="flex items-center gap-3 text-xs text-muted">updated {r.updatedAt.toLocaleDateString()}<StatusBadge status={r.status} /></span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
