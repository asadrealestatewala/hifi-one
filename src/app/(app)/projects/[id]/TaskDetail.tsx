"use client";

import { useRouter } from "next/navigation";
import { useMemo, useRef, useState, useTransition, type ReactNode } from "react";
import Link from "next/link";
import type { Label } from "@/lib/task-labels";
import LabelChip from "../LabelChip";
import Avatar from "@/components/ui/Avatar";
import { Notice } from "@/components/ui";
import TaskCountdown from "@/components/ui/TaskCountdown";
import type { DeadlineView } from "@/lib/task-deadline";
import { addSubtaskAction, addTaskCommentAction, moveTask, saveTaskDetailAction } from "../actions";

type Sub = { id: string; title: string; status: string };
type Comment = { id: string; authorId: string; author: string; body: string; at: string; shared: boolean; fromClient: boolean };
export type TaskDetailData = {
  id: string; title: string; status: string; description: string; priority: string; assigneeId: string; due: string; start: string; estimate: string; clientVisible: boolean; recurrence: string; labelIds: string[];
  blockedBy: string[]; parentTitle: string | null;
  dueTime: string; // "HH:MM" or "" for the end of the office day
  workEnd: string; // the office day's end, shown when no time is set
  deadline: DeadlineView | null;
  times: { assigned: string | null; started: string | null; taken: string | null }; // already written out in company time
};

