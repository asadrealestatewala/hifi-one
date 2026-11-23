"use client";
// The review step of a task: who sent the work and how long it has waited, Approve or Revision needed for the project
// manager, "Send for review" for the person doing it, and the history of every review with its times.
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Notice } from "@/components/ui";
import WaitClock from "@/components/ui/WaitClock";
import { approveTaskAction, requestRevisionAction } from "../review-actions";
import { moveTask } from "../actions";

export type ReviewRow = { id: string; sentBy: string; sentAt: string; outcome: string | null; answeredBy: string | null; answer: string; comment: string | null; escalated: boolean };

export default function TaskReviewBox({ taskId, status, isManager, canSend, open, limitMinutes, history, revisions }: {
  taskId: string; status: string; isManager: boolean; canSend: boolean;
  open: { since: string; sentBy: string; sentAt: string; escalated: boolean } | null;
  limitMinutes: number; history: ReviewRow[]; revisions: number;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const run = (fn: () => Promise<{ ok: boolean; error?: string }>) => start(async () => {
    setError("");
    const r = await fn();
    if (!r.ok) setError(r.error ?? "Could not save."); else { setNote(""); router.refresh(); }
  });
  const past = history.filter((h) => h.outcome);
  if (status !== "REVIEW" && past.length === 0 && !(canSend && status === "IN_PROGRESS")) return null;

  return (
    <section aria-labelledby="review-title" className="space-y-3 rounded-xl border border-border p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 id="review-title" className="font-semibold">Review</h3>
        {revisions > 0 && <span className="rounded-full border border-danger/30 bg-danger/10 px-2 py-0.5 text-xs font-medium text-danger">Revision {revisions}</span>}
      </div>
      {status === "REVIEW" && open ? (
        <div className="space-y-3">
          <p className="flex flex-wrap items-center gap-2 text-sm">
            <WaitClock since={open.since} limitMinutes={limitMinutes} />
            <span className="text-muted">Sent by {open.sentBy} at {open.sentAt}.{open.escalated ? " Owners and HR have been told it is waiting." : ` The project manager has ${limitMinutes} office minutes to answer.`}</span>
          </p>
          {isManager && (
            <div className="space-y-2">
              <label className="label" htmlFor="rv-note">Comment <span className="font-normal text-muted">(needed for a revision)</span></label>
              <textarea id="rv-note" rows={2} maxLength={2000} value={note} onChange={(e) => setNote(e.target.value)} className="input" placeholder="What is good, or what needs to change" />
              <div className="flex flex-wrap gap-2">
                <button type="button" className="btn" disabled={pending} onClick={() => run(() => approveTaskAction(taskId, note))}>{pending ? "Saving…" : "Approve"}</button>
                <button type="button" className="btn-ghost !border-danger/40 !text-danger" disabled={pending || note.trim().length < 3} onClick={() => run(() => requestRevisionAction(taskId, note))}>Revision needed</button>
              </div>
            </div>
          )}
        </div>
      ) : canSend && status === "IN_PROGRESS" ? (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm text-muted">When the work or a change is ready, send it for review. The time is recorded and the project manager is told at once.</p>
          <button type="button" className="btn-ghost" disabled={pending} onClick={() => run(async () => { const r = await moveTask(taskId, "REVIEW"); return r.ok ? { ok: true } : { ok: false, error: r.error }; })}>Send for review</button>
        </div>
      ) : null}
      {error && <Notice kind="error">{error}</Notice>}
      {past.length > 0 && (
        <details className="text-sm">
          <summary className="cursor-pointer text-xs text-muted hover:text-foreground">Review history ({past.length})</summary>
          <ol className="mt-2 space-y-2">
            {past.map((h) => (
              <li key={h.id} className="rounded-lg bg-hover/50 px-3 py-2">
                <p><span className={h.outcome === "Revision needed" ? "font-medium text-danger" : h.outcome === "Approved" ? "font-medium text-success" : "font-medium"}>{h.outcome}</span>{h.answeredBy && <> by {h.answeredBy}</>} <span className="text-xs text-muted">· {h.answer}{h.escalated ? " · owners were told" : ""}</span></p>
                <p className="text-xs text-muted">Sent by {h.sentBy} at {h.sentAt}</p>
                {h.comment && <p className="mt-1 whitespace-pre-wrap">{h.comment}</p>}
              </li>
            ))}
          </ol>
        </details>
      )}
    </section>
  );
}
