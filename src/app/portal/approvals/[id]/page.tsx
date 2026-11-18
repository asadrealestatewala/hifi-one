import Link from "next/link";
import { notFound } from "next/navigation";
import { requireClientUser, toFileActor } from "@/lib/auth";
import { db } from "@/lib/db";
import { signDownload } from "@/lib/files";
import { proofBoard } from "@/lib/proofing";
import { Badge, Notice, PageHeader, StatusBadge } from "@/components/ui";
import ProofViewer from "@/components/ProofViewer";
import { decideAction, proofCommentAction } from "../actions";

export const dynamic = "force-dynamic";

// One design to review: comment on it (a pin on an image, a page of a PDF), then approve it or ask for changes.
export default async function PortalProof({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string; commented?: string; v?: string }> }) {
  const user = await requireClientUser();
  const { id } = await params;
  const sp = await searchParams;
  const board = await proofBoard(db, toFileActor(user), id, sp.v ? Number(sp.v) : undefined);
  if (!board) notFound();
  const d = board.deliverable;
  const current = board.version === d.version;
  const waiting = d.status === "PENDING" && current;
  const open = board.comments.filter((c) => c.fromClient && !c.resolved).length;
  return (
    <div className="space-y-5">
      <Link href="/portal/approvals" className="text-sm text-muted hover:underline">← All approvals</Link>
      <PageHeader title={d.title} subtitle={`${d.project.name} · version ${board.version}`} actions={current ? <StatusBadge status={d.status} /> : <Badge>Earlier version</Badge>} />
      {sp.error && <Notice kind="error">{sp.error}</Notice>}
      {sp.commented && <Notice kind="ok">Comment saved. Add more, then approve or ask for changes below.</Notice>}
      {d.description && <p className="whitespace-pre-wrap text-sm">{d.description}</p>}
      {board.versions.length > 1 && (
        <nav aria-label="Versions" className="flex flex-wrap gap-2 text-sm">
          {board.versions.map((v) => <Link key={v} href={`/portal/approvals/${d.id}?v=${v}`} aria-current={v === board.version ? "page" : undefined} className={`rounded-full border px-3 py-1 ${v === board.version ? "border-primary bg-primary/10 text-primary" : "border-border hover:bg-hover"}`}>Version {v}</Link>)}
        </nav>
      )}
      {board.file ? (
        <ProofViewer src={`/api/files/${board.file.id}?t=${signDownload(board.file.id, user.id, process.env.SESSION_SECRET ?? "", 3600)}`} kind={board.file.kind} name={board.file.name}
          comments={board.comments.map((c) => ({ ...c, at: c.at.toISOString() }))} hidden={{ deliverableId: d.id }} comment={proofCommentAction} canComment={waiting}
          commentHint={board.file.kind === "image" ? "Click on the design to pin your comment to a spot, or just write a general comment." : "Name the page if your comment is about one page."} />
      ) : <p className="card text-sm text-muted">There is no design file on this version. {d.link ? <a href={d.link} target="_blank" rel="noopener noreferrer" className="text-primary underline">Open it to review</a> : null}</p>}
      {waiting && (
        <form action={decideAction} className="card space-y-2">
          <input type="hidden" name="id" value={d.id} /><input type="hidden" name="from" value="proof" />
          <h2 className="font-semibold">Your decision</h2>
          <label className="label" htmlFor="note">{open ? `Note (optional: your ${open} comment${open === 1 ? "" : "s"} on the design go to the team)` : "Note (needed if you want changes)"}</label>
          <textarea id="note" name="note" rows={2} maxLength={1000} className="input" />
          <div className="flex flex-wrap gap-2">
            <button name="decision" value="approve" className="btn">Approve</button>
            <button name="decision" value="changes" className="btn-ghost">Request changes</button>
          </div>
        </form>
      )}
    </div>
  );
}
