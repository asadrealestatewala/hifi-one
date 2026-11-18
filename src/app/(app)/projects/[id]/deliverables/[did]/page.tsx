import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePermission, toFileActor } from "@/lib/auth";
import { db } from "@/lib/db";
import { signDownload } from "@/lib/files";
import { proofBoard } from "@/lib/proofing";
import { Badge, Notice, PageHeader, StatusBadge } from "@/components/ui";
import SubmitButton from "@/components/ui/SubmitButton";
import ProofViewer from "@/components/ProofViewer";
import { attachProofAction, resolveProofCommentAction, staffProofCommentAction } from "../../../deliverable-actions";

export const dynamic = "force-dynamic";

const OK: Record<string, string> = { attached: "Design attached. Send it to the client from the project's Updates tab when it is ready.", commented: "Comment saved.", saved: "Saved." };

// The team's view of one deliverable's proof: attach the design to a draft, read the client's pinned comments, reply and tick them off.
export default async function DeliverableProof({ params, searchParams }: { params: Promise<{ id: string; did: string }>; searchParams: Promise<{ error?: string; ok?: string; v?: string }> }) {
  const user = await requirePermission("projects.view");
  const { id, did } = await params;
  const sp = await searchParams;
  const board = await proofBoard(db, toFileActor(user), did, sp.v ? Number(sp.v) : undefined);
  if (!board || board.deliverable.projectId !== id) notFound();
  const d = board.deliverable;
  const current = board.version === d.version;
  const manager = user.permissions.has("projects.manage") || d.project.managerId === user.id;
  const canAttach = manager && current && d.status === "DRAFT";
  const open = board.comments.filter((c) => c.fromClient && !c.resolved).length;
  const hidden = { projectId: id, deliverableId: d.id };
  return (
    <div className="space-y-5">
      <Link href={`/projects/${id}?tab=updates#deliverables`} className="text-sm text-muted hover:underline">← {d.project.name}</Link>
      <PageHeader title={d.title} subtitle={`Version ${board.version}${open ? ` · ${open} client comment${open === 1 ? "" : "s"} open` : ""}`} actions={current ? <StatusBadge status={d.status} /> : <Badge>Earlier version</Badge>} />
      {sp.error && <Notice kind="error">{sp.error}</Notice>}
      {sp.ok && OK[sp.ok] && <Notice kind="ok">{OK[sp.ok]}</Notice>}
      {d.status === "CHANGES_REQUESTED" && current && <Notice kind="error">The client asked for changes{d.decisionNote ? `: ${d.decisionNote}` : "."} Use “Make the changes and prepare a new version” on the project, then attach the new design here.</Notice>}
      {board.versions.length > 1 && (
        <nav aria-label="Versions" className="flex flex-wrap gap-2 text-sm">
          {board.versions.map((v) => <Link key={v} href={`/projects/${id}/deliverables/${d.id}?v=${v}`} aria-current={v === board.version ? "page" : undefined} className={`rounded-full border px-3 py-1 ${v === board.version ? "border-primary bg-primary/10 text-primary" : "border-border hover:bg-hover"}`}>Version {v}</Link>)}
        </nav>
      )}
      {canAttach && (
        <form action={attachProofAction} className="card flex flex-wrap items-end gap-3">
          <input type="hidden" name="projectId" value={id} /><input type="hidden" name="deliverableId" value={d.id} />
          <div className="min-w-60 flex-1"><label className="label" htmlFor="proof-file">{board.file ? "Replace the design" : "Attach the design"}</label><input id="proof-file" name="file" type="file" required accept="image/png,image/jpeg,image/webp,application/pdf" className="input" /><p className="mt-1 text-xs text-muted">PNG, JPG, WebP or PDF, up to 25 MB. The client comments on it once you send it for approval.</p></div>
          <SubmitButton pendingText="Uploading…">{board.file ? "Replace" : "Attach"}</SubmitButton>
        </form>
      )}
      {board.file ? (
        <ProofViewer src={`/api/files/${board.file.id}?t=${signDownload(board.file.id, user.id, process.env.SESSION_SECRET ?? "", 3600)}`} kind={board.file.kind} name={board.file.name}
          comments={board.comments.map((c) => ({ ...c, at: c.at.toISOString() }))} hidden={hidden} comment={staffProofCommentAction} resolve={current ? resolveProofCommentAction : undefined}
          canComment={current && d.status !== "APPROVED"} commentHint={board.file.kind === "image" ? "Reply to the client, or click the design to pin a note to a spot." : "Reply to the client; name the page if it is about one page."} />
      ) : <p className="card text-sm text-muted">No design attached to this version yet.{canAttach ? " Attach it above." : ""}</p>}
    </div>
  );
}
