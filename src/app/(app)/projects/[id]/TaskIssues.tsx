"use client";
// Problems reported inside a task. Anyone on the task's team reports one; the project manager resolves it with a note.
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Notice } from "@/components/ui";
import { reportIssueAction, resolveIssueAction } from "../review-actions";

export type IssueRow = { id: string; body: string; by: string; at: string; open: boolean; resolvedBy: string | null; resolvedAt: string | null; resolution: string | null };

export default function TaskIssues({ taskId, issues, canReport, canResolve }: { taskId: string; issues: IssueRow[]; canReport: boolean; canResolve: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [text, setText] = useState("");
  const [adding, setAdding] = useState(false);
  const [fixing, setFixing] = useState<string | null>(null);
  const [fix, setFix] = useState("");
  const [error, setError] = useState("");
  const run = (fn: () => Promise<{ ok: boolean; error?: string }>, after: () => void) => start(async () => {
    setError("");
    const r = await fn();
    if (!r.ok) setError(r.error ?? "Could not save."); else { after(); router.refresh(); }
  });
  const open = issues.filter((i) => i.open);
  if (issues.length === 0 && !canReport) return null;

  return (
    <section aria-labelledby="issues-title" className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 id="issues-title" className="font-semibold">Issues {open.length > 0 && <span className="ml-1 rounded-full bg-danger px-2 py-0.5 text-xs font-medium text-white">{open.length} open</span>}</h3>
        {canReport && !adding && <button type="button" className="btn-ghost !py-1 text-xs" onClick={() => setAdding(true)}>Report an issue</button>}
      </div>
      {adding && (
        <div className="space-y-2 rounded-xl border border-danger/30 p-3">
          <label className="label" htmlFor="iss-new">What is stopping you?</label>
          <textarea id="iss-new" rows={3} maxLength={2000} autoFocus value={text} onChange={(e) => setText(e.target.value)} className="input" placeholder="For example: the client has not sent the logo files yet" />
          <p className="text-xs text-muted">The project manager and management are told at once, with the time. Add screenshots under Files.</p>
          <div className="flex gap-2">
            <button type="button" className="btn" disabled={pending || text.trim().length < 3} onClick={() => run(() => reportIssueAction(taskId, text), () => { setText(""); setAdding(false); })}>{pending ? "Sending…" : "Report issue"}</button>
            <button type="button" className="btn-ghost" onClick={() => { setAdding(false); setText(""); }}>Cancel</button>
          </div>
        </div>
      )}
      {error && <Notice kind="error">{error}</Notice>}
      {issues.length === 0 ? (!adding && <p className="text-xs text-muted">No issues. If something blocks this task, report it here instead of on WhatsApp.</p>) : (
        <ul className="space-y-2">
          {issues.map((i) => (
            <li key={i.id} className={`rounded-xl border px-3 py-2 text-sm ${i.open ? "border-danger/40 bg-danger/5" : "border-border"}`}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs text-muted"><span className={`mr-1 rounded-full px-2 py-0.5 font-medium ${i.open ? "bg-danger text-white" : "bg-success/10 text-success"}`}>{i.open ? "Open" : "Resolved"}</span>{i.by} · {i.at}</span>
                {i.open && canResolve && fixing !== i.id && <button type="button" className="text-xs text-primary underline" onClick={() => { setFixing(i.id); setFix(""); }}>Resolve</button>}
              </div>
              <p className="mt-1 whitespace-pre-wrap">{i.body}</p>
              {!i.open && i.resolution && <p className="mt-1 text-xs text-muted">Resolved by {i.resolvedBy} at {i.resolvedAt}: {i.resolution}</p>}
              {fixing === i.id && (
                <div className="mt-2 space-y-2">
                  <label className="label" htmlFor={`fix-${i.id}`}>How was it solved?</label>
                  <textarea id={`fix-${i.id}`} rows={2} maxLength={2000} autoFocus value={fix} onChange={(e) => setFix(e.target.value)} className="input" />
                  <div className="flex gap-2">
                    <button type="button" className="btn" disabled={pending || fix.trim().length < 2} onClick={() => run(() => resolveIssueAction(i.id, fix), () => setFixing(null))}>Mark resolved</button>
                    <button type="button" className="btn-ghost" onClick={() => setFixing(null)}>Cancel</button>
                  </div>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
