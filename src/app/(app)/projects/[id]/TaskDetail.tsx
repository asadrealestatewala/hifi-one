"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition, type ReactNode } from "react";
import { StatusBadge } from "@/components/ui";
import Avatar from "@/components/ui/Avatar";
import { addSubtaskAction, addTaskCommentAction, moveTask, saveTaskDetailAction } from "../actions";

type Sub = { id: string; title: string; status: string };
type Comment = { id: string; authorId: string; author: string; body: string; at: string; shared: boolean; fromClient: boolean };
export type TaskDetailData = {
  id: string; title: string; status: string; description: string; priority: string; assigneeId: string; due: string; clientVisible: boolean; recurrence: string;
  blockedBy: string[]; parentTitle: string | null;
};

// The panel for one task: details, what it waits for, whether it repeats, subtasks, comments and files (files arrive as children from the server).
export default function TaskDetail({ task, subtasks, candidates, members, comments, canManage, canMoveSubtasks, canComment, children }: {
  task: TaskDetailData; subtasks: Sub[]; candidates: { id: string; title: string }[]; members: { id: string; name: string }[]; comments: Comment[];
  canManage: boolean; canMoveSubtasks: boolean; canComment: boolean; children: ReactNode;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [sub, setSub] = useState("");
  const [note, setNote] = useState("");
  const [share, setShare] = useState(false);
  const run = (fn: () => Promise<{ ok: boolean; error?: string }>, after?: () => void) => start(async () => {
    setError(""); setSaved(false);
    const r = await fn();
    if (!r.ok) setError(r.error ?? "Could not save."); else { after?.(); router.refresh(); }
  });
  const done = subtasks.filter((s) => s.status === "DONE").length;

  return (
    <div className="h-full space-y-6 overflow-y-auto p-5 text-sm">
      {task.parentTitle && <p className="text-xs text-muted">Subtask of {task.parentTitle}</p>}
      <div className="flex flex-wrap items-center gap-2"><StatusBadge status={task.status} />{task.recurrence && <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary">repeats {task.recurrence.toLowerCase()}</span>}</div>
      {error && <p role="alert" className="rounded-lg bg-brand/10 px-3 py-2 text-brand">{error}</p>}
      {saved && <p className="rounded-lg bg-success/10 px-3 py-2 text-success">Saved.</p>}

      <form onSubmit={(e) => { e.preventDefault(); const fd = new FormData(e.currentTarget); run(() => saveTaskDetailAction(task.id, fd), () => setSaved(true)); }} className="space-y-3">
        <fieldset disabled={!canManage || pending} className="grid gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2"><label className="label" htmlFor="td-desc">Description</label><textarea id="td-desc" name="description" rows={3} maxLength={4000} defaultValue={task.description} className="input" /></div>
          <div><label className="label" htmlFor="td-as">Assignee</label><select id="td-as" name="assigneeId" defaultValue={task.assigneeId} className="input"><option value="">Unassigned</option>{members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</select></div>
          <div><label className="label" htmlFor="td-pr">Priority</label><select id="td-pr" name="priority" defaultValue={task.priority} className="input">{["LOW", "MEDIUM", "HIGH"].map((p) => <option key={p}>{p}</option>)}</select></div>
          <div><label className="label" htmlFor="td-due">Due date</label><input id="td-due" name="dueDate" type="date" defaultValue={task.due} className="input" /></div>
          <div><label className="label" htmlFor="td-rep">Repeats</label><select id="td-rep" name="recurrence" defaultValue={task.recurrence} className="input" disabled={Boolean(task.parentTitle)}><option value="">Does not repeat</option><option value="DAILY">Daily</option><option value="WEEKLY">Weekly</option><option value="MONTHLY">Monthly</option></select></div>
          <div className="sm:col-span-2">
            <p className="label">Waits for</p>
            {candidates.length === 0 ? <p className="text-xs text-muted">No other tasks to wait for.</p> : (
              <div className="grid max-h-40 gap-1 overflow-y-auto rounded-xl border border-border p-2 sm:grid-cols-2">{candidates.map((c) => <label key={c.id} className="flex items-center gap-2 rounded-lg px-2 py-1 hover:bg-hover"><input type="checkbox" name="blockedBy" value={c.id} defaultChecked={task.blockedBy.includes(c.id)} /><span className="truncate">{c.title}</span></label>)}</div>
            )}
            <p className="mt-1 text-xs text-muted">This task cannot be started or finished until the ones ticked here are Done.</p>
          </div>
          <label className="flex items-center gap-2 sm:col-span-2"><input type="checkbox" name="clientVisible" defaultChecked={task.clientVisible} /> Visible to the client</label>
        </fieldset>
        {canManage && <div className="flex justify-end"><button className="btn" disabled={pending}>{pending ? "Saving…" : "Save details"}</button></div>}
      </form>

      {!task.parentTitle && (
        <section className="space-y-2">
          <h3 className="font-semibold">Subtasks {subtasks.length > 0 && <span className="text-xs font-normal text-muted">{done} of {subtasks.length} done</span>}</h3>
          {subtasks.length > 0 && <div className="h-1.5 overflow-hidden rounded-full bg-hover"><div className="h-full rounded-full bg-primary transition-all" style={{ width: `${Math.round((done / subtasks.length) * 100)}%` }} /></div>}
          <ul className="divide-y divide-border">
            {subtasks.map((s) => (
              <li key={s.id} className="flex items-center gap-3 py-1.5">
                <input type="checkbox" aria-label={`${s.title} done`} checked={s.status === "DONE"} disabled={!canMoveSubtasks || pending} onChange={(e) => run(async () => { const r = await moveTask(s.id, e.target.checked ? "DONE" : "TODO"); return r.ok ? { ok: true } : { ok: false, error: r.error }; })} />
                <span className={s.status === "DONE" ? "text-muted line-through" : ""}>{s.title}</span>
              </li>
            ))}
          </ul>
          {canManage && (
            <form onSubmit={(e) => { e.preventDefault(); const t = sub; run(() => addSubtaskAction(task.id, t), () => setSub("")); }} className="flex gap-2">
              <input value={sub} onChange={(e) => setSub(e.target.value)} placeholder="Add a subtask" aria-label="New subtask" maxLength={200} className="input" />
              <button className="btn-ghost" disabled={pending || sub.trim().length < 2}>Add</button>
            </form>
          )}
        </section>
      )}

      {children}

      <section className="space-y-2">
        <h3 className="font-semibold">Comments</h3>
        {comments.length === 0 ? <p className="text-muted">No comments yet.</p> : (
          <ul className="space-y-3">{comments.map((c) => <li key={c.id} className="flex gap-3"><Avatar name={c.author} userId={c.authorId} size={28} /><div className="min-w-0"><p className="text-xs text-muted"><span className="font-medium text-foreground">{c.author}</span>{c.fromClient && <span className="ml-1 rounded-full bg-primary/10 px-1.5 text-[10px] font-medium text-primary">client</span>}{c.shared && !c.fromClient && <span className="ml-1 rounded-full bg-success/10 px-1.5 text-[10px] font-medium text-success">shared with client</span>} · {c.at}</p><p className="whitespace-pre-wrap">{c.body}</p></div></li>)}</ul>
        )}
        {canComment && (
          <form onSubmit={(e) => { e.preventDefault(); const t = note; run(() => addTaskCommentAction(task.id, t, share), () => { setNote(""); setShare(false); }); }} className="space-y-2">
            <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} maxLength={4000} placeholder="Write a comment. Type @ and a name to notify a team member (internal, clients never see it)" aria-label="New comment" className="input" />
            {task.clientVisible && <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={share} onChange={(e) => setShare(e.target.checked)} /> Share this comment with the client</label>}
            <div className="flex items-center justify-between gap-2"><p className="text-xs text-muted">Team: {members.map((m) => `@${m.name}`).join(", ") || "no members yet"}</p><button className="btn-ghost" disabled={pending || !note.trim()}>Comment</button></div>
          </form>
        )}
      </section>
    </div>
  );
}