const STATUS: Record<string, { label: string; cls: string }> = {
  TODO: { label: "To do", cls: "border-border bg-hover text-foreground" },
  IN_PROGRESS: { label: "In progress", cls: "border-primary/30 bg-primary/10 text-primary" },
  REVIEW: { label: "In review", cls: "border-warning/30 bg-warning/10 text-warning" },
  DONE: { label: "Done", cls: "border-success/30 bg-success/10 text-success" },
};
const PRIORITY: Record<string, string> = { LOW: "Low", MEDIUM: "Medium", HIGH: "High" };
const REPEAT: Record<string, string> = { DAILY: "Repeats daily", WEEKLY: "Repeats weekly", MONTHLY: "Repeats monthly" };
const FORM = "task-detail-form";
const nice = (d: string) => (d ? new Date(`${d}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }) : "");

// The panel for one task, in the order people use it: a summary line (status, assignee, due date, priority, timer), the description,
// "More options" for settings that are rarely changed (shown as a one-line summary while closed), then checklist, subtasks,
// comments and files. Every field saves as soon as it changes (text fields when you leave them) through the same checked action
// as before, and the panel says "Saving…" then "Saved". Files arrive as children from the server.
export default function TaskDetail({ task, subtasks, candidates, members, labels, canManageLabels, comments, canManage, canMoveSubtasks, canComment, checklist, timer, children }: {
  task: TaskDetailData; subtasks: Sub[]; candidates: { id: string; title: string }[]; members: { id: string; name: string }[]; labels: Label[]; canManageLabels: boolean; comments: Comment[];
  canManage: boolean; canMoveSubtasks: boolean; canComment: boolean; checklist?: ReactNode; timer?: ReactNode; children: ReactNode;
}) {
  const router = useRouter();
  const form = useRef<HTMLFormElement>(null);
  const [pending, start] = useTransition();
  const [error, setError] = useState("");
  const [state, setState] = useState<"idle" | "saving" | "saved">("idle");
  const [sub, setSub] = useState("");
  const [note, setNote] = useState("");
  const [share, setShare] = useState(false);
  // Values shown outside plain inputs (dates, waits for, summary) are kept here so they update before the server answers
  const [v, setV] = useState({ start: task.start, due: task.due, dueTime: task.dueTime, estimate: task.estimate, recurrence: task.recurrence, blockedBy: task.blockedBy, labelIds: task.labelIds, clientVisible: task.clientVisible });
  const run = (fn: () => Promise<{ ok: boolean; error?: string }>, after?: () => void) => start(async () => {
    setError("");
    const r = await fn();
    if (!r.ok) setError(r.error ?? "Could not save."); else { after?.(); router.refresh(); }
  });
  // Saves the whole form (all fields share it through the form attribute), after React has applied the latest change
  const save = () => setTimeout(() => {
    if (!form.current || !canManage) return;
    const fd = new FormData(form.current);
    setState("saving"); setError("");
    start(async () => {
      const r = await saveTaskDetailAction(task.id, fd);
      if (!r.ok) { setState("idle"); setError(r.error ?? "Could not save."); return; }
      setState("saved");
      router.refresh();
    });
  }, 0);
  const set = (patch: Partial<typeof v>) => { setV((x) => ({ ...x, ...patch })); save(); };
  const done = subtasks.filter((s) => s.status === "DONE").length;
  const titles = useMemo(() => new Map(candidates.map((c) => [c.id, c.title])), [candidates]);
  const overdue = task.status !== "DONE" && Boolean(task.deadline) && v.due === task.due && new Date(task.deadline!.deadline) < new Date();
  const summary = [
    v.start && `Starts ${nice(v.start)}`,
    v.estimate && `${v.estimate} h estimate`,
    v.recurrence && REPEAT[v.recurrence],
    v.blockedBy.length > 0 && `Waits for ${v.blockedBy.length} task${v.blockedBy.length === 1 ? "" : "s"}`,
    v.labelIds.length > 0 && labels.filter((l) => v.labelIds.includes(l.id)).map((l) => l.name).join(", "),
    v.clientVisible && "Visible to the client",
  ].filter(Boolean).join(" · ");

  return (
    <div className="h-full space-y-6 overflow-y-auto p-5 text-sm">
      <form id={FORM} ref={form} onSubmit={(e) => { e.preventDefault(); save(); }} />
      {task.parentTitle && <p className="text-xs text-muted">Subtask of {task.parentTitle}</p>}

      {/* Summary line: what the task is about at a glance */}
      <section aria-label="Task summary" className="space-y-3">
        <div className="grid grid-cols-2 gap-x-3 gap-y-2">
          <Field label="Status">
            <select aria-label="Status" value={task.status} disabled={!canMoveSubtasks || pending}
              onChange={(e) => run(async () => { const r = await moveTask(task.id, e.target.value); return r.ok ? { ok: true } : { ok: false, error: r.error }; })}
              className={`input !py-1.5 font-medium ${STATUS[task.status]?.cls ?? ""}`}>
              {Object.entries(STATUS).map(([k, s]) => <option key={k} value={k}>{s.label}</option>)}
            </select>
          </Field>
          <Field label="Assignee">
            <select form={FORM} name="assigneeId" aria-label="Assignee" defaultValue={task.assigneeId} disabled={!canManage} onChange={save} className="input !py-1.5">
              <option value="">Unassigned</option>{members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
          </Field>
          <Field label="Due">
            <DateField name="dueDate" label="Due date" value={v.due} disabled={!canManage} onChange={(d) => set({ due: d })} tone={overdue ? "text-brand font-medium" : ""} empty="No due date" />
            {v.due ? (
              <input type="time" form={FORM} name="dueTime" aria-label="Due time (empty means the end of the office day)" value={v.dueTime} disabled={!canManage}
                title={`Empty means the end of the office day (${task.workEnd})`} onChange={(e) => setV((x) => ({ ...x, dueTime: e.target.value }))}
                onBlur={(e) => { if (e.target.value !== task.dueTime) set({ dueTime: e.target.value }); }} className="input mt-1 !py-1 text-xs" />
            ) : <input type="hidden" form={FORM} name="dueTime" value="" />}
          </Field>
          <Field label="Priority">
            <select form={FORM} name="priority" aria-label="Priority" defaultValue={task.priority} disabled={!canManage} onChange={save} className="input !py-1.5">
              {Object.entries(PRIORITY).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
          </Field>
        </div>
        {(task.deadline || task.times.assigned) && (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
            {task.deadline && v.due === task.due && v.dueTime === task.dueTime && <TaskCountdown deadline={task.deadline.deadline} from={task.deadline.from} completedAt={task.deadline.completedAt} title={task.deadline.title} />}
            {task.deadline && <span>Due {task.deadline.title}</span>}
            {[task.times.assigned && `Assigned ${task.times.assigned}`, task.times.started && `Started ${task.times.started}`, task.times.taken].filter(Boolean).map((x) => <span key={x as string}>{x}</span>)}
          </div>
        )}
        <div className="flex min-h-8 flex-wrap items-center justify-between gap-2">
          {timer ?? <span />}
          <span role="status" aria-live="polite" className="text-xs text-muted">{state === "saving" || (pending && state !== "idle") ? "Saving…" : state === "saved" ? "Saved" : ""}</span>
        </div>
        {error && <Notice kind="error">{error}</Notice>}
      </section>

      <section className="space-y-1.5">
        <label className="label" htmlFor="td-desc">Description</label>
        <textarea id="td-desc" form={FORM} name="description" rows={3} maxLength={4000} defaultValue={task.description} readOnly={!canManage}
          placeholder={canManage ? "What needs doing, links, notes for whoever picks it up" : "No description."}
          onBlur={(e) => { if (e.target.value !== e.target.defaultValue) { e.target.defaultValue = e.target.value; save(); } }} className="input" />
      </section>

      {/* Rarely changed settings, closed by default with what is set written out */}
      <details className="group rounded-xl border border-border">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 rounded-xl px-3 py-2.5 hover:bg-hover/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
          <span className="min-w-0"><span className="font-medium">More options</span><span className="block truncate text-xs text-muted">{summary || "Start date, estimate, repeats, waits for, labels, client view"}</span></span>
          <span aria-hidden className="text-muted transition group-open:rotate-180">⌄</span>
        </summary>
        <div className="grid gap-4 border-t border-border p-3 sm:grid-cols-2">
          <Field label="Start date"><DateField name="startDate" label="Start date" value={v.start} disabled={!canManage} onChange={(d) => set({ start: d })} empty="Not set" /></Field>
          <Field label="Estimate (hours)" htmlFor="td-est">
            <input id="td-est" form={FORM} name="estimatedHours" inputMode="decimal" defaultValue={task.estimate} placeholder="e.g. 3" readOnly={!canManage}
              onBlur={(e) => { if (e.target.value !== e.target.defaultValue) { e.target.defaultValue = e.target.value; set({ estimate: e.target.value.trim() }); } }} className="input !py-1.5" />
          </Field>
          <Field label="Repeats" htmlFor="td-rep">
            <select id="td-rep" form={FORM} name="recurrence" defaultValue={task.recurrence} disabled={!canManage || Boolean(task.parentTitle)} onChange={(e) => set({ recurrence: e.target.value })} className="input !py-1.5">
              <option value="">Does not repeat</option><option value="DAILY">Daily</option><option value="WEEKLY">Weekly</option><option value="MONTHLY">Monthly</option>
            </select>
            {task.parentTitle && <input type="hidden" form={FORM} name="recurrence" value={task.recurrence} />}
          </Field>
          <Field label="Client view">
            <label className="flex items-center gap-2 py-1.5"><input type="checkbox" form={FORM} name="clientVisible" checked={v.clientVisible} disabled={!canManage} onChange={(e) => set({ clientVisible: e.target.checked })} /> Visible to the client</label>
          </Field>
          <div className="sm:col-span-2">
            <p className="label">Waits for</p>
            <WaitsFor value={v.blockedBy} titles={titles} candidates={candidates} disabled={!canManage} onChange={(ids) => set({ blockedBy: ids })} />
            <p className="mt-1 text-xs text-muted">This task can&apos;t be started or finished until these are Done.</p>
          </div>
          <div className="sm:col-span-2">
            <p className="label">Labels</p>
            {labels.length === 0 ? <p className="text-xs text-muted">No labels yet.{canManageLabels && <> <Link className="underline" href="/projects?view=tasks&labels=1">Create labels</Link> such as Copy, Design or Ads.</>}</p> : (
              <div className="flex flex-wrap gap-2">
                {labels.map((l) => {
                  const on = v.labelIds.includes(l.id);
                  return (
                    <label key={l.id} className={`flex cursor-pointer items-center gap-1.5 rounded-full border px-2 py-1 ${on ? "border-primary/50 bg-primary/5" : "border-border hover:bg-hover"}`}>
                      <input type="checkbox" className="sr-only" form={FORM} name="labelIds" value={l.id} checked={on} disabled={!canManage} onChange={() => set({ labelIds: on ? v.labelIds.filter((x) => x !== l.id) : [...v.labelIds, l.id] })} />
                      <span aria-hidden className={`text-xs ${on ? "text-primary" : "text-muted"}`}>{on ? "✓" : "+"}</span><LabelChip label={l} />
                    </label>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </details>

      {checklist}

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

      <section className="space-y-2">
        <h3 className="font-semibold">Comments {comments.length > 0 && <span className="text-xs font-normal text-muted">{comments.length}</span>}</h3>
        {comments.length === 0 ? <p className="text-muted">No comments yet.</p> : (
          <ul className="space-y-3">{comments.map((c) => <li key={c.id} className="flex gap-3"><Avatar name={c.author} userId={c.authorId} size={28} /><div className="min-w-0"><p className="text-xs text-muted"><span className="font-medium text-foreground">{c.author}</span>{c.fromClient && <span className="ml-1 rounded-full bg-primary/10 px-1.5 text-[10px] font-medium text-primary">client</span>}{c.shared && !c.fromClient && <span className="ml-1 rounded-full bg-success/10 px-1.5 text-[10px] font-medium text-success">shared with client</span>} · {c.at}</p><p className="whitespace-pre-wrap">{c.body}</p></div></li>)}</ul>
        )}
        {canComment && (
          <form onSubmit={(e) => { e.preventDefault(); const t = note; run(() => addTaskCommentAction(task.id, t, share), () => { setNote(""); setShare(false); }); }} className="space-y-2">
            <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} maxLength={4000} placeholder="Write a comment. Type @ and a name to notify a team member (internal, clients never see it)" aria-label="New comment" className="input" />
            {v.clientVisible && <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={share} onChange={(e) => setShare(e.target.checked)} /> Share this comment with the client</label>}
            <div className="flex items-center justify-between gap-2"><p className="text-xs text-muted">Team: {members.map((m) => `@${m.name}`).join(", ") || "no members yet"}</p><button className="btn-ghost" disabled={pending || !note.trim()}>Comment</button></div>
          </form>
        )}
      </section>

      {children}
    </div>
  );
}

function Field({ label, htmlFor, children }: { label: string; htmlFor?: string; children: ReactNode }) {
  return <div className="min-w-0">{htmlFor ? <label className="label" htmlFor={htmlFor}>{label}</label> : <p className="label">{label}</p>}{children}</div>;
}

// A date shown as "18 Nov 2026"; clicking opens the browser's date picker. The value travels in a hidden input of the shared form.
function DateField({ name, label, value, disabled, onChange, empty, tone = "" }: { name: string; label: string; value: string; disabled: boolean; onChange: (d: string) => void; empty: string; tone?: string }) {
  const ref = useRef<HTMLInputElement>(null);
  const open = () => { const el = ref.current; if (!el) return; try { el.showPicker(); } catch { el.focus(); el.click(); } };
  return (
    <div className="relative flex items-center gap-1">
      <input type="hidden" form={FORM} name={name} value={value} />
      <button type="button" disabled={disabled} onClick={open} aria-label={`${label}: ${value ? nice(value) : empty}. Change`} className={`input !py-1.5 text-left ${value ? tone : "text-muted"} disabled:cursor-default`}>{value ? nice(value) : empty}</button>
      {value && !disabled && <button type="button" onClick={() => onChange("")} aria-label={`Clear ${label.toLowerCase()}`} className="absolute right-2 rounded px-1 text-muted hover:text-foreground">×</button>}
      <input ref={ref} type="date" tabIndex={-1} aria-hidden value={value} onChange={(e) => onChange(e.target.value)} className="pointer-events-none absolute bottom-0 left-0 h-0 w-0 opacity-0" />
    </div>
  );
}

// The tasks this one waits for, as removable tags, and a search box to add more.
function WaitsFor({ value, titles, candidates, disabled, onChange }: { value: string[]; titles: Map<string, string>; candidates: { id: string; title: string }[]; disabled: boolean; onChange: (ids: string[]) => void }) {
  const [adding, setAdding] = useState(false);
  const [q, setQ] = useState("");
  const options = candidates.filter((c) => !value.includes(c.id) && c.title.toLowerCase().includes(q.trim().toLowerCase())).slice(0, 8);
  if (candidates.length === 0) return <p className="text-xs text-muted">No other tasks in this project to wait for.</p>;
  return (
    <div className="space-y-2">
      {value.map((id) => <input key={id} type="hidden" form={FORM} name="blockedBy" value={id} />)}
      <div className="flex flex-wrap gap-1.5">
        {value.length === 0 && !adding && <span className="text-xs text-muted">Nothing. It can start any time.</span>}
        {value.map((id) => (
          <span key={id} className="inline-flex max-w-full items-center gap-1 rounded-full border border-border bg-hover/60 py-0.5 pl-2.5 pr-1 text-xs">
            <span className="truncate">{titles.get(id) ?? "A removed task"}</span>
            {!disabled && <button type="button" onClick={() => onChange(value.filter((x) => x !== id))} aria-label={`Stop waiting for ${titles.get(id) ?? "this task"}`} className="rounded-full px-1 text-muted hover:bg-hover hover:text-foreground">×</button>}
          </span>
        ))}
      </div>
      {!disabled && (adding ? (
        <div className="space-y-1">
          <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === "Escape") { setAdding(false); setQ(""); } }} placeholder="Search tasks in this project" aria-label="Search tasks to wait for" className="input !py-1.5" />
          <ul className="max-h-48 overflow-y-auto rounded-lg border border-border" role="listbox" aria-label="Tasks">
            {options.length === 0 ? <li className="px-3 py-2 text-xs text-muted">No matching task.</li> : options.map((c) => (
              <li key={c.id}><button type="button" role="option" aria-selected={false} onClick={() => { onChange([...value, c.id]); setQ(""); setAdding(false); }} className="block w-full truncate px-3 py-1.5 text-left hover:bg-hover">{c.title}</button></li>
            ))}
          </ul>
          <button type="button" onClick={() => { setAdding(false); setQ(""); }} className="text-xs text-muted hover:underline">Cancel</button>
        </div>
      ) : (
        <button type="button" onClick={() => setAdding(true)} className="text-sm text-primary hover:underline">+ Add a task it waits for</button>
      ))}
    </div>
  );
}
