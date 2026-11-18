"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { addChecklistItemsAction, applySavedChecklistAction, removeChecklistItemAction, saveChecklistAction, tickChecklistItemAction, type ChecklistActionResult } from "../checklist-actions";

type Item = { id: string; text: string; done: boolean; by: string | null; at: string | null };

// The checklist inside one task. The manager and the assignee tick, add and remove items; a Done task's list is locked.
// People who manage projects can save the list for reuse; anyone who can work it can add a saved list.
export default function TaskChecklist({ taskId, items, saved, canWork, canSave, taskDone }: {
  taskId: string; items: Item[]; saved: { id: string; name: string; count: number }[]; canWork: boolean; canSave: boolean; taskDone: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [text, setText] = useState("");
  const [name, setName] = useState("");
  const [optimistic, setOptimistic] = useState<Record<string, boolean>>({});
  const editable = canWork && !taskDone;
  const run = (fn: () => Promise<ChecklistActionResult>, after?: () => void) => start(async () => {
    setError(""); setMessage("");
    const r = await fn();
    if (!r.ok) { setError(r.error); setOptimistic({}); return; }
    if (r.message) setMessage(r.message);
    after?.();
    router.refresh();
  });
  const isDone = (i: Item) => optimistic[i.id] ?? i.done;
  const done = items.filter(isDone).length;

  if (!items.length && !editable) return null;
  return (
    <section className="space-y-2" aria-labelledby={`cl-${taskId}`}>
      <h3 id={`cl-${taskId}`} className="font-semibold">Checklist {items.length > 0 && <span className="text-xs font-normal text-muted">{done} of {items.length} ticked</span>}</h3>
      {items.length > 0 && <div className="h-1.5 overflow-hidden rounded-full bg-hover" role="progressbar" aria-valuenow={done} aria-valuemin={0} aria-valuemax={items.length} aria-label="Checklist progress"><div className="h-full rounded-full bg-success transition-all" style={{ width: `${Math.round((done / items.length) * 100)}%` }} /></div>}
      {error && <p role="alert" className="rounded-lg bg-brand/10 px-3 py-2 text-brand">{error}</p>}
      {message && <p className="rounded-lg bg-success/10 px-3 py-2 text-success">{message}</p>}
      {items.length === 0 ? <p className="text-xs text-muted">Break the task into steps to tick off. The task can be marked Done once every item is ticked.</p> : (
        <ul className="divide-y divide-border">
          {items.map((i) => (
            <li key={i.id} className="group flex items-center gap-3 py-1.5">
              <input type="checkbox" aria-label={i.text} checked={isDone(i)} disabled={!editable || pending}
                onChange={(e) => { const v = e.target.checked; setOptimistic((o) => ({ ...o, [i.id]: v })); run(() => tickChecklistItemAction(taskId, i.id, v), () => setOptimistic({})); }} />
              <span className={`min-w-0 flex-1 ${isDone(i) ? "text-muted line-through" : ""}`}>{i.text}</span>
              {i.done && i.by && <span className="hidden text-[11px] text-muted sm:inline" title={i.at ?? undefined}>{i.by}</span>}
              {editable && <button type="button" className="text-xs text-muted opacity-60 hover:text-brand group-hover:opacity-100" aria-label={`Remove ${i.text}`} disabled={pending} onClick={() => run(() => removeChecklistItemAction(taskId, i.id))}>Remove</button>}
            </li>
          ))}
        </ul>
      )}
      {taskDone && items.length > 0 && <p className="text-xs text-muted">This task is done, so its checklist is locked. Move it back to In progress to change it.</p>}
      {editable && (
        <div className="space-y-2">
          <form onSubmit={(e) => { e.preventDefault(); const t = text; run(() => addChecklistItemsAction(taskId, t), () => setText("")); }} className="flex gap-2">
            <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Add an item" aria-label="New checklist item" maxLength={2000} className="input" />
            <button className="btn-ghost" disabled={pending || !text.trim()}>Add</button>
          </form>
          {saved.length > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              <label htmlFor={`cl-use-${taskId}`} className="text-xs text-muted">Add a saved checklist</label>
              <select id={`cl-use-${taskId}`} className="input w-auto" value="" disabled={pending} onChange={(e) => { const v = e.target.value; if (v) run(() => applySavedChecklistAction(taskId, v)); }}>
                <option value="">Choose…</option>
                {saved.map((s) => <option key={s.id} value={s.id}>{s.name} ({s.count})</option>)}
              </select>
            </div>
          )}
        </div>
      )}
      {canSave && items.length > 0 && (
        <details className="text-xs">
          <summary className="cursor-pointer text-muted">Save this checklist for other tasks</summary>
          <form onSubmit={(e) => { e.preventDefault(); const n = name; run(() => saveChecklistAction(taskId, n), () => setName("")); }} className="mt-2 flex gap-2">
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Post QA" aria-label="Saved checklist name" maxLength={60} className="input" />
            <button className="btn-ghost" disabled={pending || name.trim().length < 2}>Save</button>
          </form>
        </details>
      )}
    </section>
  );
}
