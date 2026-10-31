import { redirect } from "next/navigation";
import { audit, requireClientUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { DeliverableError, decide, portalDeliverables } from "@/lib/deliverables";
import { Empty, Notice, PageHeader, StatusBadge } from "@/components/ui";

export const dynamic = "force-dynamic";

async function decideAction(formData: FormData): Promise<void> {
  "use server";
  const user = await requireClientUser();
  const id = String(formData.get("id") ?? "");
  const decision = formData.get("decision") === "approve" ? "APPROVE" : "CHANGES";
  try {
    await decide(db, { organizationId: user.organizationId, clientId: user.clientId, userId: user.id, id, decision, note: String(formData.get("note") ?? "") });
    await audit(user, { action: `portal.deliverable_${decision.toLowerCase()}`, entity: "Deliverable", entityId: id });
  } catch (e) {
    if (e instanceof DeliverableError) redirect(`/portal/approvals?error=${encodeURIComponent(e.message)}`);
    throw e;
  }
  redirect(`/portal/approvals?done=${decision === "APPROVE" ? "approved" : "changes"}`);
}

export default async function PortalApprovals({ searchParams }: { searchParams: Promise<{ error?: string; done?: string }> }) {
  const user = await requireClientUser();
  const sp = await searchParams;
  const all = await portalDeliverables(db, user.clientId);
  const pending = all.filter((d) => d.status === "PENDING");
  const history = all.filter((d) => d.status !== "PENDING");
  return (
    <div className="space-y-5">
      <PageHeader title="Approvals" subtitle="Work we need your decision on. Approve it, or tell us what to change and we will send a new version." />
      {sp.error && <Notice kind="error">{sp.error}</Notice>}
      {sp.done && <Notice kind="ok">{sp.done === "approved" ? "Thank you, it is approved." : "Thank you, we will send a new version."}</Notice>}
      {pending.length === 0 ? <Empty title="Nothing waiting for you">New items for approval appear here and in your Updates.</Empty> : pending.map((d) => (
        <section key={d.id} className="card space-y-3">
          <div className="flex flex-wrap items-start justify-between gap-2"><div><h2 className="font-semibold">{d.title}</h2><p className="text-xs text-muted">{d.projectName} · version {d.version}{d.requestedAt && ` · sent ${d.requestedAt.toLocaleDateString()}`}</p></div><StatusBadge status="PENDING" /></div>
          {d.description && <p className="whitespace-pre-wrap text-sm">{d.description}</p>}
          {d.link && <a href={d.link} target="_blank" rel="noopener noreferrer" className="btn-ghost inline-block">Open to review</a>}
          <form action={decideAction} className="space-y-2 border-t border-border pt-3">
            <input type="hidden" name="id" value={d.id} />
            <label className="label" htmlFor={`n-${d.id}`}>Comments (needed if you want changes)</label>
            <textarea id={`n-${d.id}`} name="note" rows={2} maxLength={1000} className="input" />
            <div className="flex flex-wrap gap-2">
              <button name="decision" value="approve" className="btn">Approve</button>
              <button name="decision" value="changes" className="btn-ghost">Request changes</button>
            </div>
          </form>
        </section>
      ))}
      {history.length > 0 && (
        <section className="card !p-0"><h2 className="border-b border-border px-5 py-3 font-semibold">Earlier decisions</h2>
          <ul className="divide-y divide-border text-sm">{history.map((d) => <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 px-5 py-2.5"><span>{d.title} <span className="text-xs text-muted">v{d.version} · {d.projectName}{d.decidedAt && ` · ${d.decidedAt.toLocaleDateString()}`}</span>{d.decisionNote && <span className="block text-xs text-muted">“{d.decisionNote}”</span>}</span><StatusBadge status={d.status} /></li>)}</ul>
        </section>
      )}
    </div>
  );
}
