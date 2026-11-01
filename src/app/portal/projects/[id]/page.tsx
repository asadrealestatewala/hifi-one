import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { audit, requireClientUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { clientCommented } from "@/lib/events";
import { LedgerError } from "@/lib/ledger-math";
import { portalAddComment, portalProject } from "@/lib/portal";
import PhaseTracker from "@/components/PhaseTracker";
import { KIND_LABEL, PHASE_LABEL, clientFeed, type ProjectPhase, type UpdateKind } from "@/lib/project-updates";
import { Badge, Notice, PageHeader, StatusBadge, SubmitButton } from "@/components/ui";

export const dynamic = "force-dynamic";

async function comment(formData: FormData) {
  "use server";
  const user = await requireClientUser();
  const projectId = String(formData.get("projectId") ?? "");
  const taskId = String(formData.get("taskId") ?? "");
  try {
    const c = await portalAddComment(db, { clientId: user.clientId, userId: user.id, taskId, body: String(formData.get("body") ?? "") });
    await audit(user, { action: "portal.task_comment", entity: "Task", entityId: taskId });
    await clientCommented(db, { organizationId: user.organizationId, taskId, commentId: c.id, userId: user.id });
  } catch (e) {
    if (e instanceof LedgerError) redirect(`/portal/projects/${projectId}?error=${encodeURIComponent(e.message)}`);
    throw e;
  }
  redirect(`/portal/projects/${projectId}?sent=1#t-${taskId}`);
}

export default async function PortalProjectPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string; sent?: string }> }) {
  const user = await requireClientUser();
  const { id } = await params;
  const sp = await searchParams;
  const p = await portalProject(db, user.clientId, id);
  if (!p) notFound();
  const feed = await clientFeed(db, { clientId: user.clientId, projectId: p.id, take: 50 });
  return (
    <div className="space-y-5">
      <Link href="/portal/projects" className="text-sm text-muted hover:underline">← All projects</Link>
      <PageHeader title={p.name} subtitle={`${p.number}${p.deadline ? ` · due ${p.deadline.toLocaleDateString()}` : ""} · ${p.progress}% complete`} actions={<StatusBadge status={p.status} />} />
      {sp.error && <Notice kind="error">{sp.error}</Notice>}
      {sp.sent && <Notice kind="ok">Your message was sent to the team.</Notice>}
      <section className="card grid gap-3 text-sm sm:grid-cols-4" aria-label="Project details">
        <div><p className="text-xs font-semibold text-muted">Your project manager</p><p className="font-medium">{p.manager ? p.manager.name : "Not assigned yet"}</p>{p.manager?.employeeNo && <p className="text-xs text-muted">ID {p.manager.employeeNo}</p>}</div>
        <div><p className="text-xs font-semibold text-muted">Project</p><p className="font-medium">{p.number}</p></div>
        <div><p className="text-xs font-semibold text-muted">Started</p><p className="font-medium">{p.startDate ? p.startDate.toLocaleDateString() : "Not set"}</p></div>
        <div><p className="text-xs font-semibold text-muted">Due</p><p className="font-medium">{p.deadline ? p.deadline.toLocaleDateString() : "Not set"}</p></div>
      </section>
      {p.scope && <section className="card whitespace-pre-line text-sm">{p.scope}</section>}
      <div className="h-2 overflow-hidden rounded-full bg-hover" role="progressbar" aria-valuenow={p.progress} aria-valuemin={0} aria-valuemax={100} aria-label="Project progress"><div className="h-full rounded-full bg-primary" style={{ width: `${p.progress}%` }} /></div>
      {feed && (feed.phase || feed.updates.length > 0) && (
        <section className="card space-y-4" aria-labelledby="upd-h">
          <h2 id="upd-h" className="font-semibold">Where this project is{feed.phase ? `: ${PHASE_LABEL[feed.phase as ProjectPhase] ?? feed.phase}` : ""}</h2>
          {feed.phase && <PhaseTracker phase={feed.phase} />}
          {feed.updates.length > 0 && (
            <ul className="divide-y divide-border text-sm">
              {feed.updates.map((u) => (
                <li key={u.id} className="space-y-1 py-3 first:pt-0">
                  <div className="flex flex-wrap items-center justify-between gap-2"><p className="font-medium">{u.title}</p><Badge>{KIND_LABEL[u.kind as UpdateKind] ?? u.kind}</Badge></div>
                  {u.body && <p className="whitespace-pre-wrap text-muted">{u.body}</p>}
                  <p className="text-xs text-muted">{u.author} · {u.at.toLocaleString()}</p>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
      {p.tasks.length === 0 ? <div className="card text-sm text-muted">The team has not shared any tasks yet.</div> : p.tasks.map((t) => (
        <section key={t.id} id={`t-${t.id}`} className="card space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="font-semibold">{t.title}</h2><span className="flex items-center gap-2 text-xs text-muted">{t.dueDate && `due ${t.dueDate.toLocaleDateString()}`}<StatusBadge status={t.status} /></span></div>
          {t.comments.length > 0 && <ul className="space-y-2 text-sm">{t.comments.map((c) => <li key={c.id} className={`rounded-xl px-3 py-2 ${c.mine ? "bg-primary/10" : "bg-hover"}`}><p className="text-xs text-muted"><span className="font-medium text-foreground">{c.mine ? "You" : c.author}</span> · {c.at.toLocaleString()}</p><p className="whitespace-pre-wrap">{c.body}</p></li>)}</ul>}
          {p.status !== "COMPLETED" && (
            <form action={comment} className="flex flex-wrap gap-2">
              <input type="hidden" name="projectId" value={p.id} /><input type="hidden" name="taskId" value={t.id} />
              <label className="sr-only" htmlFor={`m-${t.id}`}>Message about {t.title}</label>
              <input id={`m-${t.id}`} name="body" required maxLength={2000} placeholder="Write to the team about this task" className="input min-w-60 flex-1" />
              <SubmitButton className="btn-ghost" pendingText="Sending…">Send</SubmitButton>
            </form>
          )}
        </section>
      ))}
    </div>
  );
}
