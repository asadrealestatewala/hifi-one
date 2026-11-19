"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { Notice } from "@/components/ui";
import { buildTimeline, type Bar, type TimelineTask } from "@/lib/project-timeline";
import { scheduleTaskAction } from "../schedule-actions";

const MAX_ROWS = 40;
const DAY = 86_400_000;
const shift = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);
type Mode = "move" | "start" | "end";
type Drag = { id: string; mode: Mode; x0: number; px: number; start: string; end: string; days: number };

// Gantt-style view of the project's tasks: one bar per task from its start (or creation) to its due date, today's line, milestones
// and the deadline. The project manager can drag a bar to move it, pull its left or right end to change the start or due date, or
// focus a bar and use the arrow keys. Colour is never the only signal: every bar also carries its dates in text.
export default function ProjectTimeline({ projectId, tasks: initial, today, projectStart, deadline, milestones, canEdit = false }: {
  projectId: string; tasks: (TimelineTask & { assignee?: string | null })[]; today: string; projectStart: Date | null; deadline: Date | null; milestones: { name: string; dueDate: string | null }[]; canEdit?: boolean;
}) {
  const router = useRouter();
  const [tasks, setTasks] = useState(initial);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [msg, setMsg] = useState<{ kind: "error" | "warn"; text: string } | null>(null);
  const [, start] = useTransition();
  const live = useRef<Drag | null>(null);
  const t = buildTimeline({ tasks, today, projectStart, deadline, milestones });
  if (t.bars.length === 0 && t.undated.length === 0) return null;
  const shown = t.bars.slice(0, MAX_ROWS);
  const editable = (b: Bar) => canEdit && !b.done && Boolean(b.due);

  function save(id: string, s: string, e: string) {
    const prev = tasks;
    setTasks(tasks.map((x) => (x.id === id ? { ...x, startDate: new Date(`${s}T00:00:00Z`), dueDate: new Date(`${e}T00:00:00Z`) } : x)));
    start(async () => {
      const r = await scheduleTaskAction(id, s, e);
      if (!r.ok) { setTasks(prev); setMsg({ kind: "error", text: r.error }); return; }
      setMsg(r.warnings.length ? { kind: "warn", text: r.warnings.join(" ") } : null);
      router.refresh();
    });
  }
  // New dates for a bar moved by n days in a mode; a start never passes the due date and a due date never passes the start.
  const moved = (b: { start: string; end: string }, mode: Mode, n: number) =>
    mode === "move" ? { start: shift(b.start, n), end: shift(b.end, n) }
    : mode === "start" ? { start: shift(b.start, n) > b.end ? b.end : shift(b.start, n), end: b.end }
    : { start: b.start, end: shift(b.end, n) < b.start ? b.start : shift(b.end, n) };
  const preview = (b: Bar) => {
    if (!drag || drag.id !== b.id || drag.days === 0) return b;
    const m = moved(b, drag.mode, drag.days);
    const pct = (d: string) => ((Date.parse(`${d}T00:00:00Z`) - Date.parse(`${t.from}T00:00:00Z`)) / DAY / t.days) * 100;
    return { ...b, ...m, left: pct(m.start), width: Math.max(((Date.parse(`${m.end}T00:00:00Z`) - Date.parse(`${m.start}T00:00:00Z`)) / DAY + 1) / t.days * 100, 1.2) };
  };
  const down = (b: Bar, mode: Mode) => (e: React.PointerEvent<HTMLElement>) => {
    if (!editable(b) || e.button !== 0) return;
    e.preventDefault(); e.stopPropagation();
    const track = (e.currentTarget.closest("[data-track]") as HTMLElement | null)?.getBoundingClientRect();
    if (!track) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    const d = { id: b.id, mode, x0: e.clientX, px: track.width / t.days, start: b.start, end: b.end, days: 0 };
    live.current = d; setDrag(d);
  };
  const moveP = (e: React.PointerEvent<HTMLElement>) => {
    const d = live.current; if (!d) return;
    const days = Math.round((e.clientX - d.x0) / d.px);
    if (days !== d.days) { live.current = { ...d, days }; setDrag(live.current); }
  };
  const up = () => {
    const d = live.current; live.current = null; setDrag(null);
    if (!d || d.days === 0) return;
    const m = moved(d, d.mode, d.days);
    save(d.id, m.start, m.end);
  };
  const key = (b: Bar) => (e: React.KeyboardEvent) => {
    if (!editable(b) || (e.key !== "ArrowLeft" && e.key !== "ArrowRight")) return;
    e.preventDefault();
    const n = e.key === "ArrowLeft" ? -1 : 1;
    const m = moved(b, e.shiftKey ? "end" : e.altKey ? "start" : "move", n);
    save(b.id, m.start, m.end);
  };

  return (
    <section className="card space-y-3" aria-labelledby="timeline-h">
      <div className="flex flex-wrap items-baseline justify-between gap-2"><h2 id="timeline-h" className="font-semibold">Timeline</h2><span className="text-xs text-muted">{t.from} to {t.to}</span></div>
      {msg && (msg.kind === "error" ? <Notice kind="error">{msg.text}</Notice> : <p role="status" className="rounded-lg bg-warning/10 px-3 py-2 text-sm text-warning">{msg.text}</p>)}
      {shown.length === 0 ? <p className="text-sm text-muted">No task has a due date yet, so there is nothing to draw. Set due dates on the tasks below.</p> : (
        <div className="overflow-x-auto">
          <div className="min-w-[640px]">
            <div className="relative ml-44 h-5 text-[10px] text-muted">
              {t.weeks.map((w) => <span key={w.label} className="absolute" style={{ left: `${w.left}%` }}>{w.label}</span>)}
            </div>
            <ul className="space-y-1">
              {shown.map((raw) => {
                const b = preview(raw);
                const can = editable(raw);
                const dragging = drag?.id === raw.id;
                const label = `${b.title}, ${b.start} to ${b.end}${b.assignee ? `, ${b.assignee}` : ""}${b.overdue ? ", overdue" : b.done ? ", done" : ""}`;
                return (
                  <li key={b.id} className="flex items-center gap-2">
                    <Link href={`/projects/${projectId}?task=${b.id}`} className="w-44 shrink-0 truncate text-xs hover:underline" title={b.title}>{b.title}</Link>
                    <div data-track className="relative h-6 flex-1 rounded bg-hover/60">
                      {t.todayPct !== null && <span aria-hidden className="absolute inset-y-0 w-px bg-brand/60" style={{ left: `${t.todayPct}%` }} />}
                      <span
                        role={can ? "slider" : undefined} tabIndex={can ? 0 : undefined}
                        aria-label={can ? `${label}. Arrow keys move it a day; Shift with an arrow changes the due date; Alt with an arrow changes the start.` : undefined}
                        aria-valuetext={can ? `${b.start} to ${b.end}` : undefined}
                        onPointerDown={down(raw, "move")} onPointerMove={moveP} onPointerUp={up} onPointerCancel={up} onKeyDown={key(raw)}
                        className={`group absolute inset-y-0.5 select-none rounded px-1 text-[10px] leading-5 text-white outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-1 ${b.done ? "bg-success" : b.overdue ? "bg-brand" : "bg-primary"} ${can ? "cursor-grab touch-none" : ""} ${dragging ? "cursor-grabbing opacity-90 shadow-lg" : ""}`}
                        style={{ left: `${b.left}%`, width: `${b.width}%` }} title={can ? `${label}. Drag to move, or drag an end to change a date.` : label}>
                        {can && <span aria-hidden onPointerDown={down(raw, "start")} onPointerMove={moveP} onPointerUp={up} onPointerCancel={up} className="absolute inset-y-0 left-0 w-2 cursor-ew-resize rounded-l bg-white/0 group-hover:bg-white/40" />}
                        {can && <span aria-hidden onPointerDown={down(raw, "end")} onPointerMove={moveP} onPointerUp={up} onPointerCancel={up} className="absolute inset-y-0 right-0 w-2 cursor-ew-resize rounded-r bg-white/0 group-hover:bg-white/40" />}
                        {dragging && drag.days !== 0 ? <span className="pointer-events-none absolute -top-5 left-0 whitespace-nowrap rounded bg-foreground px-1 text-[10px] text-background">{b.start.slice(5)} → {b.end.slice(5)}</span> : null}
                        <span className="sr-only">{label}</span>
                      </span>
                    </div>
                  </li>
                );
              })}
            </ul>
            {t.markers.length > 0 && (
              <div className="relative ml-44 mt-2 h-4 text-[10px] text-muted">
                {t.markers.map((m) => <span key={m.label + m.date} className="absolute -translate-x-1/2 whitespace-nowrap" style={{ left: `${m.left}%` }}>◆ {m.label} {m.date.slice(5)}</span>)}
              </div>
            )}
          </div>
        </div>
      )}
      <p className="text-xs text-muted">
        {t.bars.length > MAX_ROWS ? `Showing the first ${MAX_ROWS} of ${t.bars.length} dated tasks. ` : ""}
        Bars run from a task&apos;s start date (or the day it was created, when no start is set) to its due date, or to the completion day once done. <span className="text-brand">Red</span> is overdue, <span className="text-success">green</span> is done. The thin line is today.
        {canEdit ? " Drag a bar to move the task, or drag either end to change its start or due date. With the keyboard, focus a bar and use the arrow keys." : ""}
      </p>
      {t.undated.length > 0 && <p className="text-xs text-muted">No due date: {t.undated.slice(0, 8).map((u) => u.title).join(", ")}{t.undated.length > 8 ? ` and ${t.undated.length - 8} more` : ""}.</p>}
    </section>
  );
}
