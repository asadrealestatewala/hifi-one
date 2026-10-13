"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { moveTask } from "../actions";
import { STATUS_LABEL, TASK_STATUSES } from "@/lib/project-rules";

type T = {
  id: string; title: string; status: string; priority: string; assignee: string | null; assigneeId: string | null;
  due: string | null; overdue: boolean; subDone: number; subTotal: number; waitingFor: string[]; recurrence: string | null; href: string;
};

export default function TaskBoard({ tasks: initial, canMove, userId, isManager }: { tasks: T[]; canMove: boolean; userId: string; isManager: boolean }) {
  const [tasks, setTasks] = useState(initial);
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
      {error && <p role="alert" className="text-sm text-brand bg-brand/10 rounded-lg px-3 py-2">{error}</p>}
      <div className="grid gap-3 md:grid-cols-4">
        {TASK_STATUSES.map((s) => {
          const col = tasks.filter((t) => t.status === s);
          return (
            <section key={s} aria-label={STATUS_LABEL[s]} className="rounded-xl bg-border/40 p-2 min-h-24"
              onDragOver={(e) => canMove && e.preventDefault()} onDrop={() => dragId && move(dragId, s)}>
              <h2 className="px-1 py-1 text-xs font-semibold text-muted">{STATUS_LABEL[s]} · {col.length}</h2>
              <div className="space-y-2">
                {col.map((t) => (
                  <article key={t.id} draggable={mayMove(t)} onDragStart={() => setDragId(t.id)} onDragEnd={() => setDragId(null)}
                    className="card !p-3 text-sm space-y-1 cursor-grab">
                    <p className="font-semibold"><Link href={t.href} className="hover:underline">{t.title}</Link></p>
                    {(t.subTotal > 0 || t.waitingFor.length > 0 || t.recurrence) && (
                      <p className="flex flex-wrap items-center gap-1.5 text-[11px]">
                        {t.subTotal > 0 && <span className="rounded-full bg-hover px-2 py-0.5 text-muted" title="Subtasks done">{t.subDone}/{t.subTotal} subtasks</span>}
                        {t.waitingFor.length > 0 && <span className="rounded-full bg-warning/10 px-2 py-0.5 font-medium text-warning" title={`Waiting for: ${t.waitingFor.join(", ")}`}>waiting for {t.waitingFor.length}</span>}
                        {t.recurrence && <span className="rounded-full bg-primary/10 px-2 py-0.5 font-medium text-primary">repeats {t.recurrence.toLowerCase()}</span>}
                      </p>
                    )}
                    <p className="text-xs text-muted">{t.assignee ?? "Unassigned"} · {t.priority}</p>
                    {t.due && <p className={`text-xs ${t.overdue ? "text-brand font-semibold" : "text-muted"}`}>{t.overdue ? "Overdue: " : "Due "}{t.due}</p>}
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
