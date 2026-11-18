"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { StatusBadge } from "@/components/ui";
import { STATUS_LABEL, TASK_STATUSES } from "@/lib/project-rules";
import { bulkTasksAction, type BulkActionResult } from "./actions";
import type { BulkChange } from "@/lib/task-bulk";
import type { Label } from "@/lib/task-labels";
import LabelChip from "./LabelChip";

export type ListRow = {
  id: string; title: string; projectId: string; projectName: string; assigneeId: string | null; assigneeName: string | null;
  priority: string; status: string; due: string | null; estimate: string | null; labels: Label[]; late: boolean; canManage: boolean; canMove: boolean;
};
type Person = { id: string; name: string };

const PRIORITIES = ["HIGH", "MEDIUM", "LOW"];
const label = (s: string) => s.toLowerCase().replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
const shortDate = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

// The cross-project task list. Managers edit assignee, priority and due date in place; anyone who may move a task
// changes its status in place. Ticking rows opens a bar that applies one change to all of them, and says which were skipped.
export default function TaskListTable({ rows, members, people, selectable, labels = [] }: { rows: ListRow[]; members: Record<string, Person[]>; people: Person[]; selectable: boolean; labels?: Label[] }) {
  const router = useRouter();
  const [chosen, setPicked] = useState<string[]>([]);
  // Rows that leave the list after a change (finished, deleted, filtered out) drop out of the selection too
  const picked = chosen.filter((id) => rows.some((r) => r.id === id));
  const [result, setResult] = useState<BulkActionResult | null>(null);
  const [rowError, setRowError] = useState<Record<string, string>>({});
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [pending, start] = useTransition();
  const anyManage = rows.some((r) => r.canManage);
  const all = picked.length === rows.length && rows.length > 0;

  const applyBulk = (change: BulkChange) => start(async () => {
    const r = await bulkTasksAction(picked, change);
    setResult(r); setConfirmDelete(false);
    if (r.ok) { if (change.kind === "delete") setPicked([]); router.refresh(); }
  });
  const applyOne = (id: string, change: BulkChange) => start(async () => {
    const r = await bulkTasksAction([id], change);
    const reason = !r.ok ? r.error : r.skipped[0]?.reason;
    setRowError((e) => ({ ...e, [id]: reason ?? "" }));
    if (r.ok) router.refresh();
  });
  const toggle = (id: string) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));

  return (
    <div className="space-y-3">
      {selectable && picked.length > 0 && (
        <div role="region" aria-label="Change selected tasks" className="card sticky top-2 z-10 flex flex-wrap items-center gap-2 !py-2.5 shadow-md">
          <span className="text-sm font-medium">{picked.length} selected</span>
          {anyManage && (
            <>
              <select aria-label="Assign selected tasks to" className="input !w-auto !py-1 !text-xs" disabled={pending} value="" onChange={(e) => e.target.value && applyBulk({ kind: "assign", userId: e.target.value === "none" ? null : e.target.value })}>
                <option value="">Assign to…</option>
                <option value="none">Unassigned</option>
                {people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
              <label className="flex items-center gap-1 text-xs text-muted">Due
                <input type="date" aria-label="Due date for selected tasks" className="input !w-auto !py-1 !text-xs" disabled={pending} onChange={(e) => e.target.value && applyBulk({ kind: "due", date: e.target.value })} />
              </label>
              <button type="button" className="btn-ghost !px-2 !py-1 text-xs" disabled={pending} onClick={() => applyBulk({ kind: "due", date: null })}>Clear due date</button>
              {labels.length > 0 && (
                <>
                  <select aria-label="Add a label to selected tasks" className="input !w-auto !py-1 !text-xs" disabled={pending} value="" onChange={(e) => e.target.value && applyBulk({ kind: "label", labelId: e.target.value, add: true })}>
                    <option value="">Add label…</option>{labels.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
                  </select>
                  <select aria-label="Remove a label from selected tasks" className="input !w-auto !py-1 !text-xs" disabled={pending} value="" onChange={(e) => e.target.value && applyBulk({ kind: "label", labelId: e.target.value, add: false })}>
                    <option value="">Remove label…</option>{labels.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
                  </select>
                </>
              )}
              <select aria-label="Priority for selected tasks" className="input !w-auto !py-1 !text-xs" disabled={pending} value="" onChange={(e) => e.target.value && applyBulk({ kind: "priority", value: e.target.value })}>
                <option value="">Priority…</option>{PRIORITIES.map((p) => <option key={p} value={p}>{label(p)}</option>)}
              </select>
            </>
          )}
          <select aria-label="Status for selected tasks" className="input !w-auto !py-1 !text-xs" disabled={pending} value="" onChange={(e) => e.target.value && applyBulk({ kind: "status", value: e.target.value })}>
            <option value="">Status…</option>{TASK_STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
          </select>
          {anyManage && (confirmDelete ? (
            <span className="flex items-center gap-1 text-xs">
              Delete {picked.length} task{picked.length === 1 ? "" : "s"} and their subtasks?
              <button type="button" className="btn !bg-brand !px-2 !py-1 text-xs hover:!bg-brand-dark" disabled={pending} onClick={() => applyBulk({ kind: "delete" })}>{pending ? "Deleting…" : "Yes, delete"}</button>
              <button type="button" className="btn-ghost !px-2 !py-1 text-xs" onClick={() => setConfirmDelete(false)}>Cancel</button>
            </span>
          ) : <button type="button" className="btn-ghost !px-2 !py-1 text-xs text-brand" disabled={pending} onClick={() => setConfirmDelete(true)}>Delete…</button>)}
          <button type="button" className="ml-auto text-xs text-muted underline" onClick={() => { setPicked([]); setResult(null); setConfirmDelete(false); }}>Clear selection</button>
          {pending && <span className="text-xs text-muted" aria-live="polite">Saving…</span>}
        </div>
      )}
      {result && (
        <div role="status" className={`rounded-lg border px-3 py-2 text-sm ${result.ok ? "border-border" : "border-brand/40 text-brand"}`}>
          {result.ok ? result.message : result.error}
          {result.ok && result.skipped.length > 0 && (
            <details className="mt-1 text-xs text-muted"><summary className="cursor-pointer">Why some were not changed</summary>
              <ul className="mt-1 list-disc pl-5">{result.skipped.map((s) => <li key={s.id}>{s.title || "A task"}: {s.reason}</li>)}</ul>
            </details>
          )}
        </div>
      )}
      <div className="card overflow-x-auto !p-0">
        <table className="w-full min-w-[940px] text-sm">
          <thead className="bg-hover/60 text-left text-xs text-muted">
            <tr>
              {selectable && <th className="w-10 px-4 py-2.5"><input type="checkbox" className="h-4 w-4 accent-primary" aria-label="Select all tasks on this page" checked={all} onChange={() => setPicked(all ? [] : rows.map((r) => r.id))} /></th>}
              <th className={`${selectable ? "" : "px-4"} py-2.5 pr-4`}>Task</th><th className="pr-4">Project</th><th className="pr-4">Assignee</th><th className="pr-4">Priority</th><th className="pr-4">Due</th><th className="pr-4">Hours</th><th className="pr-4">Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((t) => (
              <tr key={t.id} className={`border-t border-border transition hover:bg-hover/50 ${picked.includes(t.id) ? "bg-primary/5" : ""}`}>
                {selectable && <td className="px-4 py-2"><input type="checkbox" className="h-4 w-4 accent-primary" aria-label={`Select ${t.title}`} checked={picked.includes(t.id)} onChange={() => toggle(t.id)} /></td>}
                <td className={`${selectable ? "" : "px-4"} py-2 pr-4`}>
                  <Link href={`/projects/${t.projectId}?task=${t.id}`} className="font-medium hover:underline">{t.title}</Link>
                  {t.labels.length > 0 && <span className="mt-1 flex flex-wrap gap-1">{t.labels.map((l) => <LabelChip key={l.id} label={l} />)}</span>}
                  {rowError[t.id] && <p role="alert" className="mt-0.5 text-[11px] text-brand">{rowError[t.id]}</p>}
                </td>
                <td className="max-w-48 truncate pr-4 text-muted"><Link className="hover:underline" href={`/projects/${t.projectId}`} title={t.projectName}>{t.projectName}</Link></td>
                <td className="pr-4">
                  {t.canManage ? (
                    <select aria-label={`Assignee of ${t.title}`} className="input !w-40 !py-1 !text-xs" disabled={pending} value={t.assigneeId ?? ""} onChange={(e) => applyOne(t.id, { kind: "assign", userId: e.target.value || null })}>
                      <option value="">Unassigned</option>
                      {(members[t.projectId] ?? []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                    </select>
                  ) : t.assigneeName ?? <span className="text-muted">Unassigned</span>}
                </td>
                <td className="pr-4">
                  {t.canManage ? (
                    <select aria-label={`Priority of ${t.title}`} className="input !w-28 !py-1 !text-xs" disabled={pending} value={t.priority} onChange={(e) => applyOne(t.id, { kind: "priority", value: e.target.value })}>
                      {PRIORITIES.map((p) => <option key={p} value={p}>{label(p)}</option>)}
                    </select>
                  ) : <span className={t.priority === "HIGH" ? "font-medium text-brand" : "text-muted"}>{label(t.priority)}</span>}
                </td>
                <td className={`whitespace-nowrap pr-4 ${t.late ? "font-medium text-brand" : "text-muted"}`}>
                  {t.canManage ? (
                    <input type="date" aria-label={`Due date of ${t.title}`} className={`input !w-36 !py-1 !text-xs ${t.late ? "!border-brand/50 text-brand" : ""}`} disabled={pending} defaultValue={t.due ?? ""} key={t.due ?? "none"}
                      onBlur={(e) => { const v = e.target.value || null; if (v !== t.due) applyOne(t.id, { kind: "due", date: v }); }} />
                  ) : <>{t.due ? shortDate(t.due) : ""}{t.late ? " · overdue" : ""}</>}
                </td>
                <td className="pr-4">
                  {t.canManage ? (
                    <input inputMode="decimal" aria-label={`Estimated hours for ${t.title}`} placeholder="–" className="input !w-16 !py-1 !text-xs" disabled={pending} defaultValue={t.estimate ?? ""} key={t.estimate ?? "none"}
                      onBlur={(e) => { const v = e.target.value.trim() || null; if (v !== t.estimate) applyOne(t.id, { kind: "estimate", hours: v }); }} />
                  ) : <span className="text-muted">{t.estimate ?? ""}</span>}
                </td>
                <td className="pr-4">
                  {t.canMove ? (
                    <select aria-label={`Status of ${t.title}`} className="input !w-32 !py-1 !text-xs" disabled={pending} value={t.status} onChange={(e) => applyOne(t.id, { kind: "status", value: e.target.value })}>
                      {TASK_STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
                    </select>
                  ) : <StatusBadge status={t.status} />}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
