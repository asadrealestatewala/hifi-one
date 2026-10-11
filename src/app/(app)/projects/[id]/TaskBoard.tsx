"use client";

import { useState, useTransition } from "react";
import { moveTask } from "../actions";
import { STATUS_LABEL, TASK_STATUSES } from "@/lib/project-rules";

type T = {
  id: string; title: string; status: string; priority: string; assignee: string | null; assigneeId: string | null;
  due: string | null; overdue: boolean;
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
                    <p className="font-semibold">{t.title}</p>
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
