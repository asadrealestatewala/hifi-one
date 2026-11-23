"use client";

import Link from "next/link";
import Avatar from "@/components/ui/Avatar";
import { useState, useTransition } from "react";
import { moveTask } from "../actions";
import { STATUS_LABEL, TASK_STATUSES } from "@/lib/project-rules";
import { Notice } from "@/components/ui";
import type { Label } from "@/lib/task-labels";
import LabelChip from "../LabelChip";
import TaskCountdown from "@/components/ui/TaskCountdown";
import type { DeadlineView } from "@/lib/task-deadline";

type T = {
  id: string; title: string; status: string; priority: string; assignee: string | null; assigneeId: string | null;
  due: string | null; overdue: boolean; subDone: number; subTotal: number; checkDone: number; checkTotal: number; waitingFor: string[]; recurrence: string | null; href: string; labelIds: string[];
  deadline: DeadlineView | null;
};

export default function TaskBoard({ tasks: initial, canMove, userId, isManager, labels = [] }: { tasks: T[]; canMove: boolean; userId: string; isManager: boolean; labels?: Label[] }) {
  const [tasks, setTasks] = useState(initial);
  // Columns by status (drag to move), or by label (a task with two labels shows in both; status still changes from the card)
  const [groupBy, setGroupBy] = useState<"status" | "label">("status");
  const labelOf = new Map(labels.map((l) => [l.id, l]));
  const used = labels.filter((l) => tasks.some((t) => t.labelIds.includes(l.id)));
  const [error, setError] = useState<string | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [, start] = useTransition();
  const mayMove = (t: T) => canMove && (isManager || t.assigneeId === userId);

  function move(id: string, status: string) {
    const prev = tasks;
    const t = tasks.find((x) => x.id === id);
    if (!t || t.status === status || !mayMove(t)) return;
    setTasks(tasks.map((x) => (x.id === id ? { ...x, status, overdue: status !== "DONE" && x.overdue } : x)));
    start(async () => {
      const r = await moveTask(id, status);
      if (!r.ok) { setTasks(prev); setError(r.error); } else setError(null);
    });
  }

  return (
    <div className="space-y-2">
      {error && <Notice kind="error">{error}</Notice>}
      {labels.length > 0 && (
        <div className="flex items-center gap-2 text-xs" role="group" aria-label="Board columns">
          <span className="text-muted">Columns:</span>
          {(["status", "label"] as const).map((g) => (
            <button key={g} type="button" aria-pressed={groupBy === g} onClick={() => setGroupBy(g)} className={`rounded-full border px-2.5 py-1 ${groupBy === g ? "border-primary bg-primary/10 font-medium text-primary" : "border-border text-muted hover:bg-hover"}`}>{g === "status" ? "Status" : "Label"}</button>
          ))}
        </div>
      )}
      <div className={`grid gap-3 ${groupBy === "status" ? "md:grid-cols-4" : "md:grid-cols-3 xl:grid-cols-4"}`}>
        {(groupBy === "status"
          ? TASK_STATUSES.map((s) => ({ key: s, title: STATUS_LABEL[s], col: tasks.filter((t) => t.status === s), drop: s as string | null }))
          : [...used.map((l) => ({ key: l.id, title: l.name, col: tasks.filter((t) => t.labelIds.includes(l.id)), drop: null })), { key: "none", title: "No label", col: tasks.filter((t) => !t.labelIds.some((id) => labelOf.has(id))), drop: null }]
        ).map(({ key, title, col, drop }) => {
          return (
            <section key={key} aria-label={title} className="rounded-xl bg-border/40 p-2 min-h-24"
              onDragOver={(e) => canMove && drop && e.preventDefault()} onDrop={() => dragId && drop && move(dragId, drop)}>
              <h2 className="px-1 py-1 text-xs font-semibold text-muted">{title} · {col.length}</h2>
              <div className="space-y-2">
                {col.map((t) => (
                  <article key={t.id} draggable={groupBy === "status" && mayMove(t)} onDragStart={() => setDragId(t.id)} onDragEnd={() => setDragId(null)}
                    className={`card !p-3 text-sm space-y-1 ${groupBy === "status" && mayMove(t) ? "cursor-grab" : ""}`}>
                    <p className="font-semibold"><Link href={t.href} className="hover:underline">{t.title}</Link></p>
                    {t.labelIds.some((id) => labelOf.has(id)) && <p className="flex flex-wrap gap-1">{t.labelIds.map((id) => labelOf.get(id)).filter((l): l is Label => Boolean(l)).map((l) => <LabelChip key={l.id} label={l} />)}</p>}
                    {(t.subTotal > 0 || t.checkTotal > 0 || t.waitingFor.length > 0 || t.recurrence) && (
                      <p className="flex flex-wrap items-center gap-1.5 text-[11px]">
                        {t.subTotal > 0 && <span className="rounded-full bg-hover px-2 py-0.5 text-muted" title="Subtasks done">{t.subDone}/{t.subTotal} subtasks</span>}
                        {t.checkTotal > 0 && <span className={`rounded-full px-2 py-0.5 ${t.checkDone === t.checkTotal ? "bg-success/10 text-success" : "bg-hover text-muted"}`} title="Checklist items ticked">✓ {t.checkDone}/{t.checkTotal}</span>}
                        {t.waitingFor.length > 0 && <span className="rounded-full bg-warning/10 px-2 py-0.5 font-medium text-warning" title={`Waiting for: ${t.waitingFor.join(", ")}`}>waiting for {t.waitingFor.length}</span>}
                        {t.recurrence && <span className="rounded-full bg-primary/10 px-2 py-0.5 font-medium text-primary">repeats {t.recurrence.toLowerCase()}</span>}
                      </p>
                    )}
                    <p className="flex items-center gap-1.5 text-xs text-muted">{t.assignee ? <Avatar name={t.assignee} userId={t.assigneeId} size={20} /> : null}{t.assignee ?? "Unassigned"} · {t.priority}</p>
                    {t.deadline && (
                      <p className="flex flex-wrap items-center gap-1.5 text-xs text-muted">
                        {/* Moved to Done on this screen: the finish time arrives with the next load */}
                        {(t.status !== "DONE" || t.deadline.completedAt) && <TaskCountdown deadline={t.deadline.deadline} from={t.deadline.from} completedAt={t.status === "DONE" ? t.deadline.completedAt : null} title={t.deadline.title} />}
                        <span>Due {t.deadline.title}</span>
                      </p>
                    )}
                    {mayMove(t) && (
                      <select aria-label={`Status of ${t.title}`} value={t.status} onChange={(e) => move(t.id, e.target.value)} className="input !py-1 !text-xs">
                        {TASK_STATUSES.map((x) => <option key={x} value={x}>{STATUS_LABEL[x]}</option>)}
                      </select>
                    )}
                  </article>
                ))}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
