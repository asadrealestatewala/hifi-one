"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { Notice } from "@/components/ui";
import type { PlannerDay, PlannerTask } from "@/lib/planner";
import { planTaskAction } from "./planner-actions";

type Row = { userId: string | null; name: string; capacity: Record<string, number>; away: string[] };

const weekday = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString(undefined, { weekday: "short", timeZone: "UTC" });
const dayMonth = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString(undefined, { day: "numeric", month: "short", timeZone: "UTC" });
const MIME = "application/x-hifi-task";
const h = (n: number) => `${n % 1 === 0 ? n : n.toFixed(1)} h`;

// The week as a grid you can drag tasks around in. Dropping on a cell sets that day as the due date and, on another row, hands
// the task to that person. Every card also has a Move menu, so the same thing works with a keyboard or on a phone.
// Moves show at once and are undone with a message if the server refuses them.
export default function PlannerBoard({ days, rows, tasks: initial, people, today, trayHidden }: { days: PlannerDay[]; rows: Row[]; tasks: PlannerTask[]; people: { id: string; name: string }[]; today: string; trayHidden: number }) {
  const router = useRouter();
  const [tasks, setTasks] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const dates = new Set(days.map((d) => d.date));
  const known = new Set(rows.map((r) => r.userId).filter(Boolean));
  const rowOf = (t: PlannerTask) => (t.assigneeId && known.has(t.assigneeId) ? t.assigneeId : null);
  const inGrid = (t: PlannerTask) => Boolean(t.due && dates.has(t.due) && t.due >= today);
  const tray = tasks.filter((t) => !t.due || t.due < today);
  const byCell = useMemo(() => {
    const m = new Map<string, PlannerTask[]>();
    for (const t of tasks) if (inGrid(t)) { const k = `${rowOf(t) ?? "none"}|${t.due}`; m.set(k, [...(m.get(k) ?? []), t]); }
    return m;
  }, [tasks]); // eslint-disable-line react-hooks/exhaustive-deps

  function move(id: string, date: string | null, assigneeId: string | null | undefined) {
    const t = tasks.find((x) => x.id === id);
    if (!t || !t.canMove) return;
    const nextAssignee = assigneeId === undefined ? t.assigneeId : assigneeId;
    if (t.due === date && t.assigneeId === nextAssignee) return;
    const prev = tasks;
    setTasks(tasks.map((x) => (x.id === id ? { ...x, due: date, assigneeId: nextAssignee, overdue: Boolean(date && date < today) } : x)));
    start(async () => {
      const r = await planTaskAction({ taskId: id, date, ...(assigneeId !== undefined ? { assigneeId } : {}) });
      if (!r.ok) { setTasks(prev); setError(`${t.title}: ${r.error}`); } else { setError(null); router.refresh(); }
    });
  }
  const drop = (date: string | null, userId: string | null | undefined) => (e: React.DragEvent) => {
    e.preventDefault(); setOver(null);
    const id = e.dataTransfer.getData(MIME) || dragId;
    setDragId(null);
    if (id) move(id, date, userId);
  };
  const anyMovable = tasks.some((t) => t.canMove);

  return (
    <div className="space-y-3">
      {error && <Notice kind="error">{error}</Notice>}
      <div className="grid gap-3 xl:grid-cols-[1fr_16rem]">
        <div className="card overflow-x-auto !p-0">
          <table className="w-full min-w-[860px] table-fixed border-collapse text-sm">
            <colgroup><col className="w-36" />{days.map((d) => <col key={d.date} className={d.working ? "" : "w-24"} />)}</colgroup>
            <thead>
              <tr className="bg-hover/60 text-left text-xs text-muted">
                <th className="px-3 py-2 font-medium">Person</th>
                {days.map((d) => (
                  <th key={d.date} className={`px-2 py-2 font-medium ${d.today ? "text-primary" : ""}`} aria-current={d.today ? "date" : undefined}>
                    {weekday(d.date)} {dayMonth(d.date)}
                    {d.holiday ? <span className="block truncate text-[10px] font-normal" title={d.holiday}>{d.holiday}</span> : !d.working ? <span className="block text-[10px] font-normal">Day off</span> : null}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const week = days.reduce((a, d) => { const c = byCell.get(`${r.userId ?? "none"}|${d.date}`) ?? []; return { plan: a.plan + c.reduce((n, t) => n + (t.hours ?? 0), 0), cap: a.cap + (r.capacity[d.date] ?? 0) }; }, { plan: 0, cap: 0 });
                return (
                  <tr key={r.userId ?? "none"} className="border-t border-border align-top">
                    <th scope="row" className="px-3 py-2 text-left font-medium">
                      {r.name}
                      {r.userId && <span className={`block text-[11px] font-normal ${week.plan > week.cap ? "text-brand" : "text-muted"}`}>{h(Math.round(week.plan * 10) / 10)} of {h(week.cap)}</span>}
                    </th>
                    {days.map((d) => {
                      const key = `${r.userId ?? "none"}|${d.date}`;
                      const list = byCell.get(key) ?? [];
                      const plan = Math.round(list.reduce((n, t) => n + (t.hours ?? 0), 0) * 10) / 10;
                      const cap = r.capacity[d.date] ?? 0;
                      const away = r.away.includes(d.date);
                      const past = d.date < today;
                      const canDrop = anyMovable && !past;
                      return (
                        <td key={d.date} className={`border-l border-border p-1.5 !align-top ${!d.working || away ? "bg-hover/40" : ""} ${over === key ? "bg-primary/10 ring-2 ring-inset ring-primary" : ""}`}
                          onDragOver={(e) => { if (canDrop && (dragId || e.dataTransfer.types.includes(MIME))) { e.preventDefault(); setOver(key); } }} onDragLeave={() => setOver((o) => (o === key ? null : o))}
                          onDrop={canDrop ? drop(d.date, r.userId) : undefined} aria-label={`${r.name}, ${weekday(d.date)} ${dayMonth(d.date)}`}>
                          {r.userId && (cap > 0 || plan > 0 || away) && (
                            <p className={`mb-1 text-[10px] ${plan > cap ? "font-medium text-brand" : "text-muted"}`}>{away ? "On leave" : `${h(plan)} of ${h(cap)}`}{away && plan > 0 ? `, ${h(plan)} due` : ""}</p>
                          )}
                          <ul className="space-y-1">
                            {list.map((t) => <Card key={t.id} t={t} days={days} people={people} today={today} onDrag={setDragId} onMove={move} busy={pending} />)}
                          </ul>
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <section aria-labelledby="tray-h" className={`card space-y-2 self-start ${over === "tray" ? "ring-2 ring-primary" : ""}`}
          onDragOver={(e) => { if (anyMovable && (dragId || e.dataTransfer.types.includes(MIME))) { e.preventDefault(); setOver("tray"); } }} onDragLeave={() => setOver((o) => (o === "tray" ? null : o))} onDrop={anyMovable ? drop(null, undefined) : undefined}>
          <h2 id="tray-h" className="font-semibold">To plan <span className="text-sm font-normal text-muted">· {tray.length + trayHidden}</span></h2>
          <p className="text-xs text-muted">Open tasks with no due date, and tasks already overdue. Drag one onto a day{anyMovable ? ", or drop a task here to take its due date off" : ""}.</p>
          {tray.length === 0 ? <p className="text-sm text-muted">Nothing waiting. Every open task has a date that is still ahead.</p> : (
            <ul className="space-y-1">{tray.map((t) => <Card key={t.id} t={t} days={days} people={people} today={today} onDrag={setDragId} onMove={move} busy={pending} showWho />)}</ul>
          )}
          {trayHidden > 0 && <p className="text-xs text-muted">{trayHidden} more not shown. Plan these first, or find the rest in <Link href="/projects?view=tasks&who=all&due=overdue" className="text-primary hover:underline">Tasks</Link>.</p>}
        </section>
      </div>
    </div>
  );
}

function Card({ t, days, people, today, onDrag, onMove, busy, showWho }: {
  t: PlannerTask; days: PlannerDay[]; people: { id: string; name: string }[]; today: string; busy: boolean; showWho?: boolean;
  onDrag: (id: string | null) => void; onMove: (id: string, date: string | null, assigneeId: string | null | undefined) => void;
}) {
  const [open, setOpen] = useState(false);
  const who = people.find((p) => p.id === t.assigneeId)?.name;
  return (
    <li draggable={t.canMove} onDragStart={(e) => { e.dataTransfer.setData(MIME, t.id); e.dataTransfer.setData("text/plain", t.title); e.dataTransfer.effectAllowed = "move"; onDrag(t.id); }} onDragEnd={() => onDrag(null)}
      className={`rounded-lg border bg-surface p-1.5 text-xs shadow-sm ${t.canMove ? "cursor-grab active:cursor-grabbing" : ""} ${t.overdue ? "border-brand/50" : "border-border"} ${t.priority === "HIGH" ? "border-l-4 border-l-brand" : ""}`}>
      <Link draggable={false} href={`/projects/${t.projectId}?task=${t.id}`} className="line-clamp-2 font-medium hover:underline" title={t.title}>{t.title}</Link>
      <p className="truncate text-[10px] text-muted" title={t.project}>
        {t.project}{t.hours !== null ? ` · ${h(t.hours)}` : " · no estimate"}{t.status === "IN_PROGRESS" ? " · in progress" : t.status === "REVIEW" ? " · in review" : ""}
      </p>
      {(showWho || t.overdue) && <p className={`text-[10px] ${t.overdue ? "text-brand" : "text-muted"}`}>{showWho ? (who ?? "Unassigned") : ""}{showWho && t.due ? " · " : ""}{t.due ? (t.overdue ? `overdue, was due ${t.due}` : `due ${t.due}`) : showWho ? " · no date" : ""}</p>}
      {t.canMove && (
        <>
          <button type="button" className="mt-1 text-[10px] text-primary hover:underline" aria-expanded={open} onClick={() => setOpen(!open)}>{open ? "Close" : "Move"}</button>
          {open && (
            <form className="mt-1 space-y-1" onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              const date = String(f.get("date") ?? "") || null;
              const person = String(f.get("person") ?? "");
              onMove(t.id, date, person === "__keep" ? undefined : person || null);
              setOpen(false);
            }}>
              <label className="sr-only" htmlFor={`d-${t.id}`}>Due date</label>
              <input id={`d-${t.id}`} name="date" type="date" min={today} defaultValue={t.due && t.due >= today ? t.due : days.find((d) => d.working && d.date >= today)?.date ?? today} className="input !py-0.5 !text-xs" />
              <label className="sr-only" htmlFor={`p-${t.id}`}>Person</label>
              <select id={`p-${t.id}`} name="person" defaultValue="__keep" className="input !py-0.5 !text-xs">
                <option value="__keep">Keep {who ?? "unassigned"}</option>
                {people.filter((p) => p.id !== t.assigneeId).map((p) => <option key={p.id} value={p.id}>Give to {p.name}</option>)}
              </select>
              <button className="btn-primary !px-2 !py-0.5 !text-xs" disabled={busy}>Move task</button>
            </form>
          )}
        </>
      )}
    </li>
  );
}
