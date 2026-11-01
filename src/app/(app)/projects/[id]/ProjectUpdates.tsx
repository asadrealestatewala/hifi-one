import { Badge, Notice, SubmitButton } from "@/components/ui";
import PhaseTracker from "@/components/PhaseTracker";
import { projectFeed, KIND_LABEL, PHASE_LABEL, PROJECT_PHASES, UPDATE_KINDS, type ProjectPhase, type UpdateKind } from "@/lib/project-updates";
import { db } from "@/lib/db";
import { postUpdateAction, updateVisibilityAction } from "../updates-actions";

const TONE: Record<UpdateKind, "neutral" | "primary" | "success" | "warning" | "danger"> = { UPDATE: "neutral", TESTING: "primary", RELEASE: "success", BLOCKER: "danger", DECISION: "warning" };

// The project's updates feed (testing, releases, blockers, decisions) and its current phase. Entries marked for the client appear in their portal.
export default async function ProjectUpdates({ projectId, organizationId, phase, hasClient, canPost, canSetPhase, closed, msg }: {
  projectId: string; organizationId: string; phase: string | null; hasClient: boolean; canPost: boolean; canSetPhase: boolean; closed: boolean; msg?: string;
}) {
  const feed = await projectFeed(db, { organizationId, projectId, take: 50 });
  if (feed.length === 0 && !canPost && !phase) return null;
  return (
    <section id="updates" className="card space-y-4">
      <h2 className="font-semibold">Updates and phase</h2>
      {msg && <Notice kind="ok">{msg}</Notice>}
      <PhaseTracker phase={phase} />
      {!phase && <p className="text-xs text-muted">No phase set yet. {canSetPhase ? "Choose one when you post the first update." : "A project manager sets it."}</p>}
      {canPost && !closed && (
        <form action={postUpdateAction} className="grid gap-3 border-y border-border py-3 sm:grid-cols-4">
          <input type="hidden" name="projectId" value={projectId} />
          <div className="sm:col-span-2"><label className="label" htmlFor="pu-title">Title</label><input id="pu-title" name="title" required maxLength={160} className="input" placeholder="e.g. Login and signup passed testing" /></div>
          <div><label className="label" htmlFor="pu-kind">Kind</label><select id="pu-kind" name="kind" className="input">{UPDATE_KINDS.map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}</select></div>
          <div><label className="label" htmlFor="pu-phase">Phase</label><select id="pu-phase" name="phase" defaultValue={phase ?? ""} disabled={!canSetPhase && !phase} className="input">{!phase && <option value="">Not set</option>}{(canSetPhase ? PROJECT_PHASES : PROJECT_PHASES.filter((p) => p === phase)).map((p) => <option key={p} value={p}>{PHASE_LABEL[p]}</option>)}</select></div>
          <div className="sm:col-span-4"><label className="label" htmlFor="pu-body">Details (optional)</label><textarea id="pu-body" name="body" rows={3} maxLength={4000} className="input" /></div>
          <label className="flex items-center gap-2 text-sm sm:col-span-3"><input type="checkbox" name="visibleToClient" defaultChecked={hasClient} disabled={!hasClient} /> Show this to the client in their portal{!hasClient && <span className="text-xs text-muted">(internal project, no client)</span>}</label>
          <div className="flex justify-end"><SubmitButton className="btn" pendingText="Posting…">Post update</SubmitButton></div>
        </form>
      )}
      {feed.length === 0 ? <p className="text-sm text-muted">No updates yet. Post what changed, what was tested and what is blocked.</p> : (
        <ul className="divide-y divide-border text-sm">
          {feed.map((u) => (
            <li key={u.id} className="space-y-1 py-3 first:pt-0">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-medium">{u.title}</p>
                <span className="flex items-center gap-2"><Badge tone={TONE[u.kind as UpdateKind] ?? "neutral"}>{KIND_LABEL[u.kind as UpdateKind] ?? u.kind}</Badge>{u.phase && <Badge>{PHASE_LABEL[u.phase as ProjectPhase] ?? u.phase}</Badge>}<Badge tone={u.visibleToClient ? "success" : "neutral"}>{u.visibleToClient ? "Client sees" : "Internal"}</Badge></span>
              </div>
              {u.body && <p className="whitespace-pre-wrap text-muted">{u.body}</p>}
              <div className="flex flex-wrap items-center gap-3 text-xs text-muted">
                <span>{u.author} · {u.createdAt.toLocaleString()}</span>
                {canPost && hasClient && (
                  <form action={updateVisibilityAction}><input type="hidden" name="projectId" value={projectId} /><input type="hidden" name="id" value={u.id} /><input type="hidden" name="show" value={u.visibleToClient ? "0" : "1"} /><button className="text-primary hover:underline">{u.visibleToClient ? "Hide from client" : "Show to client"}</button></form>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
