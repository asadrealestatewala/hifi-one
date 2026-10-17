import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { audit, requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";
import { SUPPORT_PRIORITIES, SUPPORT_STATUSES, SupportError, assignRequest, setSupportStatus, staffReply } from "@/lib/support";
import { Badge, Notice, PageHeader, StatusBadge, SubmitButton } from "@/components/ui";

export const dynamic = "force-dynamic";

const back = (id: string, kind: "error" | "msg", m: string) => redirect(`/support/${id}?${kind}=${encodeURIComponent(m)}`);

async function reply(formData: FormData): Promise<void> {
  "use server";
  const user = await requirePermission("support.manage");
  const id = String(formData.get("id") ?? "");
  try {
    await staffReply(db, { organizationId: user.organizationId, authorId: user.id, requestId: id, body: String(formData.get("body") ?? ""), internal: formData.get("internal") === "on", status: String(formData.get("status") ?? "") || undefined });
    await audit(user, { action: "support.reply", entity: "SupportRequest", entityId: id, after: { internal: formData.get("internal") === "on" } });
  } catch (e) {
    if (e instanceof SupportError) back(id, "error", e.message);
    throw e;
  }
  back(id, "msg", "Sent.");
}

async function manage(formData: FormData): Promise<void> {
  "use server";
  const user = await requirePermission("support.manage");
  const id = String(formData.get("id") ?? "");
  try {
    const status = String(formData.get("status") ?? "");
    if (status) await setSupportStatus(db, { organizationId: user.organizationId, requestId: id, status, actorId: user.id });
    if (formData.has("assigneeId")) await assignRequest(db, { organizationId: user.organizationId, requestId: id, assigneeId: String(formData.get("assigneeId") ?? "") || null, actorId: user.id, priority: String(formData.get("priority") ?? "") || undefined });
    await audit(user, { action: "support.update", entity: "SupportRequest", entityId: id, after: { status: status || undefined } });
  } catch (e) {
    if (e instanceof SupportError) back(id, "error", e.message);
    throw e;
  }
  back(id, "msg", "Saved.");
}

export default async function SupportRequestPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string; msg?: string }> }) {
  const user = await requirePermission("support.view");
  const { id } = await params;
  const sp = await searchParams;
  const org = user.organizationId;
  const r = await db.supportRequest.findFirst({ where: { id, organizationId: org }, include: { messages: { orderBy: { createdAt: "asc" } } } });
  if (!r) notFound();
  const canManage = user.permissions.has("support.manage");
  const [client, project, staff] = await Promise.all([
    db.client.findUnique({ where: { id: r.clientId }, select: { id: true, name: true } }),
    r.projectId ? db.project.findUnique({ where: { id: r.projectId }, select: { id: true, name: true } }) : null,
    db.user.findMany({ where: { organizationId: org, userType: "EMPLOYEE", active: true }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
  ]);
  const authors = new Map((await db.user.findMany({ where: { id: { in: [...new Set(r.messages.map((m) => m.authorId))] } }, select: { id: true, name: true, clientId: true } })).map((u) => [u.id, u]));
  return (
    <div className="space-y-5">
      <Link href="/support" className="text-sm text-muted hover:underline">← All requests</Link>
      <PageHeader title={r.subject} subtitle={`${r.number} · ${client?.name ?? ""} · opened ${r.createdAt.toLocaleDateString()}`} actions={<StatusBadge status={r.status} />} />
      {sp.error && <Notice kind="error">{sp.error}</Notice>}
      {sp.msg && <Notice kind="ok">{sp.msg}</Notice>}
      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="space-y-3">
          {r.messages.map((m) => {
            const a = authors.get(m.authorId);
            return (
              <article key={m.id} className={`card space-y-1 text-sm ${m.internal ? "border-warning/40 bg-warning/5" : a?.clientId ? "bg-primary/5" : ""}`}>
                <p className="flex flex-wrap items-center gap-2 text-xs text-muted"><span className="font-medium text-foreground">{a?.name ?? "Former staff"}</span>{a?.clientId && <Badge tone="primary">client</Badge>}{m.internal && <Badge tone="warning">internal note, the client cannot see it</Badge>}<span>{m.createdAt.toLocaleString()}</span></p>
                <p className="whitespace-pre-wrap">{m.body}</p>
              </article>
            );
          })}
          {canManage && r.status !== "CLOSED" && (
            <form action={reply} className="card space-y-2">
              <input type="hidden" name="id" value={r.id} />
              <label className="label" htmlFor="sr-body">Reply</label>
              <textarea id="sr-body" name="body" required rows={4} maxLength={4000} className="input" />
              <div className="flex flex-wrap items-center gap-3">
                <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="internal" /> Internal note (not shown to the client)</label>
                <select name="status" aria-label="Set status" className="input !w-auto" defaultValue=""><option value="">Keep status</option>{SUPPORT_STATUSES.map((s) => <option key={s} value={s}>{s.toLowerCase().replace(/_/g, " ")}</option>)}</select>
                <SubmitButton pendingText="Sending…">Send</SubmitButton>
              </div>
            </form>
          )}
        </div>
        <aside className="space-y-4">
          <section className="card space-y-1 text-sm">
            <h2 className="font-semibold">Details</h2>
            <p><span className="text-muted">Client:</span> {user.permissions.has("clients.view") && client ? <Link className="hover:underline" href={`/clients/${client.id}`}>{client.name}</Link> : client?.name}</p>
            {project && <p><span className="text-muted">Project:</span> {user.permissions.has("projects.view") ? <Link className="hover:underline" href={`/projects/${project.id}`}>{project.name}</Link> : project.name}</p>}
            <p><span className="text-muted">Priority:</span> {r.priority.toLowerCase()}</p>
            {r.resolvedAt && <p><span className="text-muted">Resolved:</span> {r.resolvedAt.toLocaleDateString()}</p>}
          </section>
          {canManage && (
            <form action={manage} className="card space-y-2 text-sm">
              <h2 className="font-semibold">Manage</h2>
              <input type="hidden" name="id" value={r.id} />
              <div><label className="label" htmlFor="m-assignee">Assigned to</label><select id="m-assignee" name="assigneeId" defaultValue={r.assigneeId ?? ""} className="input"><option value="">Unassigned</option>{staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></div>
              <div><label className="label" htmlFor="m-pri">Priority</label><select id="m-pri" name="priority" defaultValue={r.priority} className="input">{SUPPORT_PRIORITIES.map((p) => <option key={p} value={p}>{p.toLowerCase()}</option>)}</select></div>
              <div><label className="label" htmlFor="m-status">Status</label><select id="m-status" name="status" defaultValue={r.status} className="input">{SUPPORT_STATUSES.map((s) => <option key={s} value={s}>{s.toLowerCase().replace(/_/g, " ")}</option>)}</select></div>
              <SubmitButton className="btn-ghost">Save</SubmitButton>
            </form>
          )}
        </aside>
      </div>
    </div>
  );
}
