import { db } from "@/lib/db";
import { Notice, StatusBadge, SubmitButton } from "@/components/ui";
import { deliverableAction } from "../deliverable-actions";

// What the client has to approve in this project. Drafts can be edited; a version with the client cannot change.
export default async function Deliverables({ projectId, organizationId, canManage, hasClient, closed, msg }: { projectId: string; organizationId: string; canManage: boolean; hasClient: boolean; closed: boolean; msg?: string }) {
  const rows = await db.deliverable.findMany({ where: { projectId, organizationId }, orderBy: [{ createdAt: "desc" }, { id: "asc" }] });
  if (rows.length === 0 && !canManage) return null;
  return (
    <section id="deliverables" className="card space-y-3">
      <h2 className="font-semibold">Deliverables and client approval</h2>
      {msg && <Notice kind="ok">{msg}</Notice>}
      {!hasClient && <p className="text-xs text-muted">This is an internal project, so there is no client to approve deliverables. They can still be recorded here.</p>}
      {rows.length === 0 ? <p className="text-sm text-muted">Nothing yet. Add what the client should approve: a design, a document, a staging site.</p> : (
        <ul className="divide-y divide-border text-sm">
          {rows.map((d) => (
            <li key={d.id} className="space-y-2 py-3 first:pt-0">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div><p className="font-medium">{d.title} <span className="text-xs font-normal text-muted">v{d.version}</span></p>{d.description && <p className="whitespace-pre-wrap text-muted">{d.description}</p>}{d.link && <a className="text-primary hover:underline" href={d.link} target="_blank" rel="noopener noreferrer">{d.link}</a>}</div>
                <StatusBadge status={d.status} />
              </div>
              {d.decisionNote && <p className="rounded-lg bg-hover px-3 py-2 text-xs"><span className="font-medium">Client {d.status === "APPROVED" ? "comment" : "asked for"}:</span> {d.decisionNote}</p>}
              {canManage && !closed && (d.status === "DRAFT" || d.status === "CHANGES_REQUESTED") && (
                <details>
                  <summary className="cursor-pointer text-primary">{d.status === "CHANGES_REQUESTED" ? "Make the changes and prepare a new version" : "Edit"}</summary>
                  <form action={deliverableAction} className="mt-2 grid gap-2 sm:grid-cols-2">
                    <input type="hidden" name="projectId" value={projectId} /><input type="hidden" name="id" value={d.id} /><input type="hidden" name="op" value="edit" />
                    <input name="title" defaultValue={d.title} required aria-label="Title" className="input" />
                    <input name="link" defaultValue={d.link ?? ""} placeholder="https:// link to review" aria-label="Link" className="input" />
                    <textarea name="description" defaultValue={d.description ?? ""} rows={2} aria-label="Description" className="input sm:col-span-2" />
                    <SubmitButton className="btn-ghost">Save</SubmitButton>
                  </form>
                </details>
              )}
              {canManage && !closed && d.status === "DRAFT" && hasClient && (
                <form action={deliverableAction}><input type="hidden" name="projectId" value={projectId} /><input type="hidden" name="id" value={d.id} /><input type="hidden" name="op" value="submit" /><SubmitButton pendingText="Sending…">Send to the client for approval</SubmitButton></form>
              )}
            </li>
          ))}
        </ul>
      )}
      {canManage && !closed && (
        <details>
          <summary className="cursor-pointer text-sm text-primary">Add a deliverable</summary>
          <form action={deliverableAction} className="mt-2 grid gap-2 sm:grid-cols-2">
            <input type="hidden" name="projectId" value={projectId} /><input type="hidden" name="op" value="create" />
            <input name="title" required minLength={3} placeholder="Title" aria-label="Title" className="input" />
            <input name="link" placeholder="https:// link to review (optional)" aria-label="Link" className="input" />
            <textarea name="description" rows={2} placeholder="What the client is approving" aria-label="Description" className="input sm:col-span-2" />
            <SubmitButton className="btn-ghost">Add</SubmitButton>
          </form>
        </details>
      )}
    </section>
  );
}
